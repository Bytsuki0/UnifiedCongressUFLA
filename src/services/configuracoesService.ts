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
