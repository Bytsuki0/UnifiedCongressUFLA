import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Tela /confirmar-email — as três propriedades que dependem do componente,
 * não da função pura (essa está em verificacaoEmail.test.ts):
 *
 *  1. o token some da URL assim que é lido;
 *  2. NADA é consumido no mount — só no clique (o pré-carregador de links
 *     do Gmail e os antivírus abrem a URL sozinhos; consumir no mount
 *     queimaria o token antes de a pessoa ver a tela);
 *  3. falha de rede vira tela de "tentar de novo", nunca "link inválido".
 */

const mocks = vi.hoisted(() => ({
  confirmarEmailComToken: vi.fn(),
  revalidarEmailConfirmado: vi.fn(),
}));

vi.mock("@/services/verificacaoEmailService", () => ({
  confirmarEmailComToken: mocks.confirmarEmailComToken,
  emailEstaConfirmado: vi.fn(async () => null),
  enviarEmailDeVerificacao: vi.fn(),
}));

// useAuth mockado para não arrastar o cliente Supabase (e o .env) ao teste.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    role: null,
    emailConfirmado: null,
    loading: false,
    revalidarEmailConfirmado: mocks.revalidarEmailConfirmado,
  }),
}));

import ConfirmarEmail from "@/pages/ConfirmarEmail";

function montar(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter>
      <ConfirmarEmail />
    </MemoryRouter>,
  );
}

const botaoConfirmar = () => screen.getByRole("button", { name: /confirmar e-mail/i });

describe("/confirmar-email", () => {
  beforeEach(() => {
    mocks.confirmarEmailComToken.mockReset();
    mocks.revalidarEmailConfirmado.mockReset().mockResolvedValue(true);
  });

  it("sem token: mostra 'inválido' sem chamar a RPC e sem quebrar", async () => {
    montar("/confirmar-email");

    expect(await screen.findByText(/não reconhecemos este link/i)).toBeInTheDocument();
    expect(mocks.confirmarEmailComToken).not.toHaveBeenCalled();
  });

  it("tira o token da URL no mount e só consome no clique", async () => {
    mocks.confirmarEmailComToken.mockResolvedValue("confirmado");
    montar("/confirmar-email?token=abc123");

    // (1) o token saiu da URL...
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.location.pathname).toBe("/confirmar-email");

    // (2) ...e ninguém consumiu nada ainda.
    expect(mocks.confirmarEmailComToken).not.toHaveBeenCalled();

    fireEvent.click(botaoConfirmar());

    // (3) o valor guardado em memória é o que vai para a RPC.
    await waitFor(() => expect(mocks.confirmarEmailComToken).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByText(/e-mail confirmado/i)).toBeInTheDocument();
    // Relê a confirmação, senão o ProtectedRoute devolveria o usuário
    // recém-confirmado para /verifique-email.
    expect(mocks.revalidarEmailConfirmado).toHaveBeenCalled();
  });

  it("token recusado pelo banco vira 'link inválido'", async () => {
    mocks.confirmarEmailComToken.mockResolvedValue("invalido");
    montar("/confirmar-email?token=lixo");

    fireEvent.click(botaoConfirmar());

    expect(await screen.findByText(/não reconhecemos este link/i)).toBeInTheDocument();
  });

  it("falha de rede oferece tentar de novo, e não diz que o link é inválido", async () => {
    mocks.confirmarEmailComToken.mockResolvedValue("rede");
    montar("/confirmar-email?token=abc123");

    fireEvent.click(botaoConfirmar());

    expect(await screen.findByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
    expect(screen.queryByText(/não reconhecemos este link/i)).not.toBeInTheDocument();
    expect(screen.getByText(/seu link continua válido/i)).toBeInTheDocument();
  });

  it("token expirado aponta o caminho do reenvio", async () => {
    mocks.confirmarEmailComToken.mockResolvedValue("expirado");
    montar("/confirmar-email?token=velho");

    fireEvent.click(botaoConfirmar());

    expect(await screen.findByText(/este link não vale mais/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /entrar e reenviar/i })).toBeInTheDocument();
  });
});
