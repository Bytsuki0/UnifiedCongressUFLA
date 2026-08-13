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

import { carregarPrazoSubmissoes } from "@/services/configuracoesService";

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
