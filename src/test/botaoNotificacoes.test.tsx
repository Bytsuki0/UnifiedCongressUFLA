import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * A aba "Notificações" da barra superior.
 *
 * Ela existe porque o pop-up do login é efêmero: quem fecha o aviso não
 * tinha como voltar a ele até o login seguinte. Daí as duas regras que
 * este teste prende, e que quebrariam em silêncio:
 *
 *   1. **A lista mostra TODOS os avisos**, inclusive os já fechados
 *      nesta aba. Se ela mostrasse só os pendentes, seria uma segunda
 *      cópia do pop-up e não resolveria nada — reler seria impossível,
 *      que é o problema de origem.
 *   2. **O contador conta só os pendentes.** Um badge com o total
 *      ficaria permanentemente aceso, e um número que nunca muda deixa
 *      de ser lido.
 *
 * A terceira é de ruído: sem aviso nenhum a aba não aparece. Um sino que
 * nunca tem nada é enfeite fixo na barra.
 */

const mocks = vi.hoisted(() => ({ useAvisos: vi.fn() }));

vi.mock("@/contexts/AvisosContext", () => ({ useAvisos: mocks.useAvisos }));
// O corpo do aviso assina URL no Storage; aqui só interessa que ele foi
// renderizado para cada item da lista.
vi.mock("@/components/CorpoDoAviso", () => ({
  CorpoDoAviso: ({ aviso }: { aviso: { corpo: string } }) => <p>{aviso.corpo}</p>,
}));

import { BotaoNotificacoes } from "@/components/BotaoNotificacoes";

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
  titulo: "Novo formulário de parecer",
  corpo: "Baixe a versão nova.",
  imagem: "",
};

const estado = (avisos: typeof AVISO_A[], pendentes: typeof AVISO_A[], carregando = false) =>
  mocks.useAvisos.mockReturnValue({
    avisos,
    pendentes,
    carregando,
    marcarVisto: vi.fn(),
  });

describe("BotaoNotificacoes", () => {
  it("não aparece quando não há aviso nenhum para o papel", () => {
    estado([], []);
    render(<BotaoNotificacoes />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("não aparece enquanto a lista está carregando", () => {
    // Sem isto a aba pisca e some a cada carregamento de página.
    estado([], [], true);
    render(<BotaoNotificacoes />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lista TODOS os avisos, inclusive os já fechados nesta aba", () => {
    // Dois avisos, só um pendente: a lista tem de trazer os dois — reler
    // o que já foi fechado é a razão de a aba existir.
    estado([AVISO_A, AVISO_B], [AVISO_B]);
    render(<BotaoNotificacoes />);

    fireEvent.click(screen.getByRole("button", { name: /notificações/i }));

    expect(screen.getByText(AVISO_A.titulo)).toBeTruthy();
    expect(screen.getByText(AVISO_B.titulo)).toBeTruthy();
    expect(screen.getByText(AVISO_A.corpo)).toBeTruthy();
  });

  it("o contador conta os PENDENTES, não o total", () => {
    estado([AVISO_A, AVISO_B], [AVISO_B]);
    render(<BotaoNotificacoes />);
    expect(screen.getByLabelText(/1 não lido/i)).toBeTruthy();
  });

  it("sem pendentes não há contador, mas a aba continua lá", () => {
    estado([AVISO_A, AVISO_B], []);
    render(<BotaoNotificacoes />);
    expect(screen.getByRole("button", { name: /notificações/i })).toBeTruthy();
    expect(screen.queryByLabelText(/não lido/i)).toBeNull();
  });
});
