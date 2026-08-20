import { supabase } from "@/integrations/supabase/client";
import { PDF_BUCKET } from "@/lib/config";
import type { TipoResumo } from "@/lib/submissao";
import type { Trabalho, Categoria } from "@/lib/types";

/**
 * Trabalhos submetidos: leitura, cadastro e edição.
 *
 * O recorte de quem enxerga o quê é do RLS, não daqui — a policy
 * `trabalhos select` libera para a organização, para o dono e para o
 * revisor associado. As funções abaixo que filtram por dono
 * (`listarTrabalhosDoAutor`) filtram por conta da SEMÂNTICA da tela
 * ("as minhas submissões"), não por segurança: sem o filtro, um
 * professor veria aqui os trabalhos de todo mundo, que é o que o RLS
 * legitimamente permite a ele.
 */

export type Coautor = { nome?: string; email?: string };

export type NovoTrabalho = {
  titulo: string;
  /** Termos livres, na ordem em que o autor os digitou. */
  palavrasChave: string[];
  /** Link do vídeo de apresentação no YouTube. */
  videoUrl: string;
  tipoResumo: TipoResumo;
  categoriaId: string;
  autores: string;
  orientadorEmail: string | null;
  coautores: Coautor[];
  /** PDF já validado (application/pdf, ≤ 10 MB) pelo chamador. */
  arquivo: File;
  ownerId: string;
};

/** Lista todos os trabalhos — a RLS decide quantos de fato voltam. */
export async function listarTrabalhos(): Promise<Trabalho[]> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Trabalhos de um autor específico, mais recentes primeiro. */
export async function listarTrabalhosDoAutor(ownerId: string): Promise<Trabalho[]> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function obterTrabalho(id: string): Promise<Trabalho | null> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function obterCategoria(id: string): Promise<Categoria | null> {
  const { data, error } = await supabase
    .from("categorias")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Trabalhos + categorias juntos, para as telas que mostram os dois. */
export async function listarTrabalhosComCategorias(): Promise<{
  trabalhos: Trabalho[];
  categorias: Categoria[];
}> {
  const [t, c] = await Promise.all([
    supabase.from("trabalhos").select("*").order("created_at", { ascending: false }),
    supabase.from("categorias").select("*").order("nome"),
  ]);
  if (t.error || c.error) throw t.error ?? c.error;
  return { trabalhos: t.data ?? [], categorias: c.data ?? [] };
}

/**
 * Mesma combinação, mas recortada por autor. `ownerId` nulo devolve lista
 * vazia de trabalhos sem ir ao banco — é o estado "sessão ainda
 * resolvendo" do Portal do Estudante.
 */
export async function listarTrabalhosDoAutorComCategorias(ownerId: string | null): Promise<{
  trabalhos: Trabalho[];
  categorias: Categoria[];
}> {
  const [t, c] = await Promise.all([
    ownerId
      ? supabase
          .from("trabalhos")
          .select("*")
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("categorias").select("*").order("nome"),
  ]);
  if (t.error || c.error) throw t.error ?? c.error;
  return { trabalhos: t.data ?? [], categorias: c.data ?? [] };
}

/**
 * Campos que a organização edita pelo formulário de co-chairs. `status`
 * fica de fora: quem o move é a decisão consolidada dos pareceres, no
 * servidor — não este formulário.
 */
export type PayloadTrabalho = {
  titulo: string;
  resumo: string;
  autores: string;
  categoria_id: string;
  data_submissao: string;
};

export async function criarTrabalhoPelaOrganizacao(payload: PayloadTrabalho): Promise<void> {
  const { error } = await supabase.from("trabalhos").insert(payload);
  if (error) throw error;
}

export async function atualizarTrabalho(
  id: string,
  payload: PayloadTrabalho,
): Promise<void> {
  const { error } = await supabase.from("trabalhos").update(payload).eq("id", id);
  if (error) throw error;
}

/*
 * `atualizarStatusDoTrabalho` foi removida em 20260820140000.
 *
 * Ela gravava `trabalhos.status` cru a partir dos botões do Portal Admin
 * — sem autor, sem justificativa e sem data — e o parecer seguinte a
 * sobrescrevia em silêncio. Era o único override humano que existia, e
 * agora existe um caminho próprio para isso: `registrar_parecer_editorial`,
 * que exige comentário e deixa rastro em `decisoes_editoriais`.
 *
 * Se um dia voltar a fazer falta um "mover status na marra", ele tem de
 * nascer como RPC auditada, não como UPDATE solto.
 */

/**
 * Caminho do objeto dentro do bucket de PDFs, a partir do que está
 * gravado em `pdf_url`.
 *
 * O formato novo já é o caminho (`<owner_id>/arquivo.pdf`), mas linhas
 * antigas guardam a URL pública inteira, de quando o bucket ainda era
 * público — e `storage.remove()` não entende URL. Devolve null quando a
 * URL aponta para outro bucket ou para fora do Storage: melhor deixar um
 * arquivo órfão do que apagar o objeto errado.
 */
function caminhoNoBucket(pdfUrl: string | null | undefined): string | null {
  if (!pdfUrl) return null;
  if (!/^https?:\/\//i.test(pdfUrl)) return pdfUrl;
  const m = pdfUrl.match(/\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m || m[1] !== PDF_BUCKET) return null;
  return decodeURIComponent(m[2]);
}

/**
 * Exclui um trabalho e o PDF que veio com ele.
 *
 * A linha sai primeiro porque é ela a autoridade: `pareceres`,
 * `avaliacoes` e `trabalho_revisores` acompanham por ON DELETE CASCADE.
 * O blob do Storage **não** sai por SQL — exige esta segunda chamada. Na
 * ordem inversa, um erro no DELETE deixaria um trabalho apontando para
 * um arquivo que não existe mais; nesta, o pior caso é um arquivo órfão.
 *
 * Quem autoriza é o RLS (`trabalhos delete` e `pdfs owner delete` já
 * liberam a organização), nunca a interface que chama.
 */
export async function excluirTrabalho(id: string): Promise<void> {
  const { data: alvo } = await supabase
    .from("trabalhos")
    .select("pdf_url")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("trabalhos").delete().eq("id", id);
  if (error) throw error;

  const caminho = caminhoNoBucket(alvo?.pdf_url);
  if (caminho) await supabase.storage.from(PDF_BUCKET).remove([caminho]);
}

/**
 * Exclusão em lote — a limpeza de fim de edição do Portal Admin.
 *
 * Devolve quantos trabalhos o banco de fato apagou, que pode ser menos
 * do que o pedido: o RLS recusa em silêncio o que o usuário não pode
 * apagar, e um DELETE parcial não vira erro. Quem chama compara com o
 * total e avisa o usuário.
 */
export async function excluirTrabalhos(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const { data: alvos } = await supabase
    .from("trabalhos")
    .select("id, pdf_url")
    .in("id", ids);

  const { data: apagados, error } = await supabase
    .from("trabalhos")
    .delete()
    .in("id", ids)
    .select("id");
  if (error) throw error;

  const saiu = new Set((apagados ?? []).map((t) => t.id));
  const caminhos = (alvos ?? [])
    .filter((a) => saiu.has(a.id))
    .map((a) => caminhoNoBucket(a.pdf_url))
    .filter((c): c is string => c !== null);
  if (caminhos.length > 0) await supabase.storage.from(PDF_BUCKET).remove(caminhos);

  return saiu.size;
}

/**
 * Submissão do autor: sobe o PDF para a pasta do próprio usuário (exigida
 * pela policy do Storage) e grava o trabalho. Só isso.
 *
 * ⚠ O trabalho nasce SEM revisores, e é de propósito. Até 20260820 esta
 * função chamava `distribuir_revisores` logo depois do INSERT, então o
 * autor apertava "Enviar" e o banco já escolhia até 3 revisores sem que
 * ninguém da organização autorizasse. Agora quem distribui é um co-chair,
 * em /co-chairs/atribuicoes, revisando a proposta antes de confirmá-la.
 * A migration 20260820120000 fechou o portão do outro lado: a RPC deixou
 * de aceitar o dono do trabalho, então nem por chamada direta à API o
 * autor consegue se atribuir revisores.
 */
export async function submeterTrabalho(input: NovoTrabalho): Promise<string> {
  const nomeSeguro = input.arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const caminho = `${input.ownerId}/${Date.now()}-${nomeSeguro}`;

  const { error: erroUpload } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(caminho, input.arquivo, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (erroUpload) throw new Error("Erro ao enviar o PDF. Tente novamente.");

  const { data: novo, error } = await supabase
    .from("trabalhos")
    .insert({
      titulo: input.titulo,
      palavras_chave: input.palavrasChave,
      video_url: input.videoUrl,
      tipo_resumo: input.tipoResumo,
      categoria_id: input.categoriaId,
      autores: input.autores,
      orientador_email: input.orientadorEmail,
      coautores: input.coautores,
      pdf_url: caminho,
      data_submissao: new Date().toISOString().split("T")[0],
      status: "pendente",
    })
    .select("id")
    .single();

  if (error || !novo) throw new Error("Erro ao submeter trabalho. Tente novamente.");

  return novo.id;
}

export type EditarSubmissaoInput = {
  trabalhoId: string;
  ownerId: string;
  titulo: string;
  palavrasChave: string[];
  videoUrl: string;
  tipoResumo: TipoResumo;
  /** Novo PDF. Quando ausente, o arquivo atual é mantido. */
  arquivo?: File | null;
};

/**
 * Edição da submissão pelo próprio autor, antes de a avaliação começar.
 *
 * Espelha `enviarCorrecao` (correcaoService) de propósito — mesma ordem
 * de operações, mesmo contrato: sobe o PDF novo, grava pela RPC e só
 * então apaga o antigo. Se a gravação falhar, a tabela continua
 * apontando para o arquivo velho e o que sobra é um upload órfão, que é
 * melhor do que um trabalho sem PDF.
 *
 * Quem recusa fora do prazo, fora do status 'pendente' ou de dono
 * errado é a RPC `editar_submissao`, não esta função.
 */
export async function editarSubmissao(input: EditarSubmissaoInput): Promise<void> {
  let caminhoNovo: string | null = null;

  if (input.arquivo) {
    const nomeSeguro = input.arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    caminhoNovo = `${input.ownerId}/${Date.now()}-${nomeSeguro}`;
    const { error: erroUpload } = await supabase.storage
      .from(PDF_BUCKET)
      .upload(caminhoNovo, input.arquivo, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (erroUpload) throw new Error("Não foi possível enviar o novo PDF.");
  }

  const { data, error } = await supabase.rpc("editar_submissao", {
    _trabalho_id: input.trabalhoId,
    _titulo: input.titulo,
    _palavras_chave: input.palavrasChave,
    _video_url: input.videoUrl,
    _tipo_resumo: input.tipoResumo,
    _pdf_url: caminhoNovo ?? undefined,
  });
  if (error) throw new Error(error.message ?? "Não foi possível salvar as alterações.");

  // A RPC devolve o caminho do arquivo substituído. Falha ao apagar não
  // invalida a edição: o registro já está certo.
  if (typeof data === "string" && data && !/^https?:\/\//i.test(data)) {
    await supabase.storage.from(PDF_BUCKET).remove([data]);
  }
}

/**
 * Trabalho do próprio autor, para a tela de correção.
 *
 * O filtro por `owner_id` é redundante com o RLS na leitura, mas garante
 * que a tela nunca abra o trabalho de outra pessoa para um usuário da
 * organização — que PODE lê-lo, e não deveria corrigi-lo por aqui.
 */
export async function obterMeuTrabalho(
  id: string,
  ownerId: string,
): Promise<Trabalho | null> {
  const { data, error } = await supabase
    .from("trabalhos")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
