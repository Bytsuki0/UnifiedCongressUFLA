import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A página Avisos do Portal do Estudante (/estudante/avisos).
 *
 * As regras que este teste prende:
 *
 *   1. **Mostra TODOS os avisos do contexto**, inclusive os já fechados
 *      no pop-up — é a mesma razão da aba Notificações: a página existe
 *      para reler. Mostrar só os pendentes faria ela esvaziar no instante
 *      em que o diálogo do login é fechado.
 *   2. **A lista vazia avisa**, em vez de deixar a página em branco.
 *
 * O recorte por papel (só o que foi marcado para estudantes) NÃO é
 * testado aqui porque não mora aqui: é `meus_avisos()`, no servidor.
 */

const mocks = vi.hoisted(() => ({ useAvisos: vi.fn() }));

vi.mock("@/contexts/AvisosContext", () => ({ useAvisos: mocks.useAvisos }));
// O corpo do aviso assina URL no Storage; aqui só interessa que ele foi
// renderizado para cada item da lista.
vi.mock("@/components/CorpoDoAviso", () => ({
  CorpoDoAviso: ({ aviso }: { aviso: { corpo: string } }) => <p>{aviso.corpo}</p>,
}));

import Avisos from "@/pages/estudante/Avisos";

const AVISO_A = {
  id: "a",
  tipo: "texto" as const,
  titulo: "Prazo prorrogado",
  corpo: "Até 20 de outubro.",
  imagem: "",
};
const AVISO_B = {
  id: "b",
  tipo: "texto" as const,
  titulo: "Template novo",
  corpo: "Baixe a versão nova.",
  imagem: "",
};

const estado = (avisos: typeof AVISO_A[], pendentes: typeof AVISO_A[], carregando = false) =>
  mocks.useAvisos.mockReturnValue({ avisos, pendentes, carregando, marcarVisto: vi.fn() });

describe("Avisos do estudante", () => {
  it("lista todos os avisos, inclusive os já fechados no pop-up", () => {
    // B já foi fechado nesta aba (não está em `pendentes`) e continua aqui.
    estado([AVISO_A, AVISO_B], [AVISO_A]);
    render(<Avisos />);
    expect(screen.getByRole("heading", { name: "Prazo prorrogado" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Template novo" })).toBeTruthy();
    expect(screen.getByText("Baixe a versão nova.")).toBeTruthy();
  });

  it("avisa quando não há aviso nenhum", () => {
    estado([], []);
    render(<Avisos />);
    expect(screen.getByText("Nenhum aviso publicado")).toBeTruthy();
  });

  it("não diz que está vazio enquanto carrega", () => {
    estado([], [], true);
    render(<Avisos />);
    expect(screen.queryByText("Nenhum aviso publicado")).toBeNull();
    expect(screen.getByText("Carregando avisos...")).toBeTruthy();
  });
});
