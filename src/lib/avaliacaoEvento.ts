/**
 * Avaliação ao vivo (/avaliacao, migration 20261103120000) — o lado puro.
 *
 * Quem pode avaliar o quê é do servidor (`trabalhos_para_avaliacao()`):
 * aqui só se recorta a lista que ele devolveu e se monta o ranking.
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
const normalizar = (s: string) =>
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

export type LinhaRanking<T> = { trabalho: T; media: number; total: number };

/**
 * Média das médias de cada avaliador, por categoria (chave "" = sem
 * categoria). Só entra trabalho que recebeu nota. Empate: mais avaliações
 * na frente, depois o título — nada que dependa da ordem do request.
 */
export function rankingPorCategoria<T extends { id: string; titulo: string; categoria_id: string | null }>(
  avaliacoes: { trabalho_id: string; media: number }[],
  trabalhos: T[],
): Record<string, LinhaRanking<T>[]> {
  const notas: Record<string, number[]> = {};
  for (const a of avaliacoes) (notas[a.trabalho_id] ??= []).push(Number(a.media));

  const porCategoria: Record<string, LinhaRanking<T>[]> = {};
  for (const t of trabalhos) {
    const lista = notas[t.id];
    if (!lista) continue;
    (porCategoria[t.categoria_id ?? ""] ??= []).push({
      trabalho: t,
      media: lista.reduce((s, n) => s + n, 0) / lista.length,
      total: lista.length,
    });
  }
  for (const linhas of Object.values(porCategoria)) {
    linhas.sort(
      (a, b) =>
        b.media - a.media || b.total - a.total || a.trabalho.titulo.localeCompare(b.trabalho.titulo, "pt-BR"),
    );
  }
  return porCategoria;
}
