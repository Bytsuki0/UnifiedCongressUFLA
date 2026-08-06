import { describe, expect, it } from "vitest";
import { TITULOS, tituloDaRota } from "@/lib/pageTitles";
import { APP_NAME } from "@/lib/brand";

describe("títulos de página", () => {
  it("usa só a marca em rota desconhecida", () => {
    expect(tituloDaRota("/rota/que/nao/existe")).toBe(APP_NAME);
  });

  it("sufixa a marca no título da rota", () => {
    expect(tituloDaRota("/login")).toBe(`Entrar · ${APP_NAME}`);
  });

  // A armadilha da tabela: ":id" casa com qualquer segmento, inclusive
  // "novo" e "editar". Se alguém reordenar a lista, isto quebra.
  it.each([
    ["/co-chairs/trabalhos", "Trabalhos"],
    ["/co-chairs/trabalhos/novo", "Novo trabalho"],
    ["/co-chairs/trabalhos/abc-123", "Detalhe do trabalho"],
    ["/co-chairs/trabalhos/abc-123/editar", "Editar trabalho"],
    ["/co-chairs/avaliadores", "Avaliadores"],
    ["/co-chairs/avaliadores/novo", "Novo avaliador"],
    ["/revisor/analise", "Trabalhos para análise"],
    ["/revisor/analise/abc-123", "Analisar trabalho"],
    ["/congresso/verificar", "Verificar certificado"],
    ["/congresso/verificar/ABC123", "Verificação de certificado"],
    ["/admin", "Auditoria"],
    ["/admin/papeis", "Papéis de acesso"],
    ["/congresso/admin", "Administração do congresso"],
    ["/congresso/admin/usuarios", "Usuários"],
    ["/estudante/correcao/abc-123", "Enviar correção"],
  ])("%s -> %s", (caminho, esperado) => {
    expect(tituloDaRota(caminho)).toBe(`${esperado} · ${APP_NAME}`);
  });

  it("não tem padrões duplicados", () => {
    const padroes = TITULOS.map(([p]) => p);
    expect(new Set(padroes).size).toBe(padroes.length);
  });
});
