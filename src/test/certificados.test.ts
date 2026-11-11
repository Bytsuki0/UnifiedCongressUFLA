import { describe, expect, it } from "vitest";
import {
  ajustarTexto,
  estadoDoModelo,
  familiaDaFonte,
  nomeDoArquivo,
  quebrarLinha,
  substituirVariaveis,
  type Medir,
} from "@/lib/certificados";

// Cada caractere mede `px` de largura; negrito mede o dobro.
const medir: Medir = (texto, estilo, px) => texto.length * px * (estilo.negrito ? 2 : 1);
const simples = (texto: string) => ({ texto, negrito: false, italico: false });
const escrito = (linhas: { texto: string }[][]) => linhas.map((l) => l.map((t) => t.texto).join(""));

describe("substituirVariaveis", () => {
  it("troca as conhecidas e deixa a desconhecida escrita", () => {
    expect(substituirVariaveis("{titulo} de {autores} em {nada}", { titulo: "X", autores: "A e B" })).toBe(
      "X de A e B em {nada}",
    );
  });
});

describe("quebrarLinha", () => {
  it("quebra para baixo, só em espaço", () => {
    expect(escrito(quebrarLinha([simples("aaa bbb ccc")], 7, 1, medir))).toEqual(["aaa bbb", "ccc"]);
  });

  it("palavra maior que a caixa fica inteira na própria linha", () => {
    expect(escrito(quebrarLinha([simples("a bbbbbbbbbb c")], 4, 1, medir))).toEqual(["a", "bbbbbbbbbb", "c"]);
  });

  it("não quebra entre trechos colados sem espaço", () => {
    const linhas = quebrarLinha([simples("ab"), { texto: "cd", negrito: true, italico: false }], 3, 1, medir);
    expect(escrito(linhas)).toEqual(["abcd"]);
  });
});

describe("ajustarTexto", () => {
  it("mantém o tamanho quando cabe", () => {
    const r = ajustarTexto("oi {nome}", { nome: "Ana" }, 100, 100, 10, medir);
    expect(r.encolheu).toBe(false);
    expect(r.px).toBe(10);
    expect(escrito(r.linhas)).toEqual(["oi Ana"]);
  });

  it("encolhe a fonte até caber na altura", () => {
    const longo = Array(20).fill("palavra").join(" ");
    const r = ajustarTexto(longo, {}, 200, 60, 10, medir);
    expect(r.encolheu).toBe(true);
    expect(r.px).toBeLessThan(10);
    expect(r.linhas.length * r.px * 1.25).toBeLessThanOrEqual(60);
  });

  it("encolhe quando uma palavra sozinha estoura a largura", () => {
    const r = ajustarTexto("abcdefghij", {}, 80, 100, 10, medir);
    expect(r.encolheu).toBe(true);
    expect(10 * r.px).toBeLessThanOrEqual(80);
  });

  it("asterisco vindo de variável não vira formatação", () => {
    const r = ajustarTexto("**{titulo}**", { titulo: "a *b* c" }, 1000, 100, 10, medir);
    expect(escrito(r.linhas)).toEqual(["a *b* c"]);
    expect(r.linhas[0].every((t) => t.negrito && !t.italico)).toBe(true);
  });

  it("respeita a quebra de linha digitada", () => {
    expect(escrito(ajustarTexto("um\ndois", {}, 1000, 100, 10, medir).linhas)).toEqual(["um", "dois"]);
  });
});

describe("apoio", () => {
  it("família da fonte enviada sai do nome do arquivo", () => {
    expect(familiaDaFonte("fontes/Minha Fonte.ttf")).toBe("Minha Fonte");
    expect(familiaDaFonte("Georgia")).toBe("Georgia");
  });

  it("nome do arquivo sem acento nem símbolo", () => {
    expect(nomeDoArquivo("base", { titulo: "Avaliação: café & pão" })).toBe(
      "certificado-base-Avaliacao-cafe-pao.png",
    );
  });

  it("estado do modelo: a trava vale mesmo com a data no futuro", () => {
    expect(estadoDoModelo(undefined, true)).toBe("rascunho");
    expect(estadoDoModelo({ publicado_em: "x", liberado_em: null }, false)).toBe("aguardando");
    expect(estadoDoModelo({ publicado_em: "x", liberado_em: null }, true)).toBe("liberado");
    expect(estadoDoModelo({ publicado_em: "x", liberado_em: "y" }, false)).toBe("liberado");
  });
});
