import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * O download das prévias, em /co-chairs/certificados.
 *
 * O que só a tela garante: baixa o destinatário ESCOLHIDO (não o primeiro),
 * e baixa o RASCUNHO que está à vista — a prévia desenha o rascunho, e um
 * arquivo saído do modelo gravado seria diferente do que a pessoa conferiu.
 * O desenho em si (`baixarCertificado`) é o mesmo dos portais e fica fora.
 */

const mocks = vi.hoisted(() => ({
  baixar: vi.fn(),
  previa: vi.fn(),
  erro: vi.fn(),
  MODELO: {
    uso: "base",
    imagem: "modelos/base.png",
    largura: 2000,
    altura: 1414,
    caixas: [
      {
        x: 0.2,
        y: 0.4,
        l: 0.6,
        a: 0.15,
        texto: "Certificamos {titulo}",
        fonte: "Georgia",
        tamanho: 0.04,
        cor: "#1f2937",
        alinhamento: "center",
      },
    ],
    publicado_em: null,
    liberado_em: null,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: mocks.erro, success: vi.fn() } }));
vi.mock("@/services/configuracoesService", () => ({
  carregarConfiguracoes: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/services/certificadosService", () => ({
  baixarCertificado: mocks.baixar,
  previaCertificados: mocks.previa,
  listarModelos: vi.fn().mockResolvedValue({ base: mocks.MODELO }),
  listarFontes: vi.fn().mockResolvedValue([]),
  dataDosCertificadosChegou: vi.fn().mockResolvedValue(false),
  podioCongeladoEm: vi.fn().mockResolvedValue(null),
  carregarFontes: vi.fn().mockResolvedValue(undefined),
  desenharEm: vi.fn().mockResolvedValue(undefined),
  congelarPodio: vi.fn(),
  descartarArquivo: vi.fn(),
  despublicarCertificado: vi.fn(),
  enviarFonte: vi.fn(),
  enviarImagemModelo: vi.fn(),
  publicarCertificado: vi.fn(),
  salvarModelo: vi.fn(),
}));

import Certificados from "@/pages/co-chairs/Certificados";

const DOIS = [
  { chave: "t1", variaveis: { titulo: "Primeiro trabalho", autores: "Ana" } },
  { chave: "t2", variaveis: { titulo: "Segundo trabalho", autores: "Bia" } },
];

const botoes = () => screen.findAllByRole("button", { name: "Baixar" });

beforeEach(() => {
  mocks.baixar.mockReset().mockResolvedValue(undefined);
  mocks.previa.mockReset().mockResolvedValue(DOIS);
  mocks.erro.mockReset();
  // O jsdom não desenha: sem contexto, a conferência de fonte reduzida só não roda.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("download das prévias de certificado", () => {
  it("baixa o destinatário escolhido, com o nome de arquivo dele", async () => {
    render(<Certificados />);
    fireEvent.click((await botoes())[1]);

    await waitFor(() => expect(mocks.baixar).toHaveBeenCalledTimes(1));
    expect(mocks.baixar).toHaveBeenCalledWith(
      expect.objectContaining({ largura: 2000, altura: 1414, caixas: mocks.MODELO.caixas }),
      "modelos/base.png",
      DOIS[1].variaveis,
      "certificado-base-Segundo-trabalho.png",
    );
  });

  it("baixa o rascunho da tela, não o modelo gravado", async () => {
    render(<Certificados />);
    await botoes();
    fireEvent.change(screen.getByLabelText("Texto da caixa"), { target: { value: "Outro {titulo}" } });
    fireEvent.click((await botoes())[0]);

    await waitFor(() => expect(mocks.baixar).toHaveBeenCalledTimes(1));
    expect(mocks.baixar.mock.calls[0][0].caixas[0].texto).toBe("Outro {titulo}");
  });

  it("enquanto um é gerado, os outros botões esperam", async () => {
    let terminar = () => {};
    mocks.baixar.mockReturnValue(new Promise<void>((ok) => (terminar = ok)));
    render(<Certificados />);
    fireEvent.click((await botoes())[0]);

    expect(await screen.findByRole("button", { name: "Gerando..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Baixar" })).toBeDisabled();

    terminar();
    await waitFor(async () => expect((await botoes())[1]).toBeEnabled());
    expect(await botoes()).toHaveLength(2);
  });

  it("falha ao gerar avisa e devolve o botão", async () => {
    mocks.baixar.mockRejectedValue(new Error("Não foi possível gerar o certificado."));
    render(<Certificados />);
    fireEvent.click((await botoes())[0]);

    await waitFor(() => expect(mocks.erro).toHaveBeenCalledWith("Não foi possível gerar o certificado."));
    expect((await botoes())[0]).toBeEnabled();
  });

  it("sem destinatário, baixa a amostra com as variáveis por extenso", async () => {
    mocks.previa.mockResolvedValue([]);
    render(<Certificados />);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar amostra" }));

    await waitFor(() => expect(mocks.baixar).toHaveBeenCalledTimes(1));
    expect(mocks.baixar).toHaveBeenCalledWith(
      expect.objectContaining({ caixas: mocks.MODELO.caixas }),
      "modelos/base.png",
      {},
      "certificado-base.png",
    );
  });
});
