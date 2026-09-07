import { describe, expect, it } from "vitest";
import {
  fatiaDaPagina,
  janelaDePaginas,
  MAX_NUMEROS,
  paginaValida,
  PITCHES_POR_PAGINA,
  totalDePaginas,
} from "@/lib/pitches";
import { idDoVideo, urlDaMiniatura } from "@/lib/youtube";

/**
 * Paginação da vitrine de pitches.
 *
 * O que se testa aqui é o tipo de coisa que erra em SILÊNCIO: uma página
 * que não existe, um vídeo que some entre a página 1 e a 2, ou uma
 * janela de números que encolhe e faz o botão andar embaixo do dedo.
 * Nada disso derruba a tela — só entrega uma vitrine incompleta.
 */

/** Uma lista de `n` pitches falsos, identificáveis pelo índice. */
const lista = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

describe("totalDePaginas", () => {
  it("arredonda para cima: 13 vídeos são 2 páginas de 12", () => {
    expect(totalDePaginas(13)).toBe(2);
    expect(totalDePaginas(12)).toBe(1);
    expect(totalDePaginas(24)).toBe(2);
    expect(totalDePaginas(25)).toBe(3);
  });

  it("lista vazia é UMA página, não zero", () => {
    // Com 0 o rodapé teria de tratar um intervalo sem números e a página
    // atual ficaria fora dele.
    expect(totalDePaginas(0)).toBe(1);
  });

  it("a página é de 12 — dois por linha, seis linhas", () => {
    expect(PITCHES_POR_PAGINA).toBe(12);
  });
});

describe("paginaValida", () => {
  it("prende ao intervalo existente", () => {
    // `?pagina=` é digitável: 99 numa lista de 3 páginas não pode dar
    // uma grade vazia sem explicação.
    expect(paginaValida(99, 3)).toBe(3);
    expect(paginaValida(-3, 3)).toBe(1);
    expect(paginaValida(0, 3)).toBe(1);
    expect(paginaValida(2, 3)).toBe(2);
  });

  it("lixo na query string vira a página 1", () => {
    // `Number("abc")` é NaN, e NaN atravessaria Math.min/Math.max intacto.
    expect(paginaValida(Number("abc"), 5)).toBe(1);
    expect(paginaValida(Number.NaN, 5)).toBe(1);
    expect(paginaValida(2.7, 5)).toBe(2);
  });
});

describe("fatiaDaPagina", () => {
  it("corta a página pedida sem repetir nem pular vídeo", () => {
    const itens = lista(30);
    const p1 = fatiaDaPagina(itens, 1);
    const p2 = fatiaDaPagina(itens, 2);
    const p3 = fatiaDaPagina(itens, 3);

    expect(p1).toHaveLength(12);
    expect(p2).toHaveLength(12);
    expect(p3).toHaveLength(6); // a última vem curta
    expect([...p1, ...p2, ...p3]).toEqual(itens);
  });

  it("página fora do intervalo cai na última, nunca em lista vazia", () => {
    const itens = lista(13);
    expect(fatiaDaPagina(itens, 99)).toEqual(fatiaDaPagina(itens, 2));
  });

  it("lista vazia devolve lista vazia", () => {
    expect(fatiaDaPagina([], 1)).toEqual([]);
  });
});

describe("janelaDePaginas", () => {
  it("mostra tudo quando cabe", () => {
    expect(janelaDePaginas(1, 4)).toEqual([1, 2, 3, 4]);
    expect(janelaDePaginas(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("centraliza a página atual quando há espaço dos dois lados", () => {
    expect(janelaDePaginas(10, 20)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });

  it("encosta nas bordas SEM encolher", () => {
    // É o ponto da função: janela que encolhe nas pontas faz os botões
    // andarem para os lados a cada clique.
    expect(janelaDePaginas(1, 20)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(janelaDePaginas(2, 20)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(janelaDePaginas(20, 20)).toEqual([14, 15, 16, 17, 18, 19, 20]);
    expect(janelaDePaginas(19, 20)).toEqual([14, 15, 16, 17, 18, 19, 20]);
  });

  it("o tamanho é sempre o mesmo enquanto houver páginas", () => {
    for (let atual = 1; atual <= 20; atual++) {
      expect(janelaDePaginas(atual, 20)).toHaveLength(MAX_NUMEROS);
    }
  });

  it("a página atual está sempre dentro da janela", () => {
    for (let atual = 1; atual <= 20; atual++) {
      expect(janelaDePaginas(atual, 20)).toContain(atual);
    }
  });

  it("nunca aponta para uma página que não existe", () => {
    for (let atual = 1; atual <= 20; atual++) {
      for (const n of janelaDePaginas(atual, 20)) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe("urlDaMiniatura", () => {
  it("monta a miniatura a partir do id do vídeo", () => {
    expect(urlDaMiniatura("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(urlDaMiniatura("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("devolve null quando não sai um id — é o que faz o cartão avisar", () => {
    // Um link de CANAL passa pelo CHECK da coluna (é do domínio do
    // YouTube) mas não tem vídeo nenhum atrás dele. O cartão precisa
    // saber disso para não desenhar um player vazio.
    expect(urlDaMiniatura("https://www.youtube.com/@ictinufla")).toBeNull();
    expect(urlDaMiniatura("")).toBeNull();
    expect(urlDaMiniatura(null)).toBeNull();
  });

  it("concorda com `idDoVideo`: as duas aceitam exatamente os mesmos links", () => {
    const links = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/@ictinufla",
      "https://vimeo.com/123456789",
      "",
    ];
    for (const link of links) {
      expect(urlDaMiniatura(link) === null).toBe(idDoVideo(link) === null);
    }
  });
});
