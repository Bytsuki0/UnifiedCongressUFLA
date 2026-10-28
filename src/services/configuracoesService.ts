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
 * ⚠ Só as datas têm regra de servidor: o prazo de submissão trava o envio,
 * o das avaliações (`revisoes_encerramento` + `alerta_horas`) move os
 * e-mails aos revisores (`emails_devidos`, migration 20261014120000) e a
 * divulgação (`resultados_divulgacao`) solta o e-mail de resultado de cada
 * autor (`resultados_devidos`, migration 20261027120000). Os outros campos
 * são gravados para que o botão pare de mentir, mas ainda não travam nada —
 * quem for usar `max_coautores` ou `parecer_min_caracteres` precisa escrever
 * a trava em SQL junto, nunca no cliente.
 */

export type Configuracoes = {
  submissoes_abertura: string | null;
  submissoes_encerramento: string | null;
  parecer_min_caracteres: number;
  max_coautores: number;
  /**
   * Horas antes do fim do prazo das avaliações em que sai o lembrete aos
   * revisores com parecer pendente (migration 20261014120000).
   */
  alerta_horas: number;
  /**
   * Último dia para registrar parecer, 'AAAA-MM-DD' (inclusivo, horário de
   * Brasília). Vazio = sem lembrete nem aviso de atraso. Só move e-mails —
   * não trava parecer nenhum.
   */
  revisoes_encerramento: string | null;
  /**
   * Momento da divulgação dos resultados, hora de Brasília SEM fuso
   * ('AAAA-MM-DDTHH:MM[:SS]', é o que o `datetime-local` grava e lê). A
   * partir dele cada autor recebe UM e-mail com todos os seus trabalhos.
   * Vazio = nada sai. ⚠ Nunca passar por `new Date`: sem fuso, o navegador
   * o leria no fuso DELE.
   */
  resultados_divulgacao: string | null;
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

/**
 * Colunas que o painel do admin edita — e só elas. ⚠ Não trocar por `*`:
 * `salvarConfiguracoes` grava de volta o objeto inteiro que veio daqui, e
 * com `*` levaria junto `revisores_por_trabalho`, que é de outra tela
 * (/co-chairs/atribuicoes). Um admin salvando o prazo com a página aberta
 * desde antes desfaria em silêncio o número que um co-chair acabou de
 * mudar.
 */
const COLUNAS_DO_ADMIN =
  "submissoes_abertura, submissoes_encerramento, parecer_min_caracteres, max_coautores, alerta_horas, revisoes_encerramento, resultados_divulgacao, edital, atualizado_em";

export async function carregarConfiguracoes(): Promise<Configuracoes | null> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select(COLUNAS_DO_ADMIN)
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
 * Divulgação dos resultados (migration 20261027120000)
 * ------------------------------------------------------------------
 * Cada linha é UM e-mail de resultado: nasce 'reservado' quando o Apps
 * Script busca a fila e é fechada como 'enviado' ou 'falha' com o que o
 * Google respondeu — o mesmo ciclo de `envios_revisores`. Só o admin lê
 * (o card mora em /admin/configuracoes).
 * ----------------------------------------------------------------- */

export type EnvioResultado = {
  id: string;
  autor_id: string;
  autor_email: string;
  autor_nome: string | null;
  /** 1 reenvio · 2 correções · 3 aprovado · 4 reprovado. */
  prioridade: number;
  status: "reservado" | "enviado" | "falha";
  erro: string | null;
  criado_em: string;
  concluido_em: string | null;
};

/**
 * A divulgação dos resultados já passou? É o que abre o envio do pôster.
 *
 * Calculado NO SERVIDOR (`resultados_divulgados()`), nunca a partir da data
 * com o relógio do navegador — mesmo motivo do `aberto` do prazo. A falha
 * devolve `null` = "não sei", que não esconde o botão: quem recusa é
 * `enviar_posteres`, com a frase certa.
 */
export async function carregarResultadosDivulgados(): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("resultados_divulgados");
  if (error || typeof data !== "boolean") return null;
  return data;
}

/**
 * O registro dos e-mails de resultado. O erro PROPAGA: quem acompanha a
 * divulgação não pode ler "nenhum enviado" por causa de uma falha de rede.
 */
export async function listarEnviosResultados(): Promise<EnvioResultado[]> {
  const { data, error } = await supabase
    .from("envios_resultados")
    .select("id, autor_id, autor_email, autor_nome, prioridade, status, erro, criado_em, concluido_em")
    .order("criado_em", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as EnvioResultado[];
}

/* ------------------------------------------------------------------
 * Revisores por trabalho (migration 20261011120000)
 * ------------------------------------------------------------------
 * Quantos revisores cada trabalho recebe (1 a 3). Não é só o alvo da
 * recomendação: o servidor usa o MESMO número como teto da associação e
 * como a quantidade de pareceres que encerra a revisão e manda o trabalho
 * para o parecer editorial. Por isso ele é gravado, e não um estado da
 * tela — com o controle em 2 e o fechamento esperando 3, o trabalho
 * ficaria em avaliação para sempre.
 *
 * Mora na linha de `configuracoes`, mas a escrita é por RPC
 * (`is_event_staff()`): a policy de UPDATE da tabela é do admin e cobre o
 * prazo de submissão junto.
 * ----------------------------------------------------------------- */

/**
 * O número em vigor. O erro PROPAGA: quem distribui não pode ver "x/3"
 * numa tela quando o servidor está cobrando 2.
 */
export async function carregarRevisoresPorTrabalho(): Promise<number> {
  const { data, error } = await supabase.rpc("revisores_por_trabalho");
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Grava o número. Mudá-lo recalcula na hora a fila do parecer editorial
 * (trigger `trg_revisores_por_trabalho`): baixar manda para lá quem já tem
 * pareceres suficientes; subir devolve à avaliação quem ainda não tem.
 * Trabalho já decidido não se move.
 */
export async function definirRevisoresPorTrabalho(n: number): Promise<number> {
  const { data, error } = await supabase.rpc("definir_revisores_por_trabalho", { _n: n });
  // `new Error`: o PostgrestError não é instância de Error, e a página
  // filtra por `instanceof Error` para mostrar a frase do banco.
  if (error) throw new Error(error.message);
  return data;
}

/* ------------------------------------------------------------------
 * Arquivos para download (migration 20260830120000)
 * ------------------------------------------------------------------
 * Eram 8 colunas `link_*` em `configuracoes` mais uma lista fixa em
 * `src/lib/downloads.ts`: publicar um arquivo novo exigia migration,
 * código e deploy. Agora são linhas de `arquivos_download`, editadas em
 * /co-chairs/downloads — a tela saiu de /admin/configuracoes na
 * 20260909120000, e a policy de escrita foi junto (`is_app_admin()` ->
 * `is_event_staff()`). Quem escreve daqui para frente é a organização
 * do congresso; o admin continua dentro, porque `is_event_staff()` é
 * admin OU avaliador.
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
 * A mesma lista pela TABELA, para a tela de edição: ela precisa da
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
