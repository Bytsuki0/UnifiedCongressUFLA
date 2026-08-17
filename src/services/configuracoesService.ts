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
  link_template_word: string;
  link_template_latex: string;
  link_template_slides: string;
  link_normas_formatacao: string;
  link_edital_congresso: string;
  link_manual_revisor: string;
  link_diretrizes_avaliacao: string;
  link_codigo_etica: string;
  atualizado_em: string;
};

/**
 * Os links de download que a organização cadastra no painel admin —
 * o subconjunto de `Configuracoes` que a RPC `links_downloads()` expõe
 * publicamente (migration 20260817120000).
 */
export type LinksDownloads = Pick<
  Configuracoes,
  | "link_template_word"
  | "link_template_latex"
  | "link_template_slides"
  | "link_normas_formatacao"
  | "link_edital_congresso"
  | "link_manual_revisor"
  | "link_diretrizes_avaliacao"
  | "link_codigo_etica"
>;

/** Nenhum link configurado — o estado em que a interface desabilita os botões. */
export const LINKS_VAZIOS: LinksDownloads = {
  link_template_word: "",
  link_template_latex: "",
  link_template_slides: "",
  link_normas_formatacao: "",
  link_edital_congresso: "",
  link_manual_revisor: "",
  link_diretrizes_avaliacao: "",
  link_codigo_etica: "",
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

/**
 * Links de download da organização. Chamada por páginas PÚBLICAS
 * (landing e /login), por isso vem da RPC `links_downloads()`, aberta a
 * `anon` — a tabela `configuracoes` continua fechada.
 *
 * Falha devolve tudo vazio, ao contrário do prazo, que falha aberto. São
 * invariantes opostas pelo mesmo motivo: aqui o "não sei" seguro é o
 * botão desabilitado. Mandar o usuário para um link que não existe é
 * pior do que dizer que o link ainda não foi configurado.
 */
export async function carregarLinksDownloads(): Promise<LinksDownloads> {
  const { data, error } = await supabase.rpc("links_downloads");
  if (error || !data || data.length === 0) return LINKS_VAZIOS;
  // Espalha sobre LINKS_VAZIOS para que uma chave ausente na resposta
  // vire "" (botão desabilitado) em vez de `undefined` no href.
  return { ...LINKS_VAZIOS, ...data[0] };
}
