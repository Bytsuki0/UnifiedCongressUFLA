import { describe, expect, it } from "vitest";
import {
  chaveDia,
  corDoTexto,
  diasNoPeriodo,
  estadoDoPeriodo,
  rotuloDia,
  rotuloPeriodo,
} from "@/lib/cronograma";

/**
 * As datas do cronograma, agora que ele é uma LISTA de períodos.
 *
 * O que estes testes protegem, acima de tudo, é a regra de NÃO passar
 * 'AAAA-MM-DD' por `new Date(...)`: a string sem hora é lida como UTC e,
 * no fuso de Lavras, o dia 1 vira o dia 31 do mês anterior. Uma
 * "simplificação" que troque a leitura por `new Date(chave).getDate()`
 * passa em qualquer inspeção visual feita em UTC e quebra em produção —
 * daí o teste. `diasNoPeriodo` é o único que toca `Date`, e só por
 * `Date.UTC`, que é estável em qualquer fuso.
 */

describe("chaveDia", () => {
  it("preenche mês e dia com zero à esquerda", () => {
    expect(chaveDia(2026, 8, 1)).toBe("2026-08-01");
    expect(chaveDia(2026, 12, 31)).toBe("2026-12-31");
  });
});

describe("rotuloDia", () => {
  it("escreve a data por extenso em pt-BR", () => {
    expect(rotuloDia("2026-03-15")).toBe("15 de março de 2026");
  });

  it("não escorrega para a véspera por causa do fuso", () => {
    // O caso que `new Date("2026-08-01")` erraria em UTC-3: o dia 1
    // cairia em 31 de julho.
    expect(rotuloDia("2026-08-01")).toBe("1 de agosto de 2026");
    expect(rotuloDia("2026-01-01")).toBe("1 de janeiro de 2026");
  });

  it("devolve vazio para string que não é data", () => {
    expect(rotuloDia("")).toBe("");
    expect(rotuloDia("amanhã")).toBe("");
  });
});

describe("rotuloPeriodo", () => {
  it("mostra uma data só quando começa e termina no mesmo dia", () => {
    expect(rotuloPeriodo("2026-08-12", "2026-08-12")).toBe("12 de agosto de 2026");
  });

  it("trata término vazio como data única", () => {
    expect(rotuloPeriodo("2026-08-12", "")).toBe("12 de agosto de 2026");
  });

  it("não repete o mês nem o ano dentro do mesmo mês", () => {
    expect(rotuloPeriodo("2026-08-12", "2026-08-16")).toBe("12 a 16 de agosto de 2026");
  });

  it("repete só o mês quando o período atravessa a virada", () => {
    expect(rotuloPeriodo("2026-08-31", "2026-09-02")).toBe(
      "31 de agosto a 2 de setembro de 2026",
    );
  });

  it("escreve as duas datas inteiras quando muda o ano", () => {
    expect(rotuloPeriodo("2026-12-28", "2027-01-03")).toBe(
      "28 de dezembro de 2026 a 3 de janeiro de 2027",
    );
  });
});

describe("diasNoPeriodo", () => {
  it("conta as duas pontas", () => {
    expect(diasNoPeriodo("2026-08-12", "2026-08-12")).toBe(1);
    expect(diasNoPeriodo("2026-08-12", "2026-08-16")).toBe(5);
  });

  it("atravessa mês e ano", () => {
    expect(diasNoPeriodo("2026-08-31", "2026-09-02")).toBe(3);
    expect(diasNoPeriodo("2026-12-31", "2027-01-01")).toBe(2);
  });

  it("conhece fevereiro em ano bissexto e em ano comum", () => {
    expect(diasNoPeriodo("2026-02-28", "2026-03-01")).toBe(2);
    expect(diasNoPeriodo("2028-02-28", "2028-03-01")).toBe(3);
  });
});

describe("estadoDoPeriodo", () => {
  it("separa o que vem, o que corre e o que passou", () => {
    expect(estadoDoPeriodo("2026-08-12", "2026-08-16", "2026-08-11")).toBe("futuro");
    expect(estadoDoPeriodo("2026-08-12", "2026-08-16", "2026-08-14")).toBe("andamento");
    expect(estadoDoPeriodo("2026-08-12", "2026-08-16", "2026-08-17")).toBe("encerrado");
  });

  it("inclui as duas pontas — o primeiro e o último dia estão em andamento", () => {
    // Ponta inclusiva dos dois lados, como o prazo de submissão: um
    // período "de 12 a 16" que já constasse como encerrado no dia 16
    // enganaria quem ainda tem o dia inteiro pela frente.
    expect(estadoDoPeriodo("2026-08-12", "2026-08-16", "2026-08-12")).toBe("andamento");
    expect(estadoDoPeriodo("2026-08-12", "2026-08-16", "2026-08-16")).toBe("andamento");
  });

  it("trata término vazio como data única", () => {
    expect(estadoDoPeriodo("2026-08-12", "", "2026-08-12")).toBe("andamento");
    expect(estadoDoPeriodo("2026-08-12", "", "2026-08-13")).toBe("encerrado");
  });

  it("compara por ano antes de mês e dia", () => {
    // Comparação de string só funciona porque a data é zero-padded e vem
    // do maior para o menor. Se alguém trocar o formato, isto quebra.
    expect(estadoDoPeriodo("2027-01-05", "2027-01-05", "2026-12-31")).toBe("futuro");
  });
});

describe("corDoTexto", () => {
  it("escurece o texto sobre cor clara e clareia sobre cor escura", () => {
    expect(corDoTexto("#F59E0B")).toBe("#1C1917"); // âmbar
    expect(corDoTexto("#2563EB")).toBe("#ffffff"); // azul
  });

  it("cai no branco quando a cor não é hex de 6 dígitos", () => {
    expect(corDoTexto("azul")).toBe("#ffffff");
    expect(corDoTexto("")).toBe("#ffffff");
  });
});
