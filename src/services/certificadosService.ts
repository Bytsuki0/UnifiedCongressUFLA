import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Certificados emitidos e os templates PDF usados para gerá-los.
 *
 * Dois buckets, ambos privados:
 *   · `certificates`          — o PDF final de cada participante
 *   · `certificate-templates` — o modelo por atividade, só a organização
 *
 * Toda leitura sai por URL assinada ou download autenticado; nunca por
 * URL pública (mesmo motivo do bucket de trabalhos — SEC-05).
 */

const BUCKET_CERTIFICADOS = "certificates";
const BUCKET_TEMPLATES = "certificate-templates";

/** TTL curto: a URL só precisa sobreviver ao clique que abre a aba. */
const TTL_PREVIA_SEGUNDOS = 120;

/** Tabelas que guardam um template por atividade. */
export type OrigemEvento = "minicourse" | "schedule";

const tabelaDaOrigem = (origem: OrigemEvento) =>
  origem === "minicourse" ? ("minicourses" as const) : ("schedule" as const);

/** Certificados do próprio participante, mais recentes primeiro. */
export async function listarMeusCertificados(userId: string) {
  const { data, error } = await supabase
    .from("certificates")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Assina a emissão de certificados deste usuário e chama `aoMudar` a cada
 * evento — a emissão roda em lote no painel admin e pode terminar com a
 * tela do participante já aberta. Devolve a função de cancelamento.
 */
export function assinarMeusCertificados(userId: string, aoMudar: () => void): () => void {
  const canal = supabase
    .channel("my-certs-rt")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "certificates",
        filter: `user_id=eq.${userId}`,
      },
      aoMudar,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(canal);
  };
}

/**
 * Baixa o certificado e devolve um object URL para exibir ou salvar.
 * O chamador é responsável por revogar o URL (URL.revokeObjectURL).
 */
export async function baixarCertificadoComoBlobUrl(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_CERTIFICADOS).download(caminho);
  if (error || !data) return null;
  return URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
}

/** URL temporária de um certificado já emitido. */
export async function urlAssinadaDoCertificado(caminho: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from(BUCKET_CERTIFICADOS)
    .createSignedUrl(caminho, TTL_PREVIA_SEGUNDOS);
  return data?.signedUrl ?? null;
}

/** URL temporária do template de uma atividade. */
export async function urlAssinadaDoTemplate(caminho: string): Promise<string | null> {
  const { data } = await supabase.storage
    .from(BUCKET_TEMPLATES)
    .createSignedUrl(caminho, TTL_PREVIA_SEGUNDOS);
  return data?.signedUrl ?? null;
}

/** Bytes do template, para o pdf-lib compor o certificado no cliente. */
export async function baixarTemplate(caminho: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET_TEMPLATES).download(caminho);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Sobe o template e aponta a atividade para ele. O caminho é derivado do
 * par (origem, id), então reenviar substitui o anterior — daí o upsert.
 */
export async function enviarTemplate(
  origem: OrigemEvento,
  eventoId: string,
  arquivo: File,
): Promise<string> {
  const caminho = `${origem}/${eventoId}.pdf`;

  const { error } = await supabase.storage
    .from(BUCKET_TEMPLATES)
    .upload(caminho, arquivo, { upsert: true, contentType: "application/pdf" });
  if (error) throw error;

  const { error: erroUpdate } = await supabase
    .from(tabelaDaOrigem(origem))
    .update({ certificate_template_url: caminho })
    .eq("id", eventoId);
  if (erroUpdate) throw erroUpdate;

  return caminho;
}

/**
 * Sobe o PDF gerado e grava o caminho no registro do certificado.
 *
 * A ordem importa: o arquivo entra primeiro, e só então a linha passa a
 * apontar para ele. Invertido, um erro no upload deixaria o registro
 * apontando para um caminho vazio.
 */
export async function anexarPdfAoCertificado(
  certificadoId: string,
  userId: string,
  pdfBytes: Uint8Array,
): Promise<string> {
  const caminho = `${userId}/${certificadoId}-clickable.pdf`;

  const { error } = await supabase.storage
    .from(BUCKET_CERTIFICADOS)
    .upload(caminho, pdfBytes, { upsert: true, contentType: "application/pdf" });
  if (error) throw error;

  const { error: erroUpdate } = await supabase
    .from("certificates")
    .update({ arquivo_url: caminho })
    .eq("id", certificadoId);
  if (erroUpdate) throw erroUpdate;

  return caminho;
}

// ---------------------------------------------------------------------
// Emissão e verificação (painel da organização)
// ---------------------------------------------------------------------

/** Linha devolvida pela RPC pública de verificação de certificado. */
export type CertificadoVerificado =
  Database["public"]["Functions"]["verify_certificate"]["Returns"][number];

/**
 * Valida um código de certificado. RPC porque a verificação é pública
 * (abre sem sessão) e não pode implicar leitura da tabela inteira.
 * Devolve null quando o código não existe.
 */
export async function verificarCertificado(
  codigo: string,
): Promise<CertificadoVerificado | null> {
  const { data, error } = await supabase.rpc("verify_certificate", { _code: codigo });
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Ids dos usuários que já têm certificado desta atividade. */
export async function idsComCertificadoDaAtividade(atividade: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("certificates")
    .select("user_id")
    .eq("atividade", atividade);
  if (error) throw error;
  return (data ?? []).map((c) => c.user_id);
}

export async function excluirCertificado(id: string): Promise<void> {
  const { error } = await supabase.from("certificates").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Registra a presença de um participante numa atividade.
 *
 * RPC SECURITY DEFINER: gravar em `attendances` exige cruzar inscrição e
 * atividade, o que o RLS não expõe ao cliente.
 */
export async function marcarPresenca(
  tipoEvento: OrigemEvento,
  eventoId: string,
  userId: string,
) {
  const { data, error } = await supabase.rpc("mark_attendance", {
    _event_type: tipoEvento,
    _event_id: eventoId,
    _user_id: userId,
  });
  if (error) throw error;
  return data;
}

/** Fecha a atividade e emite os certificados de quem teve presença. */
export async function fecharEventoEEmitirCertificados(
  tipoEvento: OrigemEvento,
  eventoId: string,
  cargaHoraria: number,
) {
  const { data, error } = await supabase.rpc("close_event_and_issue_certificates", {
    _event_type: tipoEvento,
    _event_id: eventoId,
    _carga_horaria: cargaHoraria,
  });
  if (error) throw error;
  return data;
}

/** Certificados já liberados para o participante (com data de liberação). */
export async function listarMeusCertificadosLiberados(userId: string) {
  const { data, error } = await supabase
    .from("certificates")
    .select("*")
    .eq("user_id", userId)
    .not("data_liberacao", "is", null);
  if (error) throw error;
  return data ?? [];
}

/** Atividades disponíveis para emissão, com o template já associado. */
export async function listarMinicursosParaEmissao() {
  const { data, error } = await supabase
    .from("minicourses")
    .select("id, nome, carga_horaria, data, horario_inicio, local, certificate_template_url")
    .order("data");
  if (error) throw error;
  return data ?? [];
}

export async function listarProgramacaoParaEmissao() {
  const { data, error } = await supabase
    .from("schedule")
    .select("id, titulo, categoria, data, horario_inicio, horario_fim, local, certificate_template_url")
    .order("data")
    .order("horario_inicio");
  if (error) throw error;
  return data ?? [];
}

/**
 * Participantes elegíveis a certificado de uma atividade.
 *
 * Minicurso: quem está inscrito e não cancelou. Atividade da programação:
 * quem tem inscrição aprovada no congresso. Sem FK inscrição->profiles, a
 * junção é feita aqui (PGRST200) — mesmo caso do inscricoesService.
 */
export async function listarParticipantesParaEmissao(
  origem: OrigemEvento,
  eventoId: string,
) {
  const { data: inscritos, error } =
    origem === "minicourse"
      ? await supabase
          .from("minicourse_registrations")
          .select("user_id")
          .eq("minicourse_id", eventoId)
          .neq("status", "cancelled")
      : await supabase
          .from("congress_registrations")
          .select("user_id")
          .eq("status", "approved");
  if (error) throw error;

  const ids = Array.from(new Set((inscritos ?? []).map((r) => r.user_id)));
  if (ids.length === 0) return [];

  const { data: perfis } = await supabase
    .from("profiles")
    .select("id, nome, email, instituicao")
    .in("id", ids);
  return perfis ?? [];
}

/** Certificados emitidos, com o nome de quem recebeu. */
export async function listarCertificadosComPerfil() {
  const { data: certificados, error } = await supabase
    .from("certificates")
    .select("id, user_id, atividade, carga_horaria, data_liberacao, arquivo_url, verification_code")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const ids = Array.from(new Set((certificados ?? []).map((c) => c.user_id)));
  const { data: perfis } = ids.length
    ? await supabase.from("profiles").select("id, nome, email").in("id", ids)
    : { data: [] };

  const porId = new Map((perfis ?? []).map((p) => [p.id, p]));
  return (certificados ?? []).map((c) => ({ ...c, profiles: porId.get(c.user_id) ?? null }));
}

export type NovoCertificado = {
  userId: string;
  atividade: string;
  cargaHoraria: number;
  eventoId: string;
  origem: OrigemEvento;
};

/**
 * Cria o registro do certificado e devolve id + código de verificação.
 * O PDF é anexado depois, por `anexarPdfAoCertificado` — a linha nasce
 * primeiro porque é ela que gera o código impresso no QR.
 */
export async function criarCertificado(novo: NovoCertificado) {
  const { data, error } = await supabase
    .from("certificates")
    .insert({
      user_id: novo.userId,
      atividade: novo.atividade,
      carga_horaria: novo.cargaHoraria,
      event_id: novo.eventoId,
      event_source: novo.origem,
      data_liberacao: new Date().toISOString(),
    })
    .select("id, verification_code")
    .single();
  if (error) throw error;
  return data;
}

/** Certificados por id, para completar os que ficaram sem PDF. */
export async function obterCertificadosPorIds(ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("certificates")
    .select("id, user_id, atividade, carga_horaria, verification_code, arquivo_url")
    .in("id", ids);
  if (error) throw error;
  return data ?? [];
}

/** Presenças registradas numa atividade, com o nome de quem entrou. */
export async function listarPresencas(tipoEvento: OrigemEvento, eventoId: string) {
  const { data: presencas, error } = await supabase
    .from("attendances")
    .select("id, user_id, checked_in_at")
    .eq("event_type", tipoEvento)
    .eq("event_id", eventoId)
    .order("checked_in_at", { ascending: false });
  if (error) throw error;

  const ids = Array.from(new Set((presencas ?? []).map((a) => a.user_id)));
  let perfis: Record<string, { nome: string | null; email: string | null }> = {};
  if (ids.length) {
    const { data } = await supabase.from("profiles").select("id, nome, email").in("id", ids);
    perfis = Object.fromEntries(
      (data ?? []).map((p) => [p.id, { nome: p.nome, email: p.email }]),
    );
  }
  return (presencas ?? []).map((a) => ({ ...a, profile: perfis[a.user_id] ?? null }));
}

/**
 * Assina as presenças de uma atividade — o painel fica aberto enquanto
 * os QRs são lidos e precisa atualizar a lista sozinho.
 */
export function assinarPresencas(
  tipoEvento: OrigemEvento,
  eventoId: string,
  aoMudar: () => void,
): () => void {
  const canal = supabase
    .channel(`att-${tipoEvento}-${eventoId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "attendances",
        filter: `event_id=eq.${eventoId}`,
      },
      aoMudar,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(canal);
  };
}

/** Minicursos e atividades como opções do seletor de check-in. */
export async function listarMinicursosParaCheckin() {
  const { data, error } = await supabase
    .from("minicourses")
    .select("id, nome, carga_horaria, certificate_template_url")
    .order("data");
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id,
    titulo: m.nome,
    carga_horaria: m.carga_horaria,
    template_url: m.certificate_template_url,
  }));
}

export async function listarProgramacaoParaCheckin() {
  const { data, error } = await supabase
    .from("schedule")
    .select("id, titulo, certificate_template_url")
    .order("data");
  if (error) throw error;
  return (data ?? []).map((s) => ({ ...s, template_url: s.certificate_template_url }));
}
