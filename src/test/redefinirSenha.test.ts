import { describe, expect, it } from "vitest";
import {
  COOLDOWN_IP_SEGUNDOS,
  interpretarRespostaSolicitacao,
  interpretarRespostaTroca,
  mensagemDoErroSolicitacao,
  validarNovaSenha,
} from "@/lib/redefinirSenha";
import { MIN_SENHA } from "@/lib/cadastro";

/**
 * Lógica pura do "esqueci minha senha" — as invariantes que não podem
 * regredir:
 *
 *  1. um status sem código explícito no corpo NUNCA vira `token_invalido`
 *     (condenaria um link que talvez esteja bom);
 *  2. o `segundos` do 429 por IP chega inteiro à UI, com fallback sadio;
 *  3. a validação local usa o MESMO MIN_SENHA do cadastro.
 */

describe("interpretarRespostaSolicitacao", () => {
  it("2xx é aceito — inclusive quando nada foi enviado (anti-enumeração)", () => {
    expect(interpretarRespostaSolicitacao(200, { ok: true })).toEqual({ estado: "aceito" });
  });

  it("429 carrega os segundos do limite por IP", () => {
    expect(
      interpretarRespostaSolicitacao(429, { ok: false, erro: "aguarde", segundos: 120 }),
    ).toEqual({ estado: "falha", erro: "aguarde", segundos: 120 });
  });

  it("429 sem corpo usa o cooldown padrão do IP", () => {
    expect(interpretarRespostaSolicitacao(429, null)).toEqual({
      estado: "falha",
      erro: "aguarde",
      segundos: COOLDOWN_IP_SEGUNDOS,
    });
  });

  it("repassa os códigos conhecidos do corpo", () => {
    expect(interpretarRespostaSolicitacao(400, { erro: "email_invalido" })).toEqual({
      estado: "falha",
      erro: "email_invalido",
      segundos: null,
    });
    expect(interpretarRespostaSolicitacao(500, { erro: "config_ausente" })).toEqual({
      estado: "falha",
      erro: "config_ausente",
      segundos: null,
    });
  });

  it("sobrevive a corpo que não é o nosso, caindo no status", () => {
    expect(interpretarRespostaSolicitacao(502, null)).toEqual({
      estado: "falha",
      erro: "falha_envio",
      segundos: null,
    });
    expect(interpretarRespostaSolicitacao(418, null)).toEqual({
      estado: "falha",
      erro: "desconhecido",
      segundos: null,
    });
  });
});

describe("mensagemDoErroSolicitacao", () => {
  it("formata o aguarde em horas, minutos ou segundos", () => {
    expect(mensagemDoErroSolicitacao("aguarde", 3600)).toMatch(/1 hora/);
    expect(mensagemDoErroSolicitacao("aguarde", 120)).toMatch(/2 minutos/);
    expect(mensagemDoErroSolicitacao("aguarde", 45)).toMatch(/45 segundos/);
  });

  it("aguarde sem segundos usa o padrão do IP", () => {
    expect(mensagemDoErroSolicitacao("aguarde", null)).toMatch(/1 hora/);
  });

  it("os demais códigos têm texto próprio", () => {
    expect(mensagemDoErroSolicitacao("email_invalido", null)).toMatch(/e-mail válido/i);
    expect(mensagemDoErroSolicitacao("rede", null)).toMatch(/conexão/i);
  });
});

describe("interpretarRespostaTroca", () => {
  it("2xx é senha trocada", () => {
    expect(interpretarRespostaTroca(200, { ok: true })).toEqual({ estado: "trocada" });
  });

  it.each([
    ["token_invalido", 400],
    ["token_usado", 409],
    ["token_expirado", 410],
    ["senha_curta", 400],
    ["falha_troca", 500],
  ] as const)("repassa o código %s do corpo", (erro, status) => {
    expect(interpretarRespostaTroca(status, { ok: false, erro })).toEqual({
      estado: "falha",
      erro,
    });
  });

  // A invariante que importa: sem código explícito, um 400 qualquer não
  // pode condenar o link — só o servidor tem autoridade para isso.
  it("400 sem código NÃO vira token_invalido", () => {
    expect(interpretarRespostaTroca(400, null)).toEqual({
      estado: "falha",
      erro: "desconhecido",
    });
    expect(interpretarRespostaTroca(400, { mensagem: "algo" })).toEqual({
      estado: "falha",
      erro: "desconhecido",
    });
  });

  it("409/410 sem corpo caem no código do status", () => {
    expect(interpretarRespostaTroca(409, null)).toEqual({ estado: "falha", erro: "token_usado" });
    expect(interpretarRespostaTroca(410, null)).toEqual({
      estado: "falha",
      erro: "token_expirado",
    });
  });
});

describe("validarNovaSenha", () => {
  const valida = "a".repeat(MIN_SENHA);

  it("aceita senha no mínimo exato com confirmação igual", () => {
    expect(validarNovaSenha(valida, valida)).toBeNull();
  });

  it("recusa senha vazia", () => {
    expect(validarNovaSenha("", "")).toMatch(/informe/i);
  });

  it("recusa senha abaixo do mínimo (mesmo MIN_SENHA do cadastro)", () => {
    const curta = "a".repeat(MIN_SENHA - 1);
    expect(validarNovaSenha(curta, curta)).toMatch(new RegExp(`${MIN_SENHA}`));
  });

  it("recusa confirmação divergente", () => {
    expect(validarNovaSenha(valida, `${valida}x`)).toMatch(/não coincidem/i);
  });
});
