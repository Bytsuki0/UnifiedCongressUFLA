import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * E-mails aos revisores (migration 20261014120000) — o lado cliente.
 *
 * Quem decide o que sai, e quando, é o SQL (`emails_devidos`, provado por
 * sql/ensaio-emails-revisores.sql); quem envia é o Apps Script da conta
 * congressoparaiso@ufla.br. O cliente só faz duas coisas, e é isso que fica
 * preso aqui:
 *
 *   1. **O botão de Atribuições só LIBERA.** Chama a RPC que põe na fila e
 *      devolve quantos revisores vão receber — nunca fala com o Google.
 *   2. **A recusa do banco sobe como `Error`, com a frase dele** — a página
 *      só mostra a mensagem quando `e instanceof Error`.
 *   3. **O painel do admin carrega o prazo das avaliações.** Sem a coluna no
 *      select, o campo apareceria vazio com um prazo valendo no servidor.
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

import { solicitarAvisosAtribuicao } from "@/services/revisorService";
import { carregarConfiguracoes } from "@/services/configuracoesService";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.select.mockReset();
});

describe("solicitarAvisosAtribuicao", () => {
  it("chama a RPC que só libera e devolve quantos revisores vão receber", async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    await expect(solicitarAvisosAtribuicao()).resolves.toBe(3);
    expect(mocks.rpc).toHaveBeenCalledWith("solicitar_avisos_atribuicao");
  });

  it("devolve a recusa do banco como Error, com a frase dele", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Acesso negado." } });
    const erro = await solicitarAvisosAtribuicao().catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("Acesso negado.");
  });
});

describe("carregarConfiguracoes (painel do admin)", () => {
  it("carrega o encerramento das avaliações junto da antecedência do lembrete", async () => {
    await carregarConfiguracoes();
    const colunas = mocks.select.mock.calls[0][0] as string;
    expect(colunas).toContain("revisoes_encerramento");
    expect(colunas).toContain("alerta_horas");
  });
});
