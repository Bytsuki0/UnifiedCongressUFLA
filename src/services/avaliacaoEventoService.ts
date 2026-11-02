import { supabase } from "@/integrations/supabase/client";
import {
  rankingPorCategoria,
  type LinhaRanking,
  type MinhaAvaliacao,
  type NotaDada,
  type TrabalhoAvaliavel,
} from "@/lib/avaliacaoEvento";
import type { Categoria, Trabalho } from "@/lib/types";
import type { Criterio } from "@/services/categoriasService";
import { listarTrabalhosComCategorias } from "@/services/trabalhosService";

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

/** O ranking de /co-chairs/resultados-evento. A RLS só deixa a organização ler tudo. */
export async function carregarResultadosEvento(): Promise<{
  ranking: Record<string, LinhaRanking<Trabalho>[]>;
  categorias: Categoria[];
}> {
  // ponytail: sem paginação — o PostgREST corta em 1000 linhas; passar disso
  // (trabalhos × avaliadores) pede a média agregada numa RPC.
  const [a, { trabalhos, categorias }] = await Promise.all([
    supabase.from("avaliacoes_evento").select("trabalho_id, media"),
    listarTrabalhosComCategorias(),
  ]);
  if (a.error) throw a.error;
  return { ranking: rankingPorCategoria(a.data ?? [], trabalhos), categorias };
}
