import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Tela /verifique-email — a metade visível do throttle.
 *
 * O cooldown do botão não é decoração: ele espelha o limite de 60 s que a
 * RPC `criar_token_email` impõe. E quem manda no número é o servidor — é o
 * `segundos` do 429 que vira contagem aqui. Se algum dia o service voltar a
 * perder esse campo, este teste cai junto.
 */

const mocks = vi.hoisted(() => ({
  enviarEmailDeVerificacao: vi.fn(),
  revalidarEmailConfirmado: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/services/verificacaoEmailService", () => ({
  enviarEmailDeVerificacao: mocks.enviarEmailDeVerificacao,
  emailEstaConfirmado: vi.fn(async () => false),
  confirmarEmailComToken: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: mocks.signOut } },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "maria@estudante.ufla.br", nome: "Maria" },
    role: "estudante",
    emailConfirmado: false,
    loading: false,
    revalidarEmailConfirmado: mocks.revalidarEmailConfirmado,
  }),
}));

import VerifiqueEmail from "@/pages/VerifiqueEmail";

function montar(state?: { enviado: boolean }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/verifique-email", state }]}>
      <VerifiqueEmail />
    </MemoryRouter>,
  );
}

const botaoReenviar = () => screen.getByRole("button", { name: /reenviar/i });

describe("/verifique-email", () => {
  beforeEach(() => {
    mocks.enviarEmailDeVerificacao.mockReset();
    mocks.revalidarEmailConfirmado.mockReset().mockResolvedValue(false);
  });

  it("mostra o e-mail da sessão e o aviso de spam", () => {
    montar();

    expect(screen.getByText("maria@estudante.ufla.br")).toBeInTheDocument();
    expect(screen.getByText(/spam/i)).toBeInTheDocument();
  });

  it("o 429 do servidor define a contagem do botão", async () => {
    mocks.enviarEmailDeVerificacao.mockResolvedValue({
      estado: "falha",
      erro: "aguarde",
      segundos: 58,
    });
    montar();

    fireEvent.click(botaoReenviar());

    await waitFor(() => expect(botaoReenviar()).toBeDisabled());
    // 58 (ou 57, se o primeiro tique já passou) — o número veio do servidor,
    // não de um palpite do cliente.
    expect(botaoReenviar()).toHaveTextContent(/REENVIAR EM 5[78]s/);
    expect(screen.getByRole("status")).toHaveTextContent(/aguarde 5[78] segundos/i);
  });

  it("envio bem-sucedido tranca o botão pelos 60 s do throttle", async () => {
    mocks.enviarEmailDeVerificacao.mockResolvedValue({ estado: "enviado", messageId: "<x@brevo>" });
    montar();

    fireEvent.click(botaoReenviar());

    await waitFor(() => expect(botaoReenviar()).toBeDisabled());
    expect(botaoReenviar()).toHaveTextContent(/REENVIAR EM (60|59)s/);
  });

  // Vindo do /cadastro o e-mail JÁ saiu: o botão nasce em contagem, para a
  // pessoa não gastar um clique só para receber um 429.
  it("chega do cadastro com o cooldown já rodando", () => {
    montar({ enviado: true });

    expect(botaoReenviar()).toBeDisabled();
    expect(botaoReenviar()).toHaveTextContent(/REENVIAR EM (60|59)s/);
    expect(mocks.enviarEmailDeVerificacao).not.toHaveBeenCalled();
  });

  it("falha de rede é dita como tal, e o botão continua utilizável", async () => {
    mocks.enviarEmailDeVerificacao.mockResolvedValue({
      estado: "falha",
      erro: "rede",
      segundos: null,
    });
    montar();

    fireEvent.click(botaoReenviar());

    expect(await screen.findByRole("status")).toHaveTextContent(/verifique sua conexão/i);
    expect(botaoReenviar()).not.toBeDisabled();
  });

  it("'já confirmei' relê o estado e avisa quando ainda não veio", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: /já confirmei/i }));

    await waitFor(() => expect(mocks.revalidarEmailConfirmado).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(/ainda não recebemos/i);
  });
});
