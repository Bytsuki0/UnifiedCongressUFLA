import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cronograma de apresentações (migration 20261104120000) — o lado cliente.
 *
 * Quem entra no cronograma, o que é público e quem recebe e-mail é o SQL
 * (provado por sql/ensaio-apresentacoes.sql). O que fica preso aqui:
 *
 *   1. **O espelho da régua do e-mail** (`calcularMudancas`): é o número que
 *      o diálogo de confirmação do AdminCA mostra ANTES de o e-mail sair.
 *      Agendado agora, agenda alterada ou tipo da categoria alterado conta;
 *      salvar sem mudar nada, não; remover sai sem e-mail.
 *   2. **Dia e hora ficam texto**: o rótulo do dia não escorrega para a
 *      véspera no fuso de Lavras, e os segundos do `time` do Postgres não
 *      fazem uma agenda igual parecer alterada.
 *   3. **O selo do e-mail** espelha a fila: na fila, ou abandonado depois de
 *      3 falhas desde o último Salvar.
 *   4. **O service**: a janela pública falha calada (a landing não cai), e
 *      a recusa do Salvar sobe como `Error` com a frase do banco.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

import {
  AGENDA_VAZIA,
  avisoPendente,
  calcularMudancas,
  dataDeBr,
  estadoLinha,
  hora,
  horaDe,
  importarCsvAgenda,
  linhasCsv,
  rotuloData,
  rotuloHorario,
  ultimoEnvioPorTrabalho,
  type Agenda,
  type EnvioApresentacao,
} from "@/lib/apresentacoes";
import {
  carregarAdminCA,
  carregarApresentacoesPublicas,
  salvarCronogramaApresentacoes,
} from "@/services/apresentacoesService";

const AGENDA: Agenda = { data: "2026-11-20", hora_inicio: "14:00", hora_fim: "14:15", sala: "Sala 1" };

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

describe("rótulos de dia e horário", () => {
  it("tira os segundos do time do Postgres", () => {
    expect(hora("14:00:00")).toBe("14:00");
    expect(rotuloHorario("14:00:00", "14:15:00")).toBe("14:00 às 14:15");
  });

  it("não escorrega o dia para a véspera por causa do fuso", () => {
    // `new Date("2026-08-01")` em UTC-3 cairia em 31 de julho.
    expect(rotuloData("2026-08-01")).toBe("1 de agosto de 2026");
  });
});

describe("estadoLinha", () => {
  it("separa vazia de removida pelo que estava gravado", () => {
    expect(estadoLinha(undefined, AGENDA_VAZIA)).toBe("vazia");
    expect(estadoLinha(AGENDA, AGENDA_VAZIA)).toBe("removida");
  });

  it("agenda nova e agenda alterada", () => {
    expect(estadoLinha(undefined, AGENDA)).toBe("nova");
    expect(estadoLinha(AGENDA, { ...AGENDA, sala: "Sala 2" })).toBe("alterada");
    expect(estadoLinha(AGENDA, { ...AGENDA, data: "2026-11-21" })).toBe("alterada");
  });

  it("compara como o servidor: sem os segundos e com a sala aparada", () => {
    expect(estadoLinha({ ...AGENDA, hora_inicio: "14:00:00" }, { ...AGENDA, sala: " Sala 1 " })).toBe("igual");
  });

  it("recusa a linha pela metade e o horário invertido", () => {
    expect(estadoLinha(undefined, { ...AGENDA, sala: "  " })).toBe("incompleta");
    expect(estadoLinha(AGENDA, { ...AGENDA, hora_fim: "" })).toBe("incompleta");
    expect(estadoLinha(undefined, { ...AGENDA, hora_fim: "13:59" })).toBe("horario_invertido");
    // Fim igual ao início também: o CHECK é `hora_fim > hora_inicio`.
    expect(estadoLinha(undefined, { ...AGENDA, hora_fim: "14:00" })).toBe("horario_invertido");
  });
});

describe("calcularMudancas — o espelho da régua do e-mail", () => {
  const base = {
    categoriaDe: { t1: "c1", t2: "c1", t3: "c2", t4: "c1" } as Record<string, string | null>,
    tiposGravados: { c1: "Pôster", c2: "" },
  };

  it("salvar sem mudar nada não manda nada", () => {
    const m = calcularMudancas({
      ...base,
      gravadas: { t1: AGENDA },
      editadas: { t1: { ...AGENDA, hora_inicio: "14:00:00" }, t2: AGENDA_VAZIA },
      tiposEditados: { c1: " Pôster ", c2: "" },
    });
    expect(m).toEqual({ itens: [], tipos: [], avisados: [], removidos: [], invalidos: [] });
  });

  it("nova e alterada vão para a fila; removida sai sem e-mail; pela metade trava", () => {
    const m = calcularMudancas({
      ...base,
      gravadas: { t1: AGENDA, t2: AGENDA },
      editadas: {
        t1: { ...AGENDA, sala: " Sala 2 " },
        t2: AGENDA_VAZIA,
        t3: { data: "2026-11-21", hora_inicio: "09:00", hora_fim: "09:20", sala: "Auditório" },
        t4: { ...AGENDA, sala: "" },
      },
      tiposEditados: { c1: "Pôster", c2: "" },
    });
    expect(m.avisados.sort()).toEqual(["t1", "t3"]);
    expect(m.removidos).toEqual(["t2"]);
    expect(m.invalidos).toEqual(["t4"]);
    // O que a RPC recebe: horas em 'HH:MM' e a sala aparada.
    expect(m.itens).toContainEqual({ trabalho_id: "t1", ...AGENDA, sala: "Sala 2" });
    expect(m.itens).toContainEqual({ trabalho_id: "t2", remover: true });
    expect(m.itens.some((i) => i.trabalho_id === "t4")).toBe(false);
  });

  it("tipo alterado avisa todo agendado da categoria — menos quem está saindo", () => {
    const m = calcularMudancas({
      ...base,
      gravadas: { t1: AGENDA, t2: AGENDA, t3: AGENDA },
      editadas: { t1: AGENDA, t2: AGENDA_VAZIA, t3: AGENDA, t4: AGENDA_VAZIA },
      tiposEditados: { c1: "  Apresentação oral ", c2: "" },
    });
    expect(m.tipos).toEqual([{ categoria_id: "c1", tipo: "Apresentação oral" }]);
    // t1 é da c1 e fica; t2 é da c1 mas sai; t3 é de outra categoria.
    expect(m.avisados).toEqual(["t1"]);
    expect(m.removidos).toEqual(["t2"]);
  });

  it("trabalho editado E com tipo alterado conta uma vez só", () => {
    const m = calcularMudancas({
      ...base,
      gravadas: { t1: AGENDA },
      editadas: { t1: { ...AGENDA, sala: "Sala 9" } },
      tiposEditados: { c1: "Oral", c2: "" },
    });
    expect(m.avisados).toEqual(["t1"]);
  });
});

describe("o selo do e-mail", () => {
  const envio = (id: string, ids: string[], status: EnvioApresentacao["status"], criado_em: string) => ({
    id,
    trabalhos_ids: ids,
    status,
    erro: status === "falha" ? "Service unavailable" : null,
    criado_em,
    concluido_em: null,
  });

  it("o envio mais recente de cada trabalho é o que vale", () => {
    const ultimo = ultimoEnvioPorTrabalho([
      envio("e1", ["t1", "t2"], "enviado", "2026-11-04T10:00:00+00:00"),
      envio("e2", ["t1"], "falha", "2026-11-04T11:00:00+00:00"),
    ]);
    expect(ultimo.get("t1")?.id).toBe("e2");
    expect(ultimo.get("t2")?.id).toBe("e1");
  });

  it("na fila, até 3 falhas desde o último Salvar", () => {
    const solicitado = "2026-11-04T10:00:00+00:00";
    const na = { aviso_solicitado_em: solicitado, aviso_reservado_em: null };
    expect(avisoPendente({ aviso_solicitado_em: null, aviso_reservado_em: null }, [])).toBeNull();
    expect(avisoPendente({ aviso_solicitado_em: solicitado, aviso_reservado_em: solicitado }, [])).toBeNull();
    expect(avisoPendente(na, [])).toBe("na_fila");

    const falhas = [1, 2, 3].map((i) => envio(`f${i}`, ["t1"], "falha", `2026-11-04T10:0${i}:00+00:00`));
    expect(avisoPendente(na, falhas.slice(0, 2))).toBe("na_fila");
    expect(avisoPendente(na, falhas)).toBe("desistiu");
    // Falha de ANTES do último Salvar não conta: salvar de novo recomeça.
    expect(avisoPendente({ ...na, aviso_solicitado_em: "2026-11-04T11:00:00+00:00" }, falhas)).toBe("na_fila");
  });
});

describe("apresentacoesService", () => {
  it("a janela pública falha calada: a landing não pode cair por ela", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(carregarApresentacoesPublicas()).resolves.toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledWith("apresentacoes_publicas");
  });

  it("o Salvar manda tipos e itens numa chamada e devolve quantos vão ser avisados", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const tipos = [{ categoria_id: "c1", tipo: "Pôster" }];
    const itens = [{ trabalho_id: "t1", ...AGENDA }, { trabalho_id: "t2", remover: true as const }];
    await expect(salvarCronogramaApresentacoes(tipos, itens)).resolves.toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("salvar_cronograma_apresentacoes", {
      _tipos: tipos,
      _apresentacoes: itens,
    });
  });

  it("a recusa do banco sobe como Error, com a frase dele", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: '"Trabalho X" não está aprovado: só trabalhos aprovados entram no cronograma de apresentações.' },
    });
    await expect(salvarCronogramaApresentacoes([], [])).rejects.toThrow(/Trabalho X" não está aprovado/);
  });

  it("o AdminCA só lista trabalho aprovado — inclusive com correções", async () => {
    const chamadas: { tabela: string; metodo: string; args: unknown[] }[] = [];
    mocks.from.mockImplementation((tabela: string) => {
      const resposta = { data: [], error: null };
      const cadeia: Record<string, unknown> = {};
      for (const metodo of ["select", "in", "order", "limit"]) {
        cadeia[metodo] = (...args: unknown[]) => {
          chamadas.push({ tabela, metodo, args });
          return cadeia;
        };
      }
      cadeia.then = (ok: (v: typeof resposta) => unknown) => Promise.resolve(resposta).then(ok);
      return cadeia;
    });

    await carregarAdminCA();
    expect(chamadas).toContainEqual({
      tabela: "trabalhos",
      metodo: "in",
      args: ["status", ["aprovado", "aprovado_correcoes"]],
    });
  });
});

describe("importar CSV no AdminCA", () => {
  it("lê `;` e `,`, aspas com o separador dentro, `\"\"` e CRLF, pulando linha em branco", () => {
    expect(linhasCsv('a;"b; c";d\r\n\r\n"diz ""oi""";e')).toEqual([
      { numero: 1, campos: ["a", "b; c", "d"] },
      { numero: 3, campos: ['diz "oi"', "e"] },
    ]);
    // O BOM do "CSV UTF-8" do Excel não pode grudar no 1º título.
    expect(linhasCsv(String.fromCharCode(0xfeff) + "Hortas;x")).toEqual([{ numero: 1, campos: ["Hortas", "x"] }]);
    expect(linhasCsv('"Café, clima",20/11/2026\n')).toEqual([
      { numero: 1, campos: ["Café, clima", "20/11/2026"] },
    ]);
  });

  it("converte o dia DD/MM/AAAA sem passar por new Date, e recusa dia que não existe", () => {
    expect(dataDeBr("5/11/2026")).toBe("2026-11-05");
    expect(dataDeBr(" 20/11/2026 ")).toBe("2026-11-20");
    expect(dataDeBr("31/02/2026")).toBeNull();
    expect(dataDeBr("2026-11-20")).toBeNull();
  });

  it("aceita hora 24h com ou sem segundos e recusa fora da faixa", () => {
    expect(horaDe("9:05")).toBe("09:05");
    expect(horaDe("14:00:00")).toBe("14:00");
    expect(horaDe("24:00")).toBeNull();
    expect(horaDe("14:60")).toBeNull();
    expect(horaDe("2pm")).toBeNull();
  });

  const TRABALHOS = [
    { id: "t1", titulo: "Robótica na Escola" },
    { id: "t2", titulo: "Café e clima" },
    { id: "t3", titulo: "Hortas" },
    { id: "t4", titulo: "hortas " },
  ];

  it("casa pelo título sem acento, caixa ou espaço sobrando, e pula o cabeçalho", () => {
    const csv = [
      "Título;Dia;Início;Fim;Sala",
      "  robotica   na escola ;20/11/2026;14:00;14:15; Sala 101 ",
    ].join("\n");
    expect(importarCsvAgenda(csv, TRABALHOS)).toEqual({
      agendas: { t1: { data: "2026-11-20", hora_inicio: "14:00", hora_fim: "14:15", sala: "Sala 101" } },
      pendentes: [],
    });
  });

  it("o que não casa ou não presta volta para a mão, com o motivo e a linha do arquivo", () => {
    const csv = [
      "Título inexistente;20/11/2026;14:00;14:15;Sala 1",
      "Hortas;20/11/2026;14:00;14:15;Sala 1",
      "Café e clima;31/02/2026;14:00;14:15;Sala 1",
      "Café e clima;20/11/2026;14:00;14:15;Sala 1",
      "Robótica na escola;20/11/2026;25:00;14:15;Sala 1",
    ].join("\n");
    const { agendas, pendentes } = importarCsvAgenda(csv, TRABALHOS);
    expect(agendas).toEqual({});
    expect(pendentes).toEqual([
      { linha: 1, titulo: "Título inexistente", motivo: "título não encontrado entre os trabalhos aprovados" },
      { linha: 2, titulo: "Hortas", motivo: "título igual ao de mais de um trabalho" },
      { linha: 3, titulo: "Café e clima", motivo: "dia inválido (use DD/MM/AAAA)" },
      // A 1ª linha do mesmo título era inválida: não dá para saber qual das duas valia.
      { linha: 4, titulo: "Café e clima", motivo: "título repetido no CSV" },
      { linha: 5, titulo: "Robótica na escola", motivo: "horário inválido (use HH:MM, 24h)" },
    ]);
  });

  it("sala vazia ou acima do CHECK do banco não entra — derrubaria o lote no Salvar", () => {
    const csv = ["Café e clima;20/11/2026;14:00;14:15;  ", `Robótica na escola;20/11/2026;14:00;14:15;${"x".repeat(121)}`].join("\n");
    expect(importarCsvAgenda(csv, TRABALHOS).pendentes.map((p) => p.motivo)).toEqual([
      "sala vazia",
      "sala com mais de 120 caracteres",
    ]);
  });
});
