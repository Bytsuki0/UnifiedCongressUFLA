import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Revisores por trabalho (migration 20261011120000) — o lado cliente.
 *
 * O número é do servidor: ele é o teto da associação e a quantidade de
 * pareceres que encerra a revisão, além do alvo da recomendação. As
 * regras que este teste prende:
 *
 *   1. **A leitura PROPAGA o erro.** Cair num 3 de reserva mostraria
 *      "x/3" na tela de Atribuições com o servidor cobrando 2.
 *   2. **A escrita devolve a frase do banco como `Error`** — a página só
 *      mostra a mensagem quando `e instanceof Error`.
 *   3. **O painel do admin NÃO carrega a coluna.** `salvarConfiguracoes`
 *      grava de volta o objeto inteiro que leu; com `select("*")`, um admin
 *      salvando o prazo desfaria em silêncio o número que um co-chair
 *      acabou de mudar.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({
      select: (colunas: string) => {
        mocks.select(colunas);
        return { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      },
    }),
  },
}));

import {
  carregarConfiguracoes,
  carregarRevisoresPorTrabalho,
  definirRevisoresPorTrabalho,
} from "@/services/configuracoesService";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.select.mockReset();
});

describe("carregarRevisoresPorTrabalho", () => {
  it("devolve o número do servidor", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(carregarRevisoresPorTrabalho()).resolves.toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("revisores_por_trabalho");
  });

  it("propaga o erro em vez de inventar um número", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "falhou" } });
    await expect(carregarRevisoresPorTrabalho()).rejects.toThrow("falhou");
  });
});

describe("definirRevisoresPorTrabalho", () => {
  it("manda o número para a RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(definirRevisoresPorTrabalho(2)).resolves.toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("definir_revisores_por_trabalho", { _n: 2 });
  });

  it("devolve a recusa do banco como Error, com a frase dele", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Acesso negado." } });
    const erro = await definirRevisoresPorTrabalho(2).catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("Acesso negado.");
  });
});

describe("carregarConfiguracoes (painel do admin)", () => {
  it("não lê revisores_por_trabalho — senão o SALVAR do admin o regravaria", async () => {
    await carregarConfiguracoes();
    const colunas = mocks.select.mock.calls[0][0] as string;
    expect(colunas).not.toBe("*");
    expect(colunas).not.toContain("revisores_por_trabalho");
  });
});
