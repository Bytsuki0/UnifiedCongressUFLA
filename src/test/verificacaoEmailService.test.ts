import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O service, com o cliente Supabase falsificado.
 *
 * O que este arquivo existe para travar: em status fora de 2xx o
 * `functions.invoke` NÃO devolve o corpo em `data` — devolve um
 * `FunctionsHttpError` com a Response original em `error.context`. Se
 * alguém "simplificar" o service e ler só o `data`, o 429 perde o campo
 * `segundos`, o throttle vira erro genérico e o cooldown do botão da
 * /verifique-email nasce cego. Estes testes quebram nesse dia.
 */

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    rpc: mocks.rpc,
  },
}));

import {
  confirmarEmailComToken,
  emailEstaConfirmado,
  enviarEmailDeVerificacao,
} from "@/services/verificacaoEmailService";

/** Como o supabase-js entrega uma resposta HTTP de erro. */
function erroHttp(status: number, corpo: unknown) {
  const erro = new Error("Edge Function returned a non-2xx status code");
  (erro as unknown as { context: Response }).context = new Response(
    typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    { status, headers: { "Content-Type": "application/json" } },
  );
  return { data: null, error: erro };
}

describe("enviarEmailDeVerificacao", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.rpc.mockReset();
  });

  it("envia o propósito e devolve o message_id no caminho feliz", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, message_id: "<x@brevo>" }, error: null });

    expect(await enviarEmailDeVerificacao()).toEqual({
      estado: "enviado",
      messageId: "<x@brevo>",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("enviar-email", {
      body: { proposito: "verificacao_email" },
    });
  });

  // A armadilha em si: o 429 chega em `error`, com o corpo em `error.context`.
  it("lê os segundos do throttle de dentro do error.context", async () => {
    mocks.invoke.mockResolvedValue(
      erroHttp(429, { ok: false, erro: "aguarde", segundos: 58 }),
    );

    expect(await enviarEmailDeVerificacao()).toEqual({
      estado: "falha",
      erro: "aguarde",
      segundos: 58,
    });
  });

  it("reconhece o 409 de já confirmado", async () => {
    mocks.invoke.mockResolvedValue(erroHttp(409, { ok: false, erro: "ja_confirmado" }));

    expect(await enviarEmailDeVerificacao()).toEqual({
      estado: "falha",
      erro: "ja_confirmado",
      segundos: null,
    });
  });

  it("sobrevive a um corpo que não é JSON, usando o status", async () => {
    mocks.invoke.mockResolvedValue(erroHttp(502, "<html>gateway</html>"));

    expect(await enviarEmailDeVerificacao()).toEqual({
      estado: "falha",
      erro: "falha_envio",
      segundos: null,
    });
  });

  // FunctionsFetchError: nem chegou a existir resposta HTTP.
  it("trata erro sem context como falha de rede", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("Failed to send a request") });

    expect(await enviarEmailDeVerificacao()).toEqual({
      estado: "falha",
      erro: "rede",
      segundos: null,
    });
  });

  it("trata exceção do próprio invoke como falha de rede", async () => {
    mocks.invoke.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await enviarEmailDeVerificacao()).toEqual({
      estado: "falha",
      erro: "rede",
      segundos: null,
    });
  });
});

describe("confirmarEmailComToken", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it("repassa o desfecho da RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: "confirmado", error: null });

    expect(await confirmarEmailComToken("abc")).toBe("confirmado");
    expect(mocks.rpc).toHaveBeenCalledWith("confirmar_email", { p_token: "abc" });
  });

  it("erro da RPC vira 'rede', nunca 'invalido'", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "JWT expired" } });

    expect(await confirmarEmailComToken("abc")).toBe("rede");
  });

  it("exceção de fetch vira 'rede'", async () => {
    mocks.rpc.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await confirmarEmailComToken("abc")).toBe("rede");
  });
});

describe("emailEstaConfirmado", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it.each([
    [true, true],
    [false, false],
  ])("devolve %s conforme o banco", async (data, esperado) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await emailEstaConfirmado()).toBe(esperado);
  });

  // "não sei" ≠ "não confirmado": tratar erro como `false` trancaria o
  // usuário para fora da interface por causa de uma falha de rede.
  it("devolve null quando a RPC falha", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await emailEstaConfirmado()).toBeNull();
  });
});
