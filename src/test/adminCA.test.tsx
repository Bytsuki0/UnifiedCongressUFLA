import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * AdminCA (/co-chairs/admin-ca) — o Salvar que manda e-mail.
 *
 * As regras que este teste prende:
 *
 *   1. **Nada a salvar, nada a clicar**: o Salvar nasce desabilitado.
 *   2. **O diálogo diz quantos autores vão receber e-mail ANTES** de a RPC
 *      ser chamada — o e-mail não tem volta. Agenda nova conta; tipo da
 *      categoria alterado conta cada trabalho já agendado nela.
 *   3. **A RPC recebe só o que mudou**, horas em 'HH:MM' e sala aparada.
 *   4. **Linha pela metade trava o Salvar** sem abrir o diálogo: o servidor
 *      recusaria o lote inteiro.
 */

const mocks = vi.hoisted(() => ({
  carregarAdminCA: vi.fn(),
  salvarCronogramaApresentacoes: vi.fn(),
  toastErro: vi.fn(),
  toastOk: vi.fn(),
}));

vi.mock("@/services/apresentacoesService", () => ({
  carregarAdminCA: mocks.carregarAdminCA,
  salvarCronogramaApresentacoes: mocks.salvarCronogramaApresentacoes,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastErro, success: mocks.toastOk } }));

import AdminCA from "@/pages/co-chairs/AdminCA";

const DADOS = {
  trabalhos: [
    { id: "t1", titulo: "Robótica na escola", autores: "Ana Souza", categoria_id: "c1", owner_id: "u1" },
    { id: "t2", titulo: "Café e clima", autores: "João Lima", categoria_id: "c1", owner_id: "u2" },
    { id: "t3", titulo: "Hortas", autores: "Lucas Ferreira", categoria_id: "c2", owner_id: null },
  ],
  categorias: [
    { id: "c1", nome: "BIC Jr", tipo_apresentacao: "Pôster" },
    { id: "c2", nome: "Pesquisa", tipo_apresentacao: "" },
  ],
  apresentacoes: [
    {
      id: "a1",
      trabalho_id: "t1",
      data: "2026-11-20",
      hora_inicio: "14:00:00",
      hora_fim: "14:15:00",
      sala: "Sala 101",
      aviso_solicitado_em: "2026-11-04T10:00:00+00:00",
      aviso_reservado_em: "2026-11-04T10:01:00+00:00",
    },
  ],
  envios: [
    {
      id: "e1",
      trabalhos_ids: ["t1"],
      status: "enviado" as const,
      erro: null,
      criado_em: "2026-11-04T10:01:00+00:00",
      concluido_em: "2026-11-04T10:01:05+00:00",
    },
  ],
};

const abrir = async () => {
  mocks.carregarAdminCA.mockResolvedValue(DADOS);
  render(<AdminCA />);
  await screen.findByText("Robótica na escola");
};

const agendar = (titulo: string, dia: string, inicio: string, fim: string, sala: string) => {
  fireEvent.change(screen.getByLabelText(`Dia da apresentação de ${titulo}`), { target: { value: dia } });
  fireEvent.change(screen.getByLabelText(`Início da apresentação de ${titulo}`), { target: { value: inicio } });
  fireEvent.change(screen.getByLabelText(`Fim da apresentação de ${titulo}`), { target: { value: fim } });
  fireEvent.change(screen.getByLabelText(`Sala da apresentação de ${titulo}`), { target: { value: sala } });
};

const botaoSalvar = () => screen.getByRole("button", { name: /^Salvar$/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminCA", () => {
  it("mostra o que está gravado, com o selo do e-mail, e nasce sem nada a salvar", async () => {
    await abrir();
    expect(screen.getByLabelText("Sala da apresentação de Robótica na escola")).toHaveValue("Sala 101");
    // `time` do Postgres chega com segundos; o campo mostra 'HH:MM'.
    expect(screen.getByLabelText("Início da apresentação de Robótica na escola")).toHaveValue("14:00");
    expect(screen.getByText("enviado")).toBeTruthy();
    expect(botaoSalvar()).toBeDisabled();
  });

  it("agenda nova: o diálogo diz quem vai ser avisado, e a RPC recebe só a mudança", async () => {
    mocks.salvarCronogramaApresentacoes.mockResolvedValue(1);
    await abrir();

    agendar("Café e clima", "2026-11-20", "14:15", "14:30", "  Sala 101 ");
    expect(screen.getByText("novo")).toBeTruthy();

    fireEvent.click(botaoSalvar());
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/1 trabalho com informação nova/)).toBeTruthy();
    expect(mocks.salvarCronogramaApresentacoes).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mocks.salvarCronogramaApresentacoes).toHaveBeenCalledTimes(1));
    expect(mocks.salvarCronogramaApresentacoes).toHaveBeenCalledWith(
      [],
      [{ trabalho_id: "t2", data: "2026-11-20", hora_inicio: "14:15", hora_fim: "14:30", sala: "Sala 101" }],
    );
    await waitFor(() => expect(mocks.toastOk).toHaveBeenCalled());
  });

  it("tipo da categoria alterado conta cada trabalho já agendado nela", async () => {
    mocks.salvarCronogramaApresentacoes.mockResolvedValue(1);
    await abrir();

    fireEvent.change(screen.getByLabelText("Tipo de apresentação", { selector: "#tipo-c1" }), {
      target: { value: "Apresentação oral" },
    });

    fireEvent.click(botaoSalvar());
    const dialogo = await screen.findByRole("alertdialog");
    // Só o t1 está agendado na c1; o t2 não tem agenda, e o t3 é de outra categoria.
    expect(within(dialogo).getByText(/1 trabalho com informação nova/)).toBeTruthy();
    expect(within(dialogo).getByText(/1 categoria muda/)).toBeTruthy();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(mocks.salvarCronogramaApresentacoes).toHaveBeenCalledWith(
        [{ categoria_id: "c1", tipo: "Apresentação oral" }],
        [],
      ),
    );
  });

  it("linha pela metade trava o Salvar sem abrir o diálogo", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Dia da apresentação de Café e clima"), {
      target: { value: "2026-11-20" },
    });

    fireEvent.click(botaoSalvar());
    expect(mocks.toastErro).toHaveBeenCalledWith(expect.stringMatching(/pela metade/));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.salvarCronogramaApresentacoes).not.toHaveBeenCalled();
  });

  it("limpar um trabalho agendado o tira do cronograma, sem e-mail", async () => {
    mocks.salvarCronogramaApresentacoes.mockResolvedValue(0);
    await abrir();

    const linha = screen.getByText("Robótica na escola").closest("tr")!;
    fireEvent.click(within(linha).getByRole("button", { name: /Limpar/ }));
    expect(within(linha).getByText("sai do cronograma")).toBeTruthy();

    fireEvent.click(botaoSalvar());
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/nenhum e-mail vai sair/)).toBeTruthy();
    expect(within(dialogo).getByText(/1 trabalho sai do cronograma/)).toBeTruthy();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(mocks.salvarCronogramaApresentacoes).toHaveBeenCalledWith([], [{ trabalho_id: "t1", remover: true }]),
    );
  });
});
