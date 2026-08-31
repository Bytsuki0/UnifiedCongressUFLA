import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prazo de submissão — o lado cliente.
 *
 * Duas invariantes moram aqui, e as duas já têm história no projeto:
 *
 * 1. `aberto` vem do SERVIDOR e nunca é recalculado a partir das datas.
 *    O navegador tem relógio próprio (e fuso próprio): recalcular
 *    reabriria o prazo na tela de quem está com a máquina adiantada, e
 *    fecharia na de quem está atrasada.
 *
 * 2. Falha de rede devolve `aberto: true`. É o mesmo raciocínio do
 *    `emailConfirmado === null` do AuthContext: "não sei" não pode
 *    trancar ninguém para fora, porque quem recusa de verdade é o banco
 *    (trigger `protect_trabalhos_fields` + RPC `editar_submissao`).
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: vi.fn() },
}));

import { carregarPrazoSubmissoes, type PrazoSubmissoes } from "@/services/configuracoesService";
import { fasePrazo } from "@/pages/estudante/shared";

describe("carregarPrazoSubmissoes", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("devolve o que o servidor respondeu", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ abertura: "2026-01-04", encerramento: "2026-05-31", aberto: false, hoje: "2026-08-13" }],
      error: null,
    });
    expect(await carregarPrazoSubmissoes()).toEqual({
      abertura: "2026-01-04",
      encerramento: "2026-05-31",
      aberto: false,
      hoje: "2026-08-13",
    });
  });

  // O caso que prova a invariante 1: as datas dizem "dentro do prazo",
  // mas o servidor disse `false`. Vale o servidor.
  it("não recalcula `aberto` a partir das datas", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ abertura: "2026-01-01", encerramento: "2026-12-31", aberto: false, hoje: "2026-08-13" }],
      error: null,
    });
    expect((await carregarPrazoSubmissoes()).aberto).toBe(false);

    // E o inverso: data vencida, servidor disse aberto (prazo prorrogado
    // no painel entre uma leitura e outra, por exemplo).
    mocks.rpc.mockResolvedValue({
      data: [{ abertura: "2020-01-01", encerramento: "2020-01-02", aberto: true, hoje: "2026-08-13" }],
      error: null,
    });
    expect((await carregarPrazoSubmissoes()).aberto).toBe(true);
  });

  it.each([
    ["erro do banco", { data: null, error: { message: "boom" } }],
    ["resposta vazia", { data: [], error: null }],
    ["sem data", { data: null, error: null }],
  ])("falha (%s) não fecha o prazo na interface", async (_caso, resposta) => {
    mocks.rpc.mockResolvedValue(resposta);
    const prazo = await carregarPrazoSubmissoes();
    expect(prazo.aberto).toBe(true);
    expect(prazo.encerramento).toBeNull();
  });
});

/**
 * A terceira invariante, de 2026-08-31: janela fechada tem DOIS motivos, e
 * a tela precisa saber qual. Antes disso quem chegava cedo demais lia
 * "prazo de submissão encerrado" — a mensagem exatamente oposta à verdade.
 */
describe("fasePrazo", () => {
  const prazo = (over: Partial<PrazoSubmissoes>): PrazoSubmissoes => ({
    abertura: "2026-09-01",
    encerramento: "2026-09-30",
    aberto: false,
    hoje: "2026-08-31",
    ...over,
  });

  it("hoje antes da abertura é 'antes', não 'encerrado'", () => {
    expect(fasePrazo(prazo({ hoje: "2026-08-31" }))).toBe("antes");
  });

  it("hoje depois do encerramento é 'encerrado'", () => {
    expect(fasePrazo(prazo({ hoje: "2026-10-01" }))).toBe("encerrado");
  });

  it("o dia da abertura já não é 'antes' (janela inclusiva nas duas pontas)", () => {
    expect(fasePrazo(prazo({ hoje: "2026-09-01", aberto: true }))).toBe("aberto");
  });

  // O servidor manda, aqui como em `aberto`: com `aberto: true` a fase é
  // "aberto" mesmo que as datas sugiram outra coisa (prazo prorrogado
  // entre uma leitura e outra, por exemplo).
  it("nunca contraria o `aberto` do servidor", () => {
    expect(fasePrazo(prazo({ hoje: "2026-08-01", aberto: true }))).toBe("aberto");
    expect(fasePrazo(prazo({ hoje: "2026-12-31", aberto: true }))).toBe("aberto");
  });

  it("sem abertura cadastrada, fechado só pode ser encerramento", () => {
    expect(fasePrazo(prazo({ abertura: null, hoje: "2026-10-01" }))).toBe("encerrado");
  });

  it("prazo ainda não carregado é 'indefinido'", () => {
    expect(fasePrazo(null)).toBe("indefinido");
  });
});
