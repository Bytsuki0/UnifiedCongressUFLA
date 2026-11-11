import { supabase } from "@/integrations/supabase/client";
import {
  agruparRanking,
  type LinhaRanking,
  type MinhaAvaliacao,
  type NotaDada,
  type TrabalhoAvaliavel,
} from "@/lib/avaliacaoEvento";
import type { AnexoDoTrabalho } from "@/lib/anexos";
import type { Categoria } from "@/lib/types";
import type { Criterio } from "@/services/categoriasService";
import { listarCategorias } from "@/services/categoriasService";

/**
 * Avaliação ao vivo (/avaliacao). A escrita dos critérios é a mesma de
 * `criterios` — `salvarCriterios`/`excluirCriterio` com a tabela
 * "criterios_evento" —, então aqui só ficam as leituras e a nota.
 */

/** Critérios do evento por categoria. Serve à tela de co-chairs e ao formulário. */
export async function listarCriteriosEvento(): Promise<Record<string, Criterio[]>> {
  const { data, error } = await supabase
    .from("criterios_evento")
    .select("id, categoria_id, ordem, titulo")
    .order("ordem")
    .order("created_at");
  if (error) throw error;
  const porCategoria: Record<string, Criterio[]> = {};
  for (const c of data ?? []) {
    (porCategoria[c.categoria_id] ??= []).push({ id: c.id, ordem: c.ordem, titulo: c.titulo });
  }
  return porCategoria;
}

/**
 * O que as telas de quem avalia precisam: os trabalhos que o servidor
 * deixa avaliar e as MINHAS notas, indexadas por trabalho.
 *
 * ⚠ O `.eq("avaliador_id")` não é redundante com o RLS: a policy deixa a
 * organização ler TODAS as avaliações, e sem ele o "Minhas avaliações" de
 * um admin listaria as de todo mundo.
 */
export async function carregarAvaliacaoEvento(avaliadorId: string): Promise<{
  trabalhos: TrabalhoAvaliavel[];
  minhas: Record<string, MinhaAvaliacao>;
}> {
  const [t, a] = await Promise.all([
    supabase.rpc("trabalhos_para_avaliacao"),
    supabase
      .from("avaliacoes_evento")
      .select("trabalho_id, itens, media, updated_at")
      .eq("avaliador_id", avaliadorId),
  ]);
  if (t.error || a.error) throw t.error ?? a.error;
  return {
    trabalhos: t.data ?? [],
    minhas: Object.fromEntries(
      (a.data ?? []).map((x) => [x.trabalho_id, { ...x, itens: x.itens as NotaDada[] }]),
    ),
  };
}

/** A janela da avaliação ao vivo (migration 20261105120000). */
export type PeriodoAvaliacao = {
  abertura: string | null;
  encerramento: string | null;
  /**
   * Do SERVIDOR (`avaliacao_aberta()`). `null` = falha, "não sei": a tela
   * segue e mostra o que a fresta devolver — quem fecha é o servidor, que
   * fora da janela não devolve trabalho nenhum.
   */
  aberto: boolean | null;
  /** Hoje em Lavras segundo o servidor, para dizer "começa" ou "encerrou". */
  hoje: string;
};

export async function carregarPeriodoAvaliacao(): Promise<PeriodoAvaliacao> {
  const { data, error } = await supabase.rpc("periodo_avaliacao");
  if (error || !data || data.length === 0) {
    return { abertura: null, encerramento: null, aberto: null, hoje: "" };
  }
  return data[0];
}

/**
 * Os PDFs da submissão de um trabalho, na versão em vigor (a correção
 * sobrescreve o arquivo da exigência — não há versão antiga para escolher).
 * Nunca o pôster. Fora da janela a RPC devolve vazio.
 */
export async function listarPdfsParaAvaliacao(trabalhoId: string): Promise<AnexoDoTrabalho[]> {
  const { data, error } = await supabase.rpc("anexos_para_avaliacao", { _trabalho_id: trabalhoId });
  if (error) throw error;
  return (data ?? []) as AnexoDoTrabalho[];
}

/**
 * Dá (ou refaz) a nota. `notas` = { criterio_id: 1..5 }. Quem valida é a
 * RPC: critério faltando, nota fora da faixa, conflito de interesse e
 * trabalho fora da lista voltam como `Error` com a frase do banco.
 */
export async function avaliarTrabalhoEvento(
  trabalhoId: string,
  notas: Record<string, number>,
): Promise<void> {
  const { error } = await supabase.rpc("avaliar_trabalho_evento", {
    _trabalho_id: trabalhoId,
    _notas: notas,
  });
  if (error) throw new Error(error.message);
}

/**
 * O ranking de /co-chairs/resultados-evento. A conta é de `ranking_evento()`
 * (só a organização a lê): é a mesma que congela o pódio dos certificados.
 * As categorias vêm da tabela: categoria criada em /co-chairs/categorias
 * vira grupo sozinha.
 */
export async function carregarResultadosEvento(): Promise<{
  ranking: Record<string, LinhaRanking[]>;
  categorias: Categoria[];
}> {
  const [r, categorias] = await Promise.all([supabase.rpc("ranking_evento"), listarCategorias()]);
  if (r.error) throw r.error;
  return { ranking: agruparRanking((r.data ?? []) as LinhaRanking[]), categorias };
}
