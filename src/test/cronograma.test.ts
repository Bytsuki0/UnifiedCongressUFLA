import { describe, expect, it } from "vitest";
import {
  chaveDia,
  corDoTexto,
  diasNoMes,
  gradeDoMes,
  marcacoesDoMes,
  marcacoesPorDia,
  primeiroDiaSemana,
  rotuloDiaCurto,
  rotuloMes,
} from "@/lib/cronograma";
import type { MarcacaoCronograma } from "@/services/cronogramaService";

/**
 * A aritmética do calendário do cronograma.
 *
 * O que estes testes protegem, acima de tudo, é a regra de NÃO passar
 * 'AAAA-MM-DD' por `new Date(...)`: a string sem hora é lida como UTC e,
 * no fuso de Lavras, o dia 1 vira o dia 31 do mês anterior. Uma
 * "simplificação" que troque os helpers por `new Date(chave)` passa em
 * qualquer inspeção visual feita em UTC e quebra em produção — daí o
 * teste.
 */

const marcacao = (
  id: string,
  dias: string[],
  extra: Partial<MarcacaoCronograma> = {},
): MarcacaoCronograma => ({
  id,
  titulo: `Evento ${id}`,
  descricao: "",
  cor: "#2563EB",
  dias,
  ...extra,
});

describe("chaveDia", () => {
  it("preenche mês e dia com zero à esquerda", () => {
    expect(chaveDia(2026, 8, 1)).toBe("2026-08-01");
    expect(chaveDia(2026, 12, 31)).toBe("2026-12-31");
  });
});

describe("diasNoMes", () => {
  it("conhece os meses de 30 e 31 dias", () => {
    expect(diasNoMes(2026, 8)).toBe(31);
    expect(diasNoMes(2026, 9)).toBe(30);
  });

  it("acerta fevereiro em ano bissexto e em ano comum", () => {
    expect(diasNoMes(2026, 2)).toBe(28);
    expect(diasNoMes(2028, 2)).toBe(29);
  });
});

describe("primeiroDiaSemana", () => {
  it("devolve o dia da semana do dia 1 (0 = domingo)", () => {
    // 1º de agosto de 2026 é um sábado.
    expect(primeiroDiaSemana(2026, 8)).toBe(6);
    // 1º de setembro de 2026 é uma terça.
    expect(primeiroDiaSemana(2026, 9)).toBe(2);
  });

  it("não escorrega para o mês anterior por causa do fuso", () => {
    // O caso que `new Date("2026-08-01")` erraria em UTC-3: o dia 1
    // cairia na véspera, e a grade inteira sairia deslocada uma casa.
    expect(primeiroDiaSemana(2026, 1)).toBe(4); // 01/01/2026 é quinta
  });
});

describe("gradeDoMes", () => {
  it("fecha em semanas inteiras de 7 casas", () => {
    for (const mes of [1, 2, 8, 9, 12]) {
      expect(gradeDoMes(2026, mes).length % 7).toBe(0);
    }
  });

  it("põe o dia 1 na coluna certa e nada antes dele", () => {
    const grade = gradeDoMes(2026, 8); // começa no sábado (índice 6)
    expect(grade.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(grade[6]).toBe(1);
  });

  it("mantém todos os dias do mês, sem repetir nem pular", () => {
    const dias = gradeDoMes(2026, 9).filter((d): d is number => d !== null);
    expect(dias).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
});

describe("marcacoesPorDia", () => {
  it("indexa por dia e preserva a ordem de chegada", () => {
    const mapa = marcacoesPorDia([
      marcacao("a", ["2026-08-10", "2026-08-11"]),
      marcacao("b", ["2026-08-11"]),
    ]);

    expect(mapa["2026-08-10"].map((m) => m.id)).toEqual(["a"]);
    // Dia com duas marcações: a primeira é a que dá a cor de fundo da
    // casa, então a ordem não pode ser embaralhada.
    expect(mapa["2026-08-11"].map((m) => m.id)).toEqual(["a", "b"]);
    expect(mapa["2026-08-12"]).toBeUndefined();
  });
});

describe("marcacoesDoMes", () => {
  it("inclui a marcação que toca o mês, mesmo atravessando a virada", () => {
    const atravessa = marcacao("a", ["2026-08-31", "2026-09-01"]);
    const outra = marcacao("b", ["2026-10-05"]);

    expect(marcacoesDoMes([atravessa, outra], { ano: 2026, mes: 8 }).map((m) => m.id)).toEqual(["a"]);
    expect(marcacoesDoMes([atravessa, outra], { ano: 2026, mes: 9 }).map((m) => m.id)).toEqual(["a"]);
    expect(marcacoesDoMes([atravessa, outra], { ano: 2026, mes: 10 }).map((m) => m.id)).toEqual(["b"]);
  });

  it("não confunde meses de anos diferentes", () => {
    const lista = [marcacao("a", ["2027-08-10"])];
    expect(marcacoesDoMes(lista, { ano: 2026, mes: 8 })).toEqual([]);
  });
});

describe("rótulos", () => {
  it("nomeia o mês e o dia em pt-BR", () => {
    expect(rotuloMes({ ano: 2026, mes: 8 })).toBe("Agosto de 2026");
    expect(rotuloDiaCurto("2026-08-01")).toBe("1 de agosto");
    expect(rotuloDiaCurto("2026-03-15")).toBe("15 de março");
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
