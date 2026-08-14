import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O service do "esqueci minha senha", com o cliente Supabase falsificado.
 *
 * Trava a MESMA armadilha de verificacaoEmailService.test.ts: em status
 * fora de 2xx o `functions.invoke` NÃO devolve o corpo em `data` —
 * devolve um `FunctionsHttpError` com a Response original em
 * `error.context`. Se alguém ler só o `data`, o 429 por IP perde o
 * `segundos` e os vereditos sobre o token viram erro genérico.
 */

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
  },
}));

import { solicitarRedefinicao, trocarSenha } from "@/services/redefinirSenhaService";

/** Como o supabase-js entrega uma resposta HTTP de erro. */
function erroHttp(status: number, corpo: unknown) {
  const erro = new Error("Edge Function returned a non-2xx status code");
  (erro as unknown as { context: Response }).context = new Response(
    typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    { status, headers: { "Content-Type": "application/json" } },
  );
  return { data: null, error: erro };
}

describe("solicitarRedefinicao", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("manda a ação e o e-mail, e devolve aceito no caminho feliz", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    expect(await solicitarRedefinicao("alguem@ufla.br")).toEqual({ estado: "aceito" });
    expect(mocks.invoke).toHaveBeenCalledWith("redefinir-senha", {
      body: { acao: "solicitar", email: "alguem@ufla.br" },
    });
  });

  it("lê os segundos do limite por IP de dentro do error.context", async () => {
    mocks.invoke.mockResolvedValue(erroHttp(429, { ok: false, erro: "aguarde", segundos: 900 }));

    expect(await solicitarRedefinicao("alguem@ufla.br")).toEqual({
      estado: "falha",
      erro: "aguarde",
      segundos: 900,
    });
  });

  it("sobrevive a um corpo que não é JSON, usando o status", async () => {
    mocks.invoke.mockResolvedValue(erroHttp(502, "<html>gateway</html>"));

    expect(await solicitarRedefinicao("alguem@ufla.br")).toEqual({
      estado: "falha",
      erro: "falha_envio",
      segundos: null,
    });
  });

  it("trata erro sem context como falha de rede", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("Failed to send a request") });

    expect(await solicitarRedefinicao("alguem@ufla.br")).toEqual({
      estado: "falha",
      erro: "rede",
      segundos: null,
    });
  });

  it("trata exceção do próprio invoke como falha de rede", async () => {
    mocks.invoke.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await solicitarRedefinicao("alguem@ufla.br")).toEqual({
      estado: "falha",
      erro: "rede",
      segundos: null,
    });
  });
});

describe("trocarSenha", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("manda a ação, o token e a senha, e devolve trocada no caminho feliz", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    expect(await trocarSenha("tok123", "senha-bem-grande")).toEqual({ estado: "trocada" });
    expect(mocks.invoke).toHaveBeenCalledWith("redefinir-senha", {
      body: { acao: "trocar", token: "tok123", novaSenha: "senha-bem-grande" },
    });
  });

  it.each([
    [400, "token_invalido"],
    [409, "token_usado"],
    [410, "token_expirado"],
    [400, "senha_curta"],
  ] as const)("repassa o veredito %i/%s do error.context", async (status, erro) => {
    mocks.invoke.mockResolvedValue(erroHttp(status, { ok: false, erro }));

    expect(await trocarSenha("tok123", "senha-bem-grande")).toEqual({ estado: "falha", erro });
  });

  // Sem código explícito no corpo, um 400 estranho não condena o link.
  it("400 sem corpo nosso NÃO vira token_invalido", async () => {
    mocks.invoke.mockResolvedValue(erroHttp(400, "<html>gateway</html>"));

    expect(await trocarSenha("tok123", "senha-bem-grande")).toEqual({
      estado: "falha",
      erro: "desconhecido",
    });
  });

  it("trata erro sem context como falha de rede", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("Failed to send a request") });

    expect(await trocarSenha("tok123", "senha-bem-grande")).toEqual({
      estado: "falha",
      erro: "rede",
    });
  });

  it("trata exceção do próprio invoke como falha de rede", async () => {
    mocks.invoke.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await trocarSenha("tok123", "senha-bem-grande")).toEqual({
      estado: "falha",
      erro: "rede",
    });
  });
});
