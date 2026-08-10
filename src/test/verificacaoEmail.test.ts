import { describe, expect, it } from "vitest";
import {
  COOLDOWN_PADRAO_SEGUNDOS,
  ehEmailJaCadastrado,
  estadoDaConfirmacao,
  estadoDaLiberacao,
  interpretarRespostaEnvio,
  mensagemDoErroEnvio,
  RESULTADOS_LIBERACAO,
  TEXTO_LIBERACAO,
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

/**
 * Liberação do e-mail preso por conta não confirmada.
 *
 * O risco desta parte é assimétrico: um falso NEGATIVO só faz o cadastro
 * falhar como falhava antes, mas um falso POSITIVO manda apagar conta.
 * Por isso o gatilho é testado pelos dois lados.
 */
describe("ehEmailJaCadastrado", () => {
  it.each([
    ["código estruturado do GoTrue", { code: "user_already_exists", message: "User already registered" }],
    ["código alternativo", { code: "email_exists", message: "qualquer coisa" }],
    ["só a mensagem", { message: "User already registered" }],
    ["mensagem em outra caixa", { message: "USER ALREADY EXISTS" }],
  ])("reconhece %s", (_caso, erro) => {
    expect(ehEmailJaCadastrado(erro)).toBe(true);
  });

  // Estes são os que apagariam conta à toa se o gatilho fosse frouxo.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string solta", "User already registered"],
    ["senha fraca", { code: "weak_password", message: "Password should be at least 8 characters" }],
    ["e-mail inválido", { code: "validation_failed", message: "Unable to validate email address" }],
    ["falha de rede", new Error("Failed to fetch")],
  ])("NÃO dispara para %s", (_caso, erro) => {
    expect(ehEmailJaCadastrado(erro)).toBe(false);
  });
});

describe("estadoDaLiberacao", () => {
  it.each(RESULTADOS_LIBERACAO.map((r) => [r]))("repassa o desfecho %s da RPC", (valor) => {
    expect(estadoDaLiberacao(valor, null)).toBe(valor);
  });

  // Mesma regra da confirmação: erro de transporte não é desfecho de
  // negócio. "rede" faz a tela pedir para repetir; qualquer outro valor
  // faria o cadastro desistir por causa de um timeout.
  it.each([
    ["erro da RPC", [null, { message: "timeout" }]],
    ["valor desconhecido", ["talvez", null]],
    ["null", [null, null]],
    ["objeto", [{ liberado: true }, null]],
  ])("cai em rede: %s", (_caso, [valor, erro]) => {
    expect(estadoDaLiberacao(valor, erro)).toBe("rede");
  });

  it("tem texto para todo estado menos 'liberado'", () => {
    for (const estado of [...RESULTADOS_LIBERACAO, "rede"] as const) {
      if (estado === "liberado") continue;
      expect(TEXTO_LIBERACAO[estado]).toMatch(/\S/);
    }
  });

  // "liberado" é silencioso de propósito: o cadastro segue e a pessoa não
  // precisa saber que havia uma conta pendente com o e-mail dela.
  it("não tem texto para 'liberado'", () => {
    expect((TEXTO_LIBERACAO as Record<string, string>).liberado).toBeUndefined();
  });
});
