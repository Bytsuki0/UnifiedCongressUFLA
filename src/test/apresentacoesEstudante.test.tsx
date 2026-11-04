import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * O Cronograma de Apresentações do Portal do Estudante
 * (/estudante/apresentacoes).
 *
 * As regras que este teste prende:
 *
 *   1. **O quadro de destaque mostra só os trabalhos da conta** — os que a
 *      RPC marcou em `meu`, que é o DONO (quem submeteu). Quem decide o que
 *      é "meu" é `apresentacoes_publicas()`, no servidor.
 *   2. **O quadro não tira o trabalho da lista completa**, e a busca filtra
 *      a lista sem esconder o quadro.
 *   3. **Sem trabalho meu, sem quadro.**
 */

const mocks = vi.hoisted(() => ({ useApresentacoes: vi.fn() }));

vi.mock("@/hooks/use-apresentacoes", () => ({ useApresentacoes: mocks.useApresentacoes }));

import Apresentacoes from "@/pages/estudante/Apresentacoes";

const linha = (id: string, titulo: string, autores: string, meu: boolean) => ({
  id,
  titulo,
  autores,
  categoria_id: "c1",
  categoria: "BIC Jr",
  tipo: "Apresentação oral",
  data: "2026-11-20",
  hora_inicio: "14:00:00",
  hora_fim: "14:15:00",
  sala: "Sala 1",
  meu,
});

const MEU = linha("a", "Robótica na escola", "Ana Souza", true);
const OUTRO = linha("b", "Café e clima", "João Lima", false);

describe("Cronograma de apresentações do estudante", () => {
  it("destaca só o trabalho da conta, e ele continua na lista completa", () => {
    mocks.useApresentacoes.mockReturnValue({ itens: [MEU, OUTRO], carregando: false });
    render(<Apresentacoes />);

    const quadro = screen.getByRole("region", { name: "Sua apresentação" });
    expect(within(quadro).getByText("Robótica na escola")).toBeTruthy();
    expect(within(quadro).queryByText("Café e clima")).toBeNull();
    // As mesmas informações da lista: dia, horário, sala e tipo.
    expect(within(quadro).getByText("20 de novembro de 2026")).toBeTruthy();
    expect(within(quadro).getByText("14:00 às 14:15")).toBeTruthy();
    expect(within(quadro).getByText("Apresentação oral")).toBeTruthy();

    // Uma vez no quadro, outra na lista completa.
    expect(screen.getAllByText("Robótica na escola")).toHaveLength(2);
  });

  it("a busca filtra a lista sem esconder o quadro, e sem ligar para acento", () => {
    mocks.useApresentacoes.mockReturnValue({ itens: [MEU, OUTRO], carregando: false });
    render(<Apresentacoes />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar por título ou autor" }), {
      target: { value: "joao" },
    });

    expect(screen.getByText("Café e clima")).toBeTruthy();
    // Some da lista, mas não do quadro: sobra só a cópia de dentro dele.
    expect(screen.getAllByText("Robótica na escola")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Sua apresentação" })).getByText("Robótica na escola")).toBeTruthy();
  });

  it("sem trabalho da conta, não há quadro", () => {
    mocks.useApresentacoes.mockReturnValue({ itens: [OUTRO], carregando: false });
    render(<Apresentacoes />);
    expect(screen.queryByRole("region", { name: /Sua|Suas/ })).toBeNull();
    expect(screen.getByText("Café e clima")).toBeTruthy();
  });

  it("avisa quando nada foi publicado ainda", () => {
    mocks.useApresentacoes.mockReturnValue({ itens: [], carregando: false });
    render(<Apresentacoes />);
    expect(screen.getByText(/ainda não foi publicado/)).toBeTruthy();
  });
});
