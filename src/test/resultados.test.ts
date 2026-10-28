import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Divulgação dos resultados (migration 20261027120000) — o lado cliente.
 *
 * Quem decide quem recebe o e-mail, e quando, é o SQL (`resultados_devidos`,
 * provado por sql/ensaio-resultados.sql). O que fica preso aqui:
 *
 *   1. **O painel do admin carrega o momento da divulgação.** Sem a coluna
 *      no select, o campo apareceria vazio com uma divulgação valendo no
 *      servidor — e o SALVAR gravaria o vazio por cima.
 *   2. **O registro dos envios PROPAGA o erro**: quem acompanha a divulgação
 *      não pode ler "nenhum enviado" por causa de uma falha de rede.
 *   3. **O aviso de "aguardando decisão" conta AUTORES**, e só os que ainda
 *      não receberam — é o que mostra quem um trabalho esquecido está
 *      segurando.
 *   4. **O "agora" é o de Lavras**, no formato do campo, para o aviso de
 *      momento já vencido não depender do fuso do computador do admin.
 */

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  resultado: { data: null as unknown, error: null as { message: string } | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (colunas: string) => {
        mocks.select(colunas);
        return {
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          order: () => Promise.resolve(mocks.resultado),
        };
      },
    }),
  },
}));

import { carregarConfiguracoes, listarEnviosResultados } from "@/services/configuracoesService";
import { agoraEmLavras, autoresAguardandoDecisao, ultimoEnvioPorAutor } from "@/lib/resultados";

beforeEach(() => {
  mocks.select.mockReset();
  mocks.resultado = { data: null, error: null };
});

describe("carregarConfiguracoes (painel do admin)", () => {
  it("carrega o momento da divulgação dos resultados", async () => {
    await carregarConfiguracoes();
    expect(mocks.select.mock.calls[0][0] as string).toContain("resultados_divulgacao");
  });
});

describe("listarEnviosResultados", () => {
  it("devolve a recusa do banco como Error, nunca como lista vazia", async () => {
    mocks.resultado = { data: null, error: { message: "permission denied" } };
    const erro = await listarEnviosResultados().catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("permission denied");
  });
});

describe("autoresAguardandoDecisao", () => {
  const t = (owner_id: string | null, status: string) => ({ owner_id, status });

  it("conta autores com algum trabalho ainda sem decisão — um por autor", () => {
    expect(
      autoresAguardandoDecisao(
        [t("a", "aprovado"), t("a", "em_avaliacao"), t("a", "pendente"), t("b", "reprovado")],
        new Set(),
      ),
    ).toBe(1);
  });

  it("aguardando_parecer_editorial ainda não é decisão", () => {
    expect(autoresAguardandoDecisao([t("a", "aguardando_parecer_editorial")], new Set())).toBe(1);
  });

  it("os quatro desfechos contam como decididos", () => {
    const decididos = ["resubmeter", "aprovado_correcoes", "aprovado", "reprovado"].map((s) => t("a", s));
    expect(autoresAguardandoDecisao(decididos, new Set())).toBe(0);
  });

  it("quem já recebeu não conta, mesmo com trabalho reenviado de volta a pendente", () => {
    expect(autoresAguardandoDecisao([t("a", "pendente")], new Set(["a"]))).toBe(0);
  });

  it("trabalho sem dono não segura ninguém", () => {
    expect(autoresAguardandoDecisao([t(null, "pendente")], new Set())).toBe(0);
  });
});

describe("ultimoEnvioPorAutor", () => {
  it("fica com o envio mais recente de cada autor, em qualquer ordem da lista", () => {
    const e = (id: string, autor_id: string, criado_em: string) => ({ id, autor_id, criado_em });
    const ultimos = ultimoEnvioPorAutor([
      e("velho", "a", "2026-11-15T21:01:00.000Z"),
      e("b1", "b", "2026-11-15T21:02:00.000Z"),
      e("novo", "a", "2026-11-15T21:03:00.000Z"),
    ]);
    expect(ultimos.map((x) => x.id).sort()).toEqual(["b1", "novo"]);
  });
});

describe("agoraEmLavras", () => {
  it("é a hora de Brasília no formato do datetime-local", () => {
    // 17h05 em UTC = 14h05 em Lavras (UTC-3, sem horário de verão desde 2019).
    expect(agoraEmLavras(new Date("2026-11-15T17:05:42Z"))).toBe("2026-11-15T14:05");
  });

  it("vira o dia em Lavras, não em UTC", () => {
    expect(agoraEmLavras(new Date("2026-11-16T01:30:00Z"))).toBe("2026-11-15T22:30");
  });
});
