import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * A gaveta do menu no celular.
 *
 * Este teste existe por causa de uma regressão que ficou de pé sem ninguém
 * notar: o `index.css` declarava `.sidebar.open` para trazer a barra lateral
 * de volta abaixo de 768px, mas **nenhum componente chegava a aplicar essa
 * classe**. Como o botão "Sair" mora dentro da barra, no celular não havia
 * como navegar nem deslogar — e nada, em teste nenhum, apontava isso.
 *
 * Por isso o que se prende aqui é o MECANISMO, não a aparência:
 *
 *   1. quem abre a gaveta marca `<body data-menu="aberto">`, que é o gancho
 *      que o CSS lê (mesmo desenho do `data-sidebar` do menu recolhido);
 *   2. ela **fecha ao mudar de rota** — senão cobriria justamente a tela que
 *      a pessoa acabou de pedir ao tocar num item do menu;
 *   3. fundo e `Esc` também fecham, porque num celular o botão de fechar
 *      pode ficar atrás do polegar.
 *
 * O último caso é o da regressão original: o layout tem de trazer o botão da
 * gaveta JUNTO com o "Sair". Um sem o outro é o estado quebrado.
 */

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useAvisos: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/contexts/AvisosContext", () => ({ useAvisos: mocks.useAvisos }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: mocks.signOut } },
}));

import { BotaoMenuMobile } from "@/components/BotaoMenuMobile";
import EstudanteLayout from "@/components/estudante/Layout";

const fundo = () => document.querySelector(".menu-backdrop");
const botao = () => screen.getByRole("button", { name: /menu/i });

afterEach(() => {
  delete document.body.dataset.menu;
});

describe("BotaoMenuMobile", () => {
  it("nasce fechado e abre no clique, marcando o body", () => {
    render(
      <MemoryRouter>
        <BotaoMenuMobile />
      </MemoryRouter>,
    );

    expect(document.body.dataset.menu).toBeUndefined();
    expect(fundo()).toBeNull();
    expect(botao()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(botao());

    expect(document.body.dataset.menu).toBe("aberto");
    expect(fundo()).not.toBeNull();
    expect(botao()).toHaveAttribute("aria-expanded", "true");
  });

  it("fecha no toque do fundo", () => {
    render(
      <MemoryRouter>
        <BotaoMenuMobile />
      </MemoryRouter>,
    );

    fireEvent.click(botao());
    fireEvent.click(fundo()!);

    expect(document.body.dataset.menu).toBeUndefined();
    expect(fundo()).toBeNull();
  });

  it("fecha no Esc", () => {
    render(
      <MemoryRouter>
        <BotaoMenuMobile />
      </MemoryRouter>,
    );

    fireEvent.click(botao());
    fireEvent.keyDown(window, { key: "Escape" });

    expect(document.body.dataset.menu).toBeUndefined();
  });

  it("fecha ao mudar de rota — senão cobriria a tela recém-pedida", () => {
    render(
      <MemoryRouter initialEntries={["/estudante/papeis-submetidos"]}>
        <BotaoMenuMobile />
        <Link to="/estudante/templates">Templates</Link>
        <Routes>
          <Route path="/estudante/papeis-submetidos" element={<p>lista</p>} />
          <Route path="/estudante/templates" element={<p>templates</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(botao());
    expect(document.body.dataset.menu).toBe("aberto");

    fireEvent.click(screen.getByRole("link", { name: "Templates" }));

    expect(screen.getByText("templates")).toBeInTheDocument();
    expect(document.body.dataset.menu).toBeUndefined();
    expect(fundo()).toBeNull();
  });
});

describe("Layout do estudante", () => {
  it("traz o botão da gaveta junto com o Sair — um sem o outro é o bug", () => {
    mocks.useAuth.mockReturnValue({
      user: { nome: "Ana Souza", email: "ana@estudante.ufla.br" },
      role: "estudante",
      emailConfirmado: true,
      loading: false,
      revalidarEmailConfirmado: async () => true,
    });
    mocks.useAvisos.mockReturnValue({
      avisos: [],
      pendentes: [],
      carregando: false,
      marcarVisto: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/estudante/papeis-submetidos"]}>
        <EstudanteLayout />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /abrir o menu/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
