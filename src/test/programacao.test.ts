import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Programação do evento (migration 20261103160000). Sem tabela: o arquivo
 * em vigor é o mais recente do bucket. Guarda as duas políticas de erro
 * (pública vazia, gestão propaga) e a ordem do envio: sobe ANTES de apagar.
 */

const s = vi.hoisted(() => ({
  list: vi.fn(),
  createSignedUrl: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => s } },
}));

import {
  buscarProgramacao,
  carregarProgramacao,
  enviarProgramacao,
} from "@/services/programacaoService";

const LISTA = [
  { id: null, name: "pasta" },
  { id: "b", name: "1762200000000.pdf" },
  { id: "a", name: "1762100000000.png" },
];

beforeEach(() => {
  Object.values(s).forEach((f) => f.mockReset());
  s.createSignedUrl.mockImplementation(async (nome: string) => ({
    data: { signedUrl: `https://x/${nome}` },
    error: null,
  }));
});

describe("leitura", () => {
  it("pega o arquivo mais recente, pulando pasta, e reconhece PDF", async () => {
    s.list.mockResolvedValue({ data: LISTA, error: null });
    expect(await carregarProgramacao()).toEqual({ url: "https://x/1762200000000.pdf", pdf: true });
    expect(s.list.mock.calls[0][1].sortBy).toEqual({ column: "name", order: "desc" });
  });

  it("bucket vazio = null", async () => {
    s.list.mockResolvedValue({ data: [], error: null });
    expect(await carregarProgramacao()).toBeNull();
  });

  it("pública falha VAZIA; gestão PROPAGA", async () => {
    s.list.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await carregarProgramacao()).toBeNull();
    await expect(buscarProgramacao()).rejects.toThrow("boom");
  });
});

describe("enviarProgramacao", () => {
  it("sobe o novo e só depois apaga os antigos, nunca o novo", async () => {
    const ordem: string[] = [];
    s.upload.mockImplementation(async () => (ordem.push("upload"), { error: null }));
    s.list.mockImplementation(async () => ({ data: [...LISTA, { id: "c", name: "novo" }], error: null }));
    s.remove.mockImplementation(async () => (ordem.push("remove"), { error: null }));

    await enviarProgramacao(new File(["x"], "prog.png", { type: "image/png" }));

    expect(ordem).toEqual(["upload", "remove"]);
    const nomeNovo = s.upload.mock.calls[0][0] as string;
    expect(nomeNovo).toMatch(/^\d{13}\.png$/);
    expect(s.remove.mock.calls[0][0]).not.toContain(nomeNovo);
    expect(s.remove.mock.calls[0][0]).toContain("1762100000000.png");
  });

  it("upload recusado não apaga nada", async () => {
    s.upload.mockResolvedValue({ error: { message: "x" } });
    await expect(
      enviarProgramacao(new File(["x"], "p.pdf", { type: "application/pdf" })),
    ).rejects.toThrow();
    expect(s.remove).not.toHaveBeenCalled();
  });

  it("recusa tipo fora da lista sem subir", async () => {
    await expect(
      enviarProgramacao(new File(["x"], "p.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("PNG, JPEG ou PDF");
    expect(s.upload).not.toHaveBeenCalled();
  });
});
