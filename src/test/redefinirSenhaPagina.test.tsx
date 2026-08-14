import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Tela /redefinir-senha — as propriedades que dependem do componente,
 * não da função pura (essa está em redefinirSenha.test.ts):
 *
 *  1. o token some da URL assim que é lido;
 *  2. NADA é consumido no mount — só no submit (pré-carregadores de
 *     links abrem a URL sozinhos; aqui o token autoriza TROCAR SENHA,
 *     então queimá-lo no mount seria ainda pior que na confirmação);
 *  3. erro de formulário (curta/divergente) não gasta viagem ao servidor;
 *  4. falha de rede vira "tentar de novo", nunca "link inválido".
 */

const mocks = vi.hoisted(() => ({
  trocarSenha: vi.fn(),
}));

vi.mock("@/services/redefinirSenhaService", () => ({
  trocarSenha: mocks.trocarSenha,
  solicitarRedefinicao: vi.fn(),
}));

import RedefinirSenha from "@/pages/RedefinirSenha";
import { MIN_SENHA } from "@/lib/cadastro";

const SENHA_VALIDA = "x".repeat(MIN_SENHA);

function montar(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter>
      <RedefinirSenha />
    </MemoryRouter>,
  );
}

function preencherSenhas(senha: string, confirmacao: string) {
  fireEvent.change(screen.getByLabelText("Nova senha"), { target: { value: senha } });
  fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
    target: { value: confirmacao },
  });
}

const botaoTrocar = () => screen.getByRole("button", { name: /trocar senha/i });

describe("/redefinir-senha", () => {
  beforeEach(() => {
    mocks.trocarSenha.mockReset();
  });

  it("sem token: mostra 'inválido' sem chamar o serviço", async () => {
    montar("/redefinir-senha");

    expect(await screen.findByText(/não reconhecemos este link/i)).toBeInTheDocument();
    expect(mocks.trocarSenha).not.toHaveBeenCalled();
  });

  it("tira o token da URL no mount e só consome no submit", async () => {
    mocks.trocarSenha.mockResolvedValue({ estado: "trocada" });
    montar("/redefinir-senha?token=abc123");

    // (1) o token saiu da URL...
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.location.pathname).toBe("/redefinir-senha");

    // (2) ...e ninguém consumiu nada ainda — o formulário só espera.
    expect(mocks.trocarSenha).not.toHaveBeenCalled();

    preencherSenhas(SENHA_VALIDA, SENHA_VALIDA);
    fireEvent.click(botaoTrocar());

    // (3) o valor guardado em memória é o que vai para o servidor.
    await waitFor(() =>
      expect(mocks.trocarSenha).toHaveBeenCalledWith("abc123", SENHA_VALIDA),
    );
    expect(await screen.findByText(/senha redefinida/i)).toBeInTheDocument();
  });

  it("senha curta é barrada no formulário, sem gastar o token", async () => {
    montar("/redefinir-senha?token=abc123");
    await screen.findByRole("button", { name: /trocar senha/i });

    const curta = "x".repeat(MIN_SENHA - 1);
    preencherSenhas(curta, curta);
    fireEvent.click(botaoTrocar());

    expect(await screen.findByText(new RegExp(`${MIN_SENHA} caracteres`))).toBeInTheDocument();
    expect(mocks.trocarSenha).not.toHaveBeenCalled();
  });

  it("confirmação divergente é barrada no formulário", async () => {
    montar("/redefinir-senha?token=abc123");
    await screen.findByRole("button", { name: /trocar senha/i });

    preencherSenhas(SENHA_VALIDA, `${SENHA_VALIDA}!`);
    fireEvent.click(botaoTrocar());

    expect(await screen.findByText(/não coincidem/i)).toBeInTheDocument();
    expect(mocks.trocarSenha).not.toHaveBeenCalled();
  });

  it("token recusado pelo servidor vira 'link inválido'", async () => {
    mocks.trocarSenha.mockResolvedValue({ estado: "falha", erro: "token_invalido" });
    montar("/redefinir-senha?token=lixo");
    await screen.findByRole("button", { name: /trocar senha/i });

    preencherSenhas(SENHA_VALIDA, SENHA_VALIDA);
    fireEvent.click(botaoTrocar());

    expect(await screen.findByText(/não reconhecemos este link/i)).toBeInTheDocument();
  });

  it("link usado e expirado apontam para pedir novo link", async () => {
    mocks.trocarSenha.mockResolvedValue({ estado: "falha", erro: "token_expirado" });
    montar("/redefinir-senha?token=velho");
    await screen.findByRole("button", { name: /trocar senha/i });

    preencherSenhas(SENHA_VALIDA, SENHA_VALIDA);
    fireEvent.click(botaoTrocar());

    expect(await screen.findByText(/este link não vale mais/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /pedir novo link/i })).toBeInTheDocument();
  });

  it("falha de rede oferece tentar de novo, e não condena o link", async () => {
    mocks.trocarSenha.mockResolvedValue({ estado: "falha", erro: "rede" });
    montar("/redefinir-senha?token=abc123");
    await screen.findByRole("button", { name: /trocar senha/i });

    preencherSenhas(SENHA_VALIDA, SENHA_VALIDA);
    fireEvent.click(botaoTrocar());

    expect(await screen.findByRole("button", { name: /tentar de novo/i })).toBeInTheDocument();
    expect(screen.queryByText(/não reconhecemos este link/i)).not.toBeInTheDocument();
    expect(screen.getByText(/seu link continua válido/i)).toBeInTheDocument();

    // Tentar de novo volta ao formulário com o token ainda em memória.
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    mocks.trocarSenha.mockResolvedValue({ estado: "trocada" });
    preencherSenhas(SENHA_VALIDA, SENHA_VALIDA);
    fireEvent.click(botaoTrocar());
    await waitFor(() =>
      expect(mocks.trocarSenha).toHaveBeenLastCalledWith("abc123", SENHA_VALIDA),
    );
  });
});
