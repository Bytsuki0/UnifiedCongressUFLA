import { supabase } from "@/integrations/supabase/client";

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
