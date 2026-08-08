import { describe, expect, it } from "vitest";
import {
  COOLDOWN_PADRAO_SEGUNDOS,
  estadoDaConfirmacao,
  interpretarRespostaEnvio,
  mensagemDoErroEnvio,
} from "@/lib/verificacaoEmail";

describe("estadoDaConfirmacao", () => {
  it.each([
    ["confirmado"],
    ["ja_confirmado"],
    ["expirado"],
    ["invalido"],
  ])("repassa o desfecho %s da RPC", (valor) => {
    expect(estadoDaConfirmacao(valor, null)).toBe(valor);
  });

  // A regra que não pode quebrar: falha de rede NÃO é link inválido. Se
  // virasse "invalido", o usuário jogaria fora um link perfeitamente bom.
  it.each([
    ["TypeError: Failed to fetch", new TypeError("Failed to fetch")],
    ["erro do PostgREST", { code: "PGRST301", message: "JWT expired" }],
  ])("trata %s como rede, nunca como invalido", (_rotulo, erro) => {
    expect(estadoDaConfirmacao(null, erro)).toBe("rede");
  });

  it("ignora o valor quando veio erro junto", () => {
    expect(estadoDaConfirmacao("confirmado", new Error("boom"))).toBe("rede");
  });

  it.each([[null], [undefined], [""], ["qualquer_coisa"], [42]])(
    "cai em rede diante do valor inesperado %s",
    (valor) => {
      expect(estadoDaConfirmacao(valor, null)).toBe("rede");
    },
  );
});

describe("interpretarRespostaEnvio", () => {
  it("aceita o 200 e guarda o message_id", () => {
    expect(interpretarRespostaEnvio(200, { ok: true, message_id: "<abc@brevo>" })).toEqual({
      estado: "enviado",
      messageId: "<abc@brevo>",
    });
  });

  it("aceita o 200 sem message_id", () => {
    expect(interpretarRespostaEnvio(200, { ok: true })).toEqual({
      estado: "enviado",
      messageId: null,
    });
  });

  // O motivo de existir do `error.context.json()` no service: sem o campo
  // `segundos` o cooldown do botão nasceria cego.
  it("extrai os segundos do throttle no 429", () => {
    expect(interpretarRespostaEnvio(429, { ok: false, erro: "aguarde", segundos: 58 })).toEqual({
      estado: "falha",
      erro: "aguarde",
      segundos: 58,
    });
  });

  it("usa o cooldown padrão quando o 429 vem sem segundos", () => {
    expect(interpretarRespostaEnvio(429, { ok: false, erro: "aguarde" })).toEqual({
      estado: "falha",
      erro: "aguarde",
      segundos: COOLDOWN_PADRAO_SEGUNDOS,
    });
  });

  it.each([
    [409, "ja_confirmado"],
    [401, "sem_sessao"],
    [404, "usuario_invalido"],
    [502, "falha_envio"],
    [500, "config_ausente"],
  ])("repassa o código do corpo no status %s", (status, erro) => {
    expect(interpretarRespostaEnvio(status, { ok: false, erro })).toEqual({
      estado: "falha",
      erro,
      segundos: null,
    });
  });

  // O gateway da plataforma responde 401 com um JSON que não é o nosso.
  it("deduz o código pelo status quando o corpo não é nosso", () => {
    expect(interpretarRespostaEnvio(401, { code: "UNAUTHORIZED_NO_AUTH_HEADER" })).toEqual({
      estado: "falha",
      erro: "sem_sessao",
      segundos: null,
    });
  });

  it("deduz o código pelo status quando não há corpo algum", () => {
    expect(interpretarRespostaEnvio(429, null)).toEqual({
      estado: "falha",
      erro: "aguarde",
      segundos: COOLDOWN_PADRAO_SEGUNDOS,
    });
  });

  it("recusa um código desconhecido vindo do corpo", () => {
    expect(interpretarRespostaEnvio(418, { erro: "chá_de_camomila" })).toEqual({
      estado: "falha",
      erro: "desconhecido",
      segundos: null,
    });
  });
});

describe("mensagemDoErroEnvio", () => {
  it("conta os segundos na mensagem de throttle", () => {
    expect(mensagemDoErroEnvio("aguarde", 58)).toBe("Aguarde 58 segundos para pedir outro e-mail.");
    expect(mensagemDoErroEnvio("aguarde", 1)).toBe("Aguarde 1 segundo para pedir outro e-mail.");
  });

  it("tem texto para todo código de erro", () => {
    const codigos = [
      "aguarde",
      "ja_confirmado",
      "sem_sessao",
      "usuario_invalido",
      "proposito_invalido",
      "corpo_invalido",
      "falha_envio",
      "config_ausente",
      "falha_token",
      "rede",
      "desconhecido",
    ] as const;
    for (const codigo of codigos) {
      expect(mensagemDoErroEnvio(codigo, 60)).toMatch(/\S/);
    }
  });
});
