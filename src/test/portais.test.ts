import { describe, expect, it } from "vitest";
import { portalDoPapel, saudacaoDoPapel } from "@/lib/portais";
import type { UserRole } from "@/contexts/AuthContext";

const PAPEIS: UserRole[] = ["admin", "avaliador", "professor", "estudante", "externo"];

describe("portal inicial por papel", () => {
  it.each([
    ["admin", "/admin"],
    ["avaliador", "/co-chairs"],
    ["professor", "/revisor"],
    ["estudante", "/estudante"],
    // `externo` tem a mesma alçada de autor do estudante: participantes de
    // fora da UFLA também submetem trabalho.
    ["externo", "/estudante"],
  ] as [UserRole, string][])("%s -> %s", (papel, destino) => {
    expect(portalDoPapel(papel)).toBe(destino);
  });

  // A área do congresso saiu do escopo. Se alguém voltar a mandar um papel
  // para lá pelo login, o usuário cai numa rota que só o admin enxerga —
  // e o ProtectedRoute o devolve, em laço com o portal de origem.
  it("não manda ninguém para /congresso", () => {
    for (const papel of PAPEIS) {
      expect(portalDoPapel(papel)).not.toContain("/congresso");
    }
  });

  it("todo papel tem destino e saudação", () => {
    for (const papel of PAPEIS) {
      expect(portalDoPapel(papel)).toMatch(/^\//);
      expect(saudacaoDoPapel(papel)).toBeTruthy();
    }
  });
});
