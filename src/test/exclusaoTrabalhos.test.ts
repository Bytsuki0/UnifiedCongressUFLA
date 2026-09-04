import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exclusão de trabalhos pelo Portal Admin — a limpeza de fim de edição.
 *
 * O que este arquivo trava:
 *
 * 1. **A ordem.** A linha sai primeiro, os PDFs depois. `pareceres`,
 *    `avaliacoes`, `trabalho_revisores` e `trabalho_anexos` acompanham
 *    por ON DELETE CASCADE, mas o blob do Storage NÃO sai por SQL. Na
 *    ordem inversa, um DELETE recusado deixaria um trabalho vivo
 *    apontando para arquivos que não existem mais; nesta, o pior caso é
 *    um órfão.
 *
 *    ⚠ Desde 20260904 os caminhos vêm de `trabalho_anexos`, e a leitura
 *    prévia deixou de ser conveniência: as linhas de anexo somem no
 *    CASCADE, então depois do DELETE não há mais como saber o que apagar.
 *
 * 2. **DELETE recusado não encosta no Storage.** É o corolário de (1) e
 *    o caso que o RLS produz de verdade: quem não é `is_event_staff()`
 *    leva recusa na linha e não pode levar o PDF junto.
 *
 * 3. **URL legada de outro bucket não vira `remove()`.** `valor` guarda
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
  // `caminhosDosAnexos` encadeia select.in.eq; o DELETE encadeia
  // delete.eq / delete.in.select.
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
      {
        data: [{ trabalho_id: "t1", valor: "abc-123/1754000000000-artigo.pdf" }],
        error: null,
      },
      { data: null, error: null },
    ];

    await excluirTrabalho("t1");

    expect(mocks.ordem).toEqual(["select.in.eq", "delete.eq", "storage.remove"]);
    expect(mocks.remove).toHaveBeenCalledWith(["abc-123/1754000000000-artigo.pdf"]);
  });

  /**
   * Um trabalho pode ter vários PDFs agora (a categoria decide quantos).
   * Todos saem na MESMA chamada — uma por arquivo multiplicaria os
   * requests e deixaria a limpeza pela metade se uma delas falhasse.
   */
  it("apaga todos os PDFs do trabalho numa chamada só", async () => {
    mocks.respostas = [
      {
        data: [
          { trabalho_id: "t1", valor: "u1/relatorio.pdf" },
          { trabalho_id: "t1", valor: "u1/plano.pdf" },
        ],
        error: null,
      },
      { data: null, error: null },
    ];

    await excluirTrabalho("t1");

    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(["u1/relatorio.pdf", "u1/plano.pdf"]);
  });

  // Invariante 2: o RLS recusou a linha — o arquivo fica onde está.
  it("não toca no Storage quando o banco recusa o DELETE", async () => {
    mocks.respostas = [
      { data: [{ trabalho_id: "t1", valor: "abc-123/artigo.pdf" }], error: null },
      { data: null, error: { message: "row-level security" } },
    ];

    await expect(excluirTrabalho("t1")).rejects.toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  // Categoria sem exigência de PDF — legítimo desde 20260904.
  it("apaga a linha mesmo sem PDF associado", async () => {
    mocks.respostas = [{ data: [], error: null }, { data: null, error: null }];

    await excluirTrabalho("t1");

    expect(mocks.ordem).toEqual(["select.in.eq", "delete.eq"]);
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
    mocks.respostas = [
      { data: [{ trabalho_id: "t1", valor: pdfUrl }], error: null },
      { data: null, error: null },
    ];

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
          { trabalho_id: "t1", valor: "u1/a.pdf" },
          { trabalho_id: "t2", valor: "u2/b.pdf" },
          { trabalho_id: "t3", valor: "u3/c.pdf" },
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
      { data: [{ trabalho_id: "t1", valor: "u1/a.pdf" }], error: null },
      { data: null, error: { message: "boom" } },
    ];

    await expect(excluirTrabalhos(["t1"])).rejects.toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
