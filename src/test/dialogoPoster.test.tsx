import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * O diálogo do pôster, em /estudante/papeis-submetidos.
 *
 * Duas coisas que só a tela garante: sem arquivo escolhido ele não chama a
 * RPC (que não gravaria nada, e o "Pôster enviado" do toast seria mentira),
 * e com pôster já entregue ele mostra a versão atual e fala em SUBSTITUIR.
 */

const mocks = vi.hoisted(() => ({ enviar: vi.fn(), erro: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/services/anexosService", () => ({ enviarPosteres: mocks.enviar }));
vi.mock("sonner", () => ({ toast: { error: mocks.erro, success: vi.fn() } }));

import { DialogoPoster } from "@/components/estudante/DialogoPoster";
import type { AnexoDaCategoria, AnexoDoTrabalho } from "@/lib/anexos";

const POSTER: AnexoDaCategoria = {
  id: "p1",
  categoria_id: "c1",
  tipo: "pdf",
  titulo: "Pôster",
  descricao: "",
  obrigatorio: false,
  poster: true,
  ordem: 2,
};

const ENTREGUE: AnexoDoTrabalho = {
  id: "e1",
  anexo_id: "p1",
  tipo: "pdf",
  titulo: "Pôster",
  ordem: 2,
  valor: "u1/poster.pdf",
  poster: true,
};

const abrir = (atuais: AnexoDoTrabalho[]) =>
  render(
    <DialogoPoster
      trabalho={{ id: "t1", titulo: "Meu trabalho" }}
      posteres={[POSTER]}
      atuais={atuais}
      ownerId="u1"
      onFechar={() => {}}
      onEnviado={() => {}}
    />,
  );

beforeEach(() => {
  mocks.enviar.mockReset();
  mocks.erro.mockReset();
});

describe("DialogoPoster", () => {
  it("sem arquivo escolhido não chama a RPC", () => {
    abrir([]);
    fireEvent.click(screen.getByRole("button", { name: "ENVIAR PÔSTER" }));
    expect(mocks.erro).toHaveBeenCalledWith("Escolha o PDF do pôster.");
    expect(mocks.enviar).not.toHaveBeenCalled();
  });

  it("com pôster já entregue, mostra a versão atual e oferece substituir", () => {
    abrir([ENTREGUE]);
    expect(screen.getByText("Versão atual")).toBeTruthy();
    expect(screen.getByRole("button", { name: "SUBSTITUIR PÔSTER" })).toBeTruthy();
  });
});
