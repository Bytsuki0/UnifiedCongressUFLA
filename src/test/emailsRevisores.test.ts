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
 *      devolve quantos revisores vão receber — nunca fala com o Google. E só
 *      reenvia a quem já recebeu quando o co-chair marca isso.
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

import {
  EnvioRevisor,
  FILA_PARADA_MS,
  situacaoEnvio,
  solicitarAvisosAtribuicao,
  ultimaDesignacaoPorAssociacao,
} from "@/services/revisorService";
import { carregarConfiguracoes } from "@/services/configuracoesService";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.select.mockReset();
});

describe("solicitarAvisosAtribuicao", () => {
  it("chama a RPC que só libera e devolve quantos revisores vão receber", async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    await expect(solicitarAvisosAtribuicao()).resolves.toBe(3);
    // Sem pedir, nunca reenvia: quem já recebeu não leva outro e-mail.
    expect(mocks.rpc).toHaveBeenCalledWith("solicitar_avisos_atribuicao", { _reenviar: false });
  });

  it("reenvia só quando pedido", async () => {
    mocks.rpc.mockResolvedValue({ data: 5, error: null });
    await solicitarAvisosAtribuicao(true);
    expect(mocks.rpc).toHaveBeenCalledWith("solicitar_avisos_atribuicao", { _reenviar: true });
  });

  it("devolve a recusa do banco como Error, com a frase dele", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Acesso negado." } });
    const erro = await solicitarAvisosAtribuicao().catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("Acesso negado.");
  });
});

/**
 * O registro de envios (migration 20261026120000). "avisado" só aparece
 * quando o Apps Script CONFIRMOU — era exatamente o que faltava: a marca
 * antiga saía na reserva, antes de o MailApp tentar.
 */
const envio = (parcial: Partial<EnvioRevisor>): EnvioRevisor => ({
  id: "e1",
  tipo: "atribuicao",
  revisor_email: "r@ufla.br",
  revisor_nome: null,
  associacoes: ["a1"],
  titulos: ["T"],
  status: "reservado",
  erro: null,
  criado_em: "2026-10-26T12:00:00.000Z",
  concluido_em: null,
  ...parcial,
});

describe("situacaoEnvio", () => {
  const criado = Date.parse("2026-10-26T12:00:00.000Z");

  it("enviado e falha vêm do que o Apps Script respondeu", () => {
    expect(situacaoEnvio(envio({ status: "enviado" }), criado)).toBe("enviado");
    expect(situacaoEnvio(envio({ status: "falha", erro: "Invalid email" }), criado)).toBe("falha");
  });

  it("reservado recente está saindo; velho é lote perdido, nunca 'enviado'", () => {
    expect(situacaoEnvio(envio({}), criado + 60_000)).toBe("enviando");
    expect(situacaoEnvio(envio({}), criado + FILA_PARADA_MS + 1)).toBe("sem_confirmacao");
  });
});

describe("ultimaDesignacaoPorAssociacao", () => {
  it("fica com o envio mais recente de cada associação, e só de designação", () => {
    const falhou = envio({ id: "velho", status: "falha", criado_em: "2026-10-26T10:00:00.000Z" });
    const reenviado = envio({ id: "novo", status: "enviado", criado_em: "2026-10-26T11:00:00.000Z" });
    const lembrete = envio({ id: "lem", tipo: "lembrete", criado_em: "2026-10-26T13:00:00.000Z" });
    // A ordem da lista não importa: o banco devolve do mais recente para trás.
    const m = ultimaDesignacaoPorAssociacao([lembrete, falhou, reenviado]);
    expect(m.get("a1")?.id).toBe("novo");
    expect(ultimaDesignacaoPorAssociacao([lembrete]).size).toBe(0);
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
