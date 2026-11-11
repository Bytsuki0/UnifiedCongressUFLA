/**
 * Avaliação ao vivo (/avaliacao, migration 20261103120000) — o lado puro.
 *
 * Quem pode avaliar o quê é do servidor (`trabalhos_para_avaliacao()`):
 * aqui só se recorta a lista que ele devolveu e se agrupa o ranking.
 */

/** Um trabalho como `trabalhos_para_avaliacao()` o devolve. */
export type TrabalhoAvaliavel = {
  id: string;
  titulo: string;
  autores: string;
  categoria_id: string | null;
  em_conflito: boolean;
};

/** Um item de `avaliacoes_evento.itens`: o título é cópia do critério. */
export type NotaDada = { criterio_id: string; titulo: string; nota: number };

export type MinhaAvaliacao = {
  trabalho_id: string;
  itens: NotaDada[];
  media: number;
  updated_at: string;
};

// Sem isto, "joao" nunca acharia "João" — e a busca é por nome de autor.
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Categoria vazia = todas; termo procura no título e nos autores. */
export function filtrarTrabalhos<T extends { titulo: string; autores: string; categoria_id: string | null }>(
  lista: T[],
  filtro: { categoriaId: string; termo: string },
): T[] {
  const termo = normalizar(filtro.termo.trim());
  return lista.filter(
    (t) =>
      (!filtro.categoriaId || t.categoria_id === filtro.categoriaId) &&
      (!termo || normalizar(`${t.titulo} ${t.autores}`).includes(termo)),
  );
}

/**
 * Uma linha de `ranking_evento()` (migration 20261111120000). A conta é do
 * SERVIDOR — é dela que sai o pódio congelado dos certificados, e duas
 * contas discordariam. Pontos = metade da revisão + metade do ao vivo (a
 * metade que não existe vale 0); empate: maior nota AO VIVO, depois mais
 * avaliações ao vivo, depois o título.
 */
export type LinhaRanking = {
  trabalho_id: string;
  categoria_id: string | null;
  titulo: string;
  autores: string;
  /** Média das notas dos pareceres da rodada corrente (1 a 5); null = sem parecer. */
  revisao: number | null;
  /** Média das médias de quem avaliou ao vivo (1 a 5); null = ninguém avaliou. */
  evento: number | null;
  avaliacoes: number;
  pontos: number;
  /** Posição dentro da categoria, já com o desempate. */
  posicao: number;
};

/** As linhas por categoria (chave "" = sem categoria), na ordem da posição. */
export function agruparRanking(linhas: LinhaRanking[]): Record<string, LinhaRanking[]> {
  const porCategoria: Record<string, LinhaRanking[]> = {};
  for (const l of [...linhas].sort((a, b) => a.posicao - b.posicao)) {
    (porCategoria[l.categoria_id ?? ""] ??= []).push(l);
  }
  return porCategoria;
}
