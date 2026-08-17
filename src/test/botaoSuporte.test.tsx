import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Botão de suporte da barra superior.
 *
 * O endereço tem de aparecer NA TELA, e não só num `mailto:`. Era essa a
 * falha da versão anterior: o clique disparava o cliente de e-mail e,
 * para quem não tem um configurado no navegador, não acontecia nada —
 * o usuário ficava sem saber para onde escrever. Por isso o teste checa
 * o texto visível, não o href.
 */

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { BotaoSuporte } from "@/components/BotaoSuporte";
import { SUPPORT_EMAIL } from "@/lib/brand";

/** Substitui a área de transferência; jsdom não traz uma. */
function comClipboard(writeText: () => Promise<void>) {
  Object.assign(navigator, { clipboard: { writeText } });
}

describe("BotaoSuporte", () => {
  beforeEach(() => {
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it("só mostra o endereço depois do clique", async () => {
    render(<BotaoSuporte />);
    expect(screen.queryByText(SUPPORT_EMAIL)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /suporte/i }));
    expect(await screen.findByText(SUPPORT_EMAIL)).toBeTruthy();
  });

  it("copia o endereço e confirma", async () => {
    const writeText = vi.fn(async () => {});
    comClipboard(writeText);

    render(<BotaoSuporte />);
    fireEvent.click(screen.getByRole("button", { name: /suporte/i }));
    fireEvent.click(await screen.findByRole("button", { name: /copiar/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SUPPORT_EMAIL));
    expect(mocks.success).toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  // Contexto inseguro ou permissão negada: o endereço continua na tela,
  // então o pior caso é copiar à mão — mas o usuário precisa SABER que
  // não foi copiado, senão cola outra coisa sem perceber.
  it("avisa quando não consegue copiar", async () => {
    comClipboard(vi.fn(async () => { throw new Error("negado"); }));
    // O fallback (execCommand) também não existe em jsdom por padrão.
    Object.assign(document, { execCommand: vi.fn(() => false) });

    render(<BotaoSuporte />);
    fireEvent.click(screen.getByRole("button", { name: /suporte/i }));
    fireEvent.click(await screen.findByRole("button", { name: /copiar/i }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
