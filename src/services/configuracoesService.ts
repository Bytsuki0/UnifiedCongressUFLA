import { supabase } from "@/integrations/supabase/client";

/**
 * Configurações do congresso — a linha única de `public.configuracoes`.
 *
 * Até a migration 20260813120000 estes valores eram estado local do
 * React no Portal Admin: o botão SALVAR emitia um toast e nada saía do
 * navegador. Agora a linha é real e o **prazo de submissão é aplicado no
 * servidor** (trigger `protect_trabalhos_fields` + RPC
 * `editar_submissao`).
 *
 * ⚠ Só o prazo tem regra de servidor. Os outros campos são gravados para
 * que o botão pare de mentir, mas ainda não travam nada — quem for usar
 * `max_coautores` ou `parecer_min_caracteres` precisa escrever a trava
 * em SQL junto, nunca no cliente.
 */

export type Configuracoes = {
  submissoes_abertura: string | null;
  submissoes_encerramento: string | null;
  parecer_min_caracteres: number;
  max_coautores: number;
  alerta_horas: number;
  edital: string;
  atualizado_em: string;
};

/** O que o autor precisa saber antes de tentar enviar ou editar. */
export type PrazoSubmissoes = {
  abertura: string | null;
  encerramento: string | null;
  /**
   * Calculado NO SERVIDOR (`submissoes_abertas()`), no fuso de Lavras.
   * Nunca recalcular a partir das datas com o relógio do navegador: um
   * computador adiantado reabriria o prazo na tela.
   */
  aberto: boolean;
  /** Data de hoje segundo o servidor, para exibição. */
  hoje: string;
};

export async function carregarConfiguracoes(): Promise<Configuracoes | null> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Grava. A RLS recusa quem não é admin — a interface só reflete isso. */
export async function salvarConfiguracoes(valores: Partial<Configuracoes>): Promise<void> {
  const { error } = await supabase
    .from("configuracoes")
    .update(valores)
    .eq("id", true);
  if (error) throw new Error(error.message);
}

/**
 * Prazo vigente. Devolve `aberto: true` quando a consulta falha: o gate
 * de verdade é o servidor, e uma falha de rede não pode esconder o
 * formulário de quem tem direito a submeter. Quem recusa é o banco.
 */
export async function carregarPrazoSubmissoes(): Promise<PrazoSubmissoes> {
  const { data, error } = await supabase.rpc("prazo_submissoes");
  if (error || !data || data.length === 0) {
    return { abertura: null, encerramento: null, aberto: true, hoje: "" };
  }
  return data[0];
}

/* ------------------------------------------------------------------
 * Arquivos para download (migration 20260830120000)
 * ------------------------------------------------------------------
 * Eram 8 colunas `link_*` em `configuracoes` mais uma lista fixa em
 * `src/lib/downloads.ts`: publicar um arquivo novo exigia migration,
 * código e deploy. Agora são linhas de `arquivos_download`, editadas em
 * /admin/configuracoes.
 * ----------------------------------------------------------------- */

/** Onde o arquivo aparece. É coluna com CHECK no banco, não texto livre. */
export type GrupoDownload = "estudante" | "revisor";

/** Um arquivo publicado, como as telas públicas o recebem. */
export type ArquivoDownload = {
  id: string;
  grupo: GrupoDownload;
  titulo: string;
  url: string;
  /** Selo do formato (".DOCX", "PDF", ...). Vazio esconde o selo. */
  formato: string;
  /** Linha de apoio; hoje só /revisor/arquivo a mostra. */
  descricao: string;
};

/** O mesmo arquivo do ponto de vista de quem edita: leva a ordem junto. */
export type ArquivoDownloadAdmin = ArquivoDownload & { ordem: number };

/**
 * Arquivos publicados, para as telas que mostram botões de baixar.
 * Chamada por páginas PÚBLICAS (landing e /login), por isso vem da RPC
 * `arquivos_download_publicos()`, aberta a `anon` — a tabela continua
 * fechada para quem não tem sessão.
 *
 * Falha devolve lista vazia, ao contrário do prazo, que falha aberto.
 * São invariantes opostas pelo mesmo motivo: aqui o "não sei" seguro é
 * não oferecer o download. Mandar o usuário para um link que não existe
 * é pior do que não mostrar link nenhum.
 */
export async function carregarArquivosDownload(): Promise<ArquivoDownload[]> {
  const { data, error } = await supabase.rpc("arquivos_download_publicos");
  if (error || !data) return [];
  return data as ArquivoDownload[];
}

/**
 * A mesma lista pela TABELA, para a tela do admin: ela precisa da
 * `ordem` para saber onde encaixar o próximo arquivo. Aqui o erro
 * PROPAGA — quem está editando tem de saber que a lista não carregou,
 * senão acrescenta em cima de um estado que não é o do banco.
 */
export async function listarArquivosDownload(): Promise<ArquivoDownloadAdmin[]> {
  const { data, error } = await supabase
    .from("arquivos_download")
    .select("id, grupo, titulo, url, formato, descricao, ordem")
    .order("grupo")
    .order("ordem")
    .order("criado_em");
  if (error) throw new Error(error.message);
  return (data ?? []) as ArquivoDownloadAdmin[];
}

export type NovoArquivoDownload = {
  grupo: GrupoDownload;
  titulo: string;
  url: string;
  formato: string;
  descricao: string;
  ordem: number;
};

/** Publica um arquivo. A RLS recusa quem não é admin. */
export async function criarArquivoDownload(
  entrada: NovoArquivoDownload,
): Promise<ArquivoDownloadAdmin> {
  const { data, error } = await supabase
    .from("arquivos_download")
    .insert({
      grupo: entrada.grupo,
      titulo: entrada.titulo.trim(),
      url: entrada.url.trim(),
      formato: entrada.formato.trim(),
      descricao: entrada.descricao.trim(),
      ordem: entrada.ordem,
    })
    .select("id, grupo, titulo, url, formato, descricao, ordem")
    .single();
  if (error) throw new Error(error.message);
  return data as ArquivoDownloadAdmin;
}

/** Corrige título, link, formato ou descrição de um arquivo já publicado. */
export async function atualizarArquivoDownload(
  id: string,
  campos: Partial<Omit<NovoArquivoDownload, "grupo">>,
): Promise<void> {
  const { error } = await supabase
    .from("arquivos_download")
    .update(campos)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Tira o arquivo do ar. Some das telas públicas na hora; o Drive não é tocado. */
export async function removerArquivoDownload(id: string): Promise<void> {
  const { error } = await supabase.from("arquivos_download").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
