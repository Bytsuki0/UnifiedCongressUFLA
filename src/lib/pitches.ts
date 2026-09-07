/**
 * Paginação da vitrine de pitches — a parte pura.
 *
 * A grade é de DOIS vídeos por linha e SEIS linhas, então a página tem
 * doze. O número não é arbitrário nem só estético: um `<iframe>` do
 * YouTube por cartão custa caro, e é a paginação que impede a vitrine de
 * abrir cem players de uma vez. (A grade mostra miniatura e só troca pelo
 * player no clique — ver `urlDaMiniatura` —, mas mesmo assim são cem
 * imagens de terceiro.)
 *
 * As funções ficam aqui, fora do componente, por dois motivos: um .tsx só
 * pode exportar componentes (`react-refresh/only-export-components`), e a
 * regra da janela de páginas é o tipo de coisa que erra em silêncio — a
 * página some do rodapé, ou aparece uma página vazia no fim. Teste em
 * `src/test/pitches.test.ts`.
 *
 * ⚠ Paginar no CLIENTE é decisão consciente. `pitches_publicos()` devolve
 * a lista inteira numa requisição e a troca de página não vai à rede:
 * nenhum pisca-pisca, nenhum estado de carregamento entre a página 1 e a
 * 2, e — o que mais importa — nenhuma chance de a ordem mudar no meio da
 * navegação e um vídeo pular de página. Uma lista de congresso é da ordem
 * de dezenas ou centenas de linhas de texto; no dia em que passar de uns
 * milhares, o corte vira LIMIT/OFFSET na RPC e a ordem estável que ela já
 * garante é o que torna isso possível sem reescrever a tela.
 */

/** 2 por linha × 6 linhas. Muda aqui e a grade inteira acompanha. */
export const PITCHES_POR_PAGINA = 12;

/**
 * Quantas páginas a lista ocupa. Lista vazia devolve 1, e não 0: a tela
 * sempre está "na página 1", mesmo que a página 1 esteja vazia — com 0 o
 * rodapé teria de tratar um intervalo sem números e a página atual ficaria
 * fora dele.
 */
export function totalDePaginas(total: number, porPagina = PITCHES_POR_PAGINA): number {
  return Math.max(1, Math.ceil(total / porPagina));
}

/**
 * Prende a página ao intervalo existente. A página vem da URL
 * (`?pagina=`), onde qualquer um pode digitar 99 ou -3; sem isto a grade
 * ficaria vazia sem explicar por quê.
 */
export function paginaValida(pagina: number, totalPaginas: number): number {
  if (!Number.isFinite(pagina)) return 1;
  return Math.min(Math.max(Math.trunc(pagina), 1), Math.max(1, totalPaginas));
}

/** Os itens de uma página. A página já entra validada. */
export function fatiaDaPagina<T>(
  itens: T[],
  pagina: number,
  porPagina = PITCHES_POR_PAGINA,
): T[] {
  const inicio = (paginaValida(pagina, totalDePaginas(itens.length, porPagina)) - 1) * porPagina;
  return itens.slice(inicio, inicio + porPagina);
}

/** Quantos números de página cabem no rodapé antes de ele virar uma régua. */
export const MAX_NUMEROS = 7;

/**
 * Os números que o rodapé desenha, no estilo da busca do Google: uma
 * janela deslizante em volta da página atual, sempre do mesmo tamanho
 * enquanto houver páginas suficientes.
 *
 * Manter o tamanho fixo é o ponto — uma janela que encolhe nas pontas faz
 * os botões andarem para os lados a cada clique, e o alvo do "próxima"
 * muda de lugar embaixo do dedo.
 */
export function janelaDePaginas(
  paginaAtual: number,
  totalPaginas: number,
  maximo = MAX_NUMEROS,
): number[] {
  const total = Math.max(1, totalPaginas);
  const atual = paginaValida(paginaAtual, total);

  if (total <= maximo) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  // Centraliza e depois encosta na borda: nas primeiras e nas últimas
  // páginas a janela não tem para onde deslizar, e é aí que o tamanho
  // fixo precisa ser preservado empurrando para dentro.
  const meio = Math.floor(maximo / 2);
  const inicio = Math.min(Math.max(atual - meio, 1), total - maximo + 1);

  return Array.from({ length: maximo }, (_, i) => inicio + i);
}
