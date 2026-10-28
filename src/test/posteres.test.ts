import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Pôsteres (migration 20261027180000) — o lado cliente.
 *
 * Quem decide é o servidor (`enviar_posteres`, `aplicar_anexos`, provados
 * por sql/ensaio-posteres.sql). O que fica preso aqui:
 *
 *   1. **As telas de submissão nunca recebem a exigência de pôster.** Elas
 *      montam os campos com `exigenciasDe`; se o pôster escapasse para lá,
 *      o autor veria um campo que o banco recusa preenchido.
 *   2. **O envio limpa o Storage nos dois sentidos**: o pôster trocado sai
 *      do bucket depois da gravação, e o arquivo recém-subido sai quando a
 *      RPC recusa — senão cada tentativa recusada deixaria um PDF pago.
 */

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  },
}));
vi.mock("@/services/categoriasService", () => ({
  listarAnexosPorCategoria: mocks.listar,
}));

import { useExigencias } from "@/pages/estudante/shared";
import { enviarPosteres } from "@/services/anexosService";
import type { AnexoDaCategoria } from "@/lib/anexos";

const exigencia = (id: string, poster: boolean): AnexoDaCategoria => ({
  id,
  categoria_id: "c1",
  tipo: "pdf",
  titulo: poster ? "Pôster" : "Trabalho completo",
  descricao: "",
  obrigatorio: !poster,
  poster,
  ordem: poster ? 2 : 1,
});

const PDF = () => new File([new Uint8Array(10)], "poster.pdf", { type: "application/pdf" });

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
});

describe("useExigencias", () => {
  it("a submissão nunca recebe o pôster; o diálogo do pôster só recebe o pôster", async () => {
    mocks.listar.mockResolvedValue({ c1: [exigencia("a1", false), exigencia("p1", true)] });
    const { result } = renderHook(() => useExigencias());
    await waitFor(() => expect(result.current.carregando).toBe(false));

    expect(result.current.exigenciasDe("c1").map((a) => a.id)).toEqual(["a1"]);
    expect(result.current.posteresDe("c1").map((a) => a.id)).toEqual(["p1"]);
    expect(result.current.posteresDe(null)).toEqual([]);
  });
});

describe("enviarPosteres", () => {
  const args = () => ({
    trabalhoId: "t1",
    posteres: [exigencia("p1", true)],
    rascunho: { p1: { arquivo: PDF() } },
    ownerId: "u1",
  });

  it("sobe na pasta do dono, grava pela RPC e apaga o pôster que foi trocado", async () => {
    mocks.rpc.mockResolvedValue({ data: ["u1/poster-velho.pdf"], error: null });
    await enviarPosteres(args());

    const [nome, corpo] = mocks.rpc.mock.calls[0];
    expect(nome).toBe("enviar_posteres");
    expect(corpo._trabalho_id).toBe("t1");
    expect(corpo._anexos).toHaveLength(1);
    expect(corpo._anexos[0].anexo_id).toBe("p1");
    expect(corpo._anexos[0].valor).toMatch(/^u1\/\d+-poster\.pdf$/);
    expect(mocks.remove).toHaveBeenCalledWith(["u1/poster-velho.pdf"]);
  });

  it("recusado pelo banco: apaga o que acabou de subir e devolve a frase dele", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Só trabalhos aprovados enviam pôster." } });
    const erro = await enviarPosteres(args()).catch((e) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("Só trabalhos aprovados enviam pôster.");
    const subido = mocks.rpc.mock.calls[0][1]._anexos[0].valor;
    expect(mocks.remove).toHaveBeenCalledWith([subido]);
  });
});
