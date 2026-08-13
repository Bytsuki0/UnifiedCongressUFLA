import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exclusão de trabalhos pelo Portal Admin — a limpeza de fim de edição.
 *
 * O que este arquivo trava:
 *
 * 1. **A ordem.** A linha sai primeiro, o PDF depois. `pareceres`,
 *    `avaliacoes` e `trabalho_revisores` acompanham por ON DELETE
 *    CASCADE, mas o blob do Storage NÃO sai por SQL. Na ordem inversa,
 *    um DELETE recusado deixaria um trabalho vivo apontando para um
 *    arquivo que não existe mais; nesta, o pior caso é um órfão.
 *
 * 2. **DELETE recusado não encosta no Storage.** É o corolário de (1) e
 *    o caso que o RLS produz de verdade: quem não é `is_event_staff()`
 *    leva recusa na linha e não pode levar o PDF junto.
 *
 * 3. **URL legada de outro bucket não vira `remove()`.** `pdf_url` guarda
 *    o caminho no formato novo, mas linhas antigas guardam a URL pública
 *    inteira, de quando o bucket ainda era público. Parsear e apagar às
 *    cegas apagaria o objeto errado, em outro bucket.
 *
 * 4. **A contagem do lote é a do banco, não a do pedido.** Um DELETE
 *    parcialmente recusado pelo RLS não vira erro — volta silenciosamente
 *    com menos linhas. Reportar `ids.length` mentiria para o admin.
 */

const mocks = vi.hoisted(() => ({
  /** Fila de respostas, na ordem em que o service consulta o banco. */
  respostas: [] as unknown[],
  /** Trilha das operações, para provar a ordem. */
  ordem: [] as string[],
  remove: vi.fn(),
}));

/**
 * Cadeia falsa do postgrest-js: todo método encadeável devolve a si
 * mesmo e registra o passo; `await` (ou `maybeSingle`) fecha a cadeia,
 * anota a trilha e entrega a próxima resposta da fila.
 */
function cadeia() {
  const passos: string[] = [];
  const entregar = () => {
    mocks.ordem.push(passos.join("."));
    return Promise.resolve(mocks.respostas.shift() ?? { data: null, error: null });
  };
  const obj: Record<string, unknown> = {
    maybeSingle: () => entregar(),
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => entregar().then(ok, err),
  };
  for (const metodo of ["select", "eq", "in", "delete"]) {
    obj[metodo] = () => {
      passos.push(metodo);
      return obj;
    };
  }
  return obj;
}

vi.mock("@/lib/config", () => ({ PDF_BUCKET: "Pdfs" }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => cadeia(),
    storage: {
      from: () => ({
        remove: (caminhos: string[]) => {
          mocks.ordem.push("storage.remove");
          mocks.remove(caminhos);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  },
}));

import { excluirTrabalho, excluirTrabalhos } from "@/services/trabalhosService";

beforeEach(() => {
  mocks.respostas = [];
  mocks.ordem = [];
  mocks.remove.mockReset();
});

describe("excluirTrabalho", () => {
  it("apaga a linha antes do PDF", async () => {
    mocks.respostas = [
      { data: { pdf_url: "abc-123/1754000000000-artigo.pdf" }, error: null },
      { data: null, error: null },
    ];

    await excluirTrabalho("t1");

    expect(mocks.ordem).toEqual(["select.eq", "delete.eq", "storage.remove"]);
    expect(mocks.remove).toHaveBeenCalledWith(["abc-123/1754000000000-artigo.pdf"]);
  });

  // Invariante 2: o RLS recusou a linha — o arquivo fica onde está.
  it("não toca no Storage quando o banco recusa o DELETE", async () => {
    mocks.respostas = [
      { data: { pdf_url: "abc-123/artigo.pdf" }, error: null },
      { data: null, error: { message: "row-level security" } },
    ];

    await expect(excluirTrabalho("t1")).rejects.toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("apaga a linha mesmo sem PDF associado", async () => {
    mocks.respostas = [{ data: { pdf_url: null }, error: null }, { data: null, error: null }];

    await excluirTrabalho("t1");

    expect(mocks.ordem).toEqual(["select.eq", "delete.eq"]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  // Invariante 3.
  it.each([
    [
      "URL legada do próprio bucket",
      "https://proj.supabase.co/storage/v1/object/public/Pdfs/abc-123/meu%20artigo.pdf",
      ["abc-123/meu artigo.pdf"],
    ],
    [
      "URL legada de OUTRO bucket",
      "https://proj.supabase.co/storage/v1/object/public/certificates/abc-123/x.pdf",
      null,
    ],
    ["URL fora do Storage", "https://exemplo.org/arquivo.pdf", null],
  ])("%s", async (_caso, pdfUrl, esperado) => {
    mocks.respostas = [{ data: { pdf_url: pdfUrl }, error: null }, { data: null, error: null }];

    await excluirTrabalho("t1");

    if (esperado) expect(mocks.remove).toHaveBeenCalledWith(esperado);
    else expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe("excluirTrabalhos", () => {
  it("devolve quantas linhas o banco apagou, não quantas foram pedidas", async () => {
    mocks.respostas = [
      {
        data: [
          { id: "t1", pdf_url: "u1/a.pdf" },
          { id: "t2", pdf_url: "u2/b.pdf" },
          { id: "t3", pdf_url: "u3/c.pdf" },
        ],
        error: null,
      },
      // O RLS deixou passar só duas — e isso NÃO vem como erro.
      { data: [{ id: "t1" }, { id: "t3" }], error: null },
    ];

    expect(await excluirTrabalhos(["t1", "t2", "t3"])).toBe(2);
    // E o PDF de t2 continua onde estava.
    expect(mocks.remove).toHaveBeenCalledWith(["u1/a.pdf", "u3/c.pdf"]);
  });

  it("lista vazia não vai ao banco", async () => {
    expect(await excluirTrabalhos([])).toBe(0);
    expect(mocks.ordem).toEqual([]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("erro no DELETE em lote não toca no Storage", async () => {
    mocks.respostas = [
      { data: [{ id: "t1", pdf_url: "u1/a.pdf" }], error: null },
      { data: null, error: { message: "boom" } },
    ];

    await expect(excluirTrabalhos(["t1"])).rejects.toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
