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

export type LinhaRanking<T> = {
  trabalho: T;
  /** Média das notas dos pareceres da rodada corrente (1 a 5); null = sem parecer. */
  revisao: number | null;
  /** Média das médias de quem avaliou ao vivo (1 a 5); null = ninguém avaliou. */
  evento: number | null;
  /** Quantos avaliaram ao vivo. */
  avaliacoes: number;
  /** Metade da revisão + metade do evento. A metade que ainda não existe vale 0. */
  pontos: number;
};

const mediaDe = (ns: number[] | undefined) =>
  ns?.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null;

/**
 * Os pontos de cada trabalho — metade da revisão (/revisor), metade da
 * avaliação ao vivo (/avaliacao), as duas na escala 1 a 5 — por categoria
 * (chave "" = sem categoria). Entra todo trabalho recebido: quem decide o
 * universo é o chamador.
 *
 * A revisão é a mesma média que o autor recebe por e-mail
 * (`resultados_devidos`): todos os `itens[].nota` dos pareceres da RODADA
 * CORRENTE, nota que não é número fora. Empate: mais avaliações ao vivo na
 * frente, depois o título — nada que dependa da ordem do request.
 */
export function rankingPorCategoria<
  T extends { id: string; titulo: string; categoria_id: string | null; rodada: number },
>(
  pareceres: { trabalho_id: string; rodada: number; itens: unknown }[],
  avaliacoes: { trabalho_id: string; media: number }[],
  trabalhos: T[],
): Record<string, LinhaRanking<T>[]> {
  const rodada = new Map(trabalhos.map((t) => [t.id, t.rodada]));
  const revisao: Record<string, number[]> = {};
  for (const p of pareceres) {
    if (p.rodada !== rodada.get(p.trabalho_id) || !Array.isArray(p.itens)) continue;
    for (const i of p.itens) {
      // parseFloat e não Number: Number(null) e Number("") seriam 0, não "sem nota".
      const n = parseFloat(String(i?.nota));
      if (Number.isFinite(n)) (revisao[p.trabalho_id] ??= []).push(n);
    }
  }
  const evento: Record<string, number[]> = {};
  for (const a of avaliacoes) (evento[a.trabalho_id] ??= []).push(Number(a.media));

  const porCategoria: Record<string, LinhaRanking<T>[]> = {};
  for (const t of trabalhos) {
    const r = mediaDe(revisao[t.id]);
    const e = mediaDe(evento[t.id]);
    (porCategoria[t.categoria_id ?? ""] ??= []).push({
      trabalho: t,
      revisao: r,
      evento: e,
      avaliacoes: evento[t.id]?.length ?? 0,
      pontos: ((r ?? 0) + (e ?? 0)) / 2,
    });
  }
  for (const linhas of Object.values(porCategoria)) {
    linhas.sort(
      (a, b) =>
        b.pontos - a.pontos ||
        b.avaliacoes - a.avaliacoes ||
        a.trabalho.titulo.localeCompare(b.trabalho.titulo, "pt-BR"),
    );
  }
  return porCategoria;
}
