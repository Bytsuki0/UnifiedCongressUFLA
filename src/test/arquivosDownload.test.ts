import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Arquivos para download — o lado cliente (migration 20260830120000).
 *
 * A invariante aqui é o INVERSO da do prazo, e de propósito: o prazo
 * falha ABERTO ("não sei" não tranca ninguém, porque quem recusa é o
 * banco), e o download falha VAZIO. Não há autoridade nenhuma do outro
 * lado de um href: mandar o usuário para um endereço que a organização
 * não cadastrou só produz uma aba de erro. Não mostrar o cartão é a
 * resposta honesta.
 *
 * O segundo grupo de testes guarda a outra metade: `listarArquivosDownload`
 * é a leitura da TELA DE EDIÇÃO e PROPAGA o erro. Quem está publicando
 * arquivo não pode receber lista vazia por falha de rede e concluir que
 * não há nada publicado — acrescentaria em cima de um estado que não é
 * o do banco.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

import {
  carregarArquivosDownload,
  listarArquivosDownload,
} from "@/services/configuracoesService";

const RESPOSTA = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    grupo: "estudante",
    titulo: "Modelo de artigo · Word",
    url: "https://drive.google.com/file/word",
    formato: ".DOCX",
    descricao: "",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    grupo: "revisor",
    titulo: "Código de Ética",
    url: "https://drive.google.com/file/etica",
    formato: "PDF",
    descricao: "Normas de conduta",
  },
];

describe("carregarArquivosDownload (leitura pública)", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("devolve o que o servidor respondeu, na ordem em que veio", async () => {
    mocks.rpc.mockResolvedValue({ data: RESPOSTA, error: null });
    expect(await carregarArquivosDownload()).toEqual(RESPOSTA);
    expect(mocks.rpc).toHaveBeenCalledWith("arquivos_download_publicos");
  });

  it.each([
    ["erro do banco", { data: null, error: { message: "boom" } }],
    ["RPC ausente (migration não aplicada)", { data: null, error: { code: "PGRST202" } }],
    ["sem data", { data: null, error: null }],
  ])("falha (%s) devolve lista vazia, nunca um link inventado", async (_caso, resposta) => {
    mocks.rpc.mockResolvedValue(resposta);
    expect(await carregarArquivosDownload()).toEqual([]);
  });

  // Lista vazia é estado LEGÍTIMO — a organização ainda não publicou.
  // Não pode virar erro: derrubaria a landing inteira por isso.
  it("lista vazia do servidor não é erro", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(carregarArquivosDownload()).resolves.toEqual([]);
  });
});

describe("listarArquivosDownload (tela de edição)", () => {
  beforeEach(() => mocks.from.mockReset());

  const encadeia = (resposta: unknown) => {
    const consulta = {
      select: vi.fn(() => consulta),
      // `.order()` é chamado três vezes seguidas; devolver a si mesmo é
      // o que espelha o encadeamento do supabase-js.
      order: vi.fn(() => consulta),
      then: (aceita: (r: unknown) => unknown) => Promise.resolve(resposta).then(aceita),
    };
    mocks.from.mockReturnValue(consulta);
    return consulta;
  };

  it("devolve as linhas da tabela", async () => {
    encadeia({ data: RESPOSTA, error: null });
    expect(await listarArquivosDownload()).toEqual(RESPOSTA);
  });

  // O oposto de `carregarArquivosDownload`, e é o ponto do teste.
  it("PROPAGA o erro em vez de devolver lista vazia", async () => {
    encadeia({ data: null, error: { message: "permission denied" } });
    await expect(listarArquivosDownload()).rejects.toThrow("permission denied");
  });
});
