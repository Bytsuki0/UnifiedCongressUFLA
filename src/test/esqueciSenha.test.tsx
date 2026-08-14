import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Tela /esqueci-senha — o que ela NÃO pode fazer é tão importante quanto
 * o que faz:
 *
 *  1. o sucesso é a frase condicional ("SE este e-mail pertencer...") —
 *     a tela nunca diz "e-mail não cadastrado", senão o formulário
 *     público vira oráculo de quem tem conta (anti-enumeração);
 *  2. o 429 por IP trava o botão com a contagem vinda do servidor;
 *  3. falha de rede devolve o formulário utilizável.
 */

const mocks = vi.hoisted(() => ({
  solicitarRedefinicao: vi.fn(),
}));

vi.mock("@/services/redefinirSenhaService", () => ({
  solicitarRedefinicao: mocks.solicitarRedefinicao,
  trocarSenha: vi.fn(),
}));

import EsqueciSenha from "@/pages/EsqueciSenha";

function montar() {
  return render(
    <MemoryRouter>
      <EsqueciSenha />
    </MemoryRouter>,
  );
}

const campoEmail = () => screen.getByLabelText("E-mail");
const botaoEnviar = () => screen.getByRole("button", { name: /enviar link/i });

describe("/esqueci-senha", () => {
  beforeEach(() => {
    mocks.solicitarRedefinicao.mockReset();
  });

  it("envia o e-mail digitado e mostra o sucesso genérico", async () => {
    mocks.solicitarRedefinicao.mockResolvedValue({ estado: "aceito" });
    montar();

    fireEvent.change(campoEmail(), { target: { value: "alguem@ufla.br" } });
    fireEvent.click(botaoEnviar());

    await waitFor(() =>
      expect(mocks.solicitarRedefinicao).toHaveBeenCalledWith("alguem@ufla.br"),
    );
    // A frase é condicional DE PROPÓSITO: mesma resposta para conta
    // existente, inexistente, não confirmada ou em cooldown.
    expect(
      await screen.findByText(/se este e-mail pertencer a uma conta confirmada/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/não cadastrado/i)).not.toBeInTheDocument();
  });

  it("sem e-mail: não chama o serviço", async () => {
    montar();

    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(mocks.solicitarRedefinicao).not.toHaveBeenCalled());
  });

  it("429 por IP trava o botão e mostra a contagem do servidor", async () => {
    mocks.solicitarRedefinicao.mockResolvedValue({
      estado: "falha",
      erro: "aguarde",
      segundos: 120,
    });
    montar();

    fireEvent.change(campoEmail(), { target: { value: "alguem@ufla.br" } });
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/muitas tentativas/i)).toBeInTheDocument();
    expect(screen.getByText(/2 minutos/i)).toBeInTheDocument();
    expect(botaoEnviar()).toBeDisabled();
  });

  it("e-mail inválido volta como aviso no formulário", async () => {
    mocks.solicitarRedefinicao.mockResolvedValue({
      estado: "falha",
      erro: "email_invalido",
      segundos: null,
    });
    montar();

    fireEvent.change(campoEmail(), { target: { value: "isso-nao-e-email" } });
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/e-mail válido/i)).toBeInTheDocument();
    expect(botaoEnviar()).not.toBeDisabled();
  });

  it("falha de rede devolve o formulário utilizável", async () => {
    mocks.solicitarRedefinicao.mockResolvedValue({
      estado: "falha",
      erro: "rede",
      segundos: null,
    });
    montar();

    fireEvent.change(campoEmail(), { target: { value: "alguem@ufla.br" } });
    fireEvent.click(botaoEnviar());

    await waitFor(() => expect(botaoEnviar()).not.toBeDisabled());
    // Continua no formulário, não na tela de sucesso.
    expect(screen.queryByText(/pedido recebido/i)).not.toBeInTheDocument();
  });
});
