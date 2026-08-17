import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Links de download — o lado cliente.
 *
 * A invariante aqui é o INVERSO da do prazo, e de propósito: o prazo
 * falha ABERTO ("não sei" não tranca ninguém, porque quem recusa é o
 * banco), e o link falha VAZIO. Não há autoridade nenhuma do outro lado
 * de um href: mandar o usuário para um endereço que a organização não
 * cadastrou só produz uma aba de erro. Botão desabilitado, dizendo que
 * falta configurar, é a resposta honesta.
 *
 * Ver `BotaoBaixar`: string vazia é o que desabilita o botão.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: vi.fn() },
}));

import { carregarLinksDownloads, LINKS_VAZIOS } from "@/services/configuracoesService";

const RESPOSTA_COMPLETA = {
  link_template_word: "https://drive.google.com/file/word",
  link_template_latex: "https://drive.google.com/file/latex",
  link_template_slides: "https://drive.google.com/file/slides",
  link_normas_formatacao: "https://drive.google.com/file/normas",
  link_edital_congresso: "https://drive.google.com/file/edital",
  link_manual_revisor: "https://drive.google.com/file/manual",
  link_diretrizes_avaliacao: "https://drive.google.com/file/diretrizes",
  link_codigo_etica: "https://drive.google.com/file/etica",
};

describe("carregarLinksDownloads", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("devolve o que o servidor respondeu", async () => {
    mocks.rpc.mockResolvedValue({ data: [RESPOSTA_COMPLETA], error: null });
    expect(await carregarLinksDownloads()).toEqual(RESPOSTA_COMPLETA);
  });

  it.each([
    ["erro do banco", { data: null, error: { message: "boom" } }],
    ["RPC ausente (migration não aplicada)", { data: null, error: { code: "PGRST202" } }],
    ["resposta vazia", { data: [], error: null }],
    ["sem data", { data: null, error: null }],
  ])("falha (%s) devolve tudo vazio, nunca um link inventado", async (_caso, resposta) => {
    mocks.rpc.mockResolvedValue(resposta);
    expect(await carregarLinksDownloads()).toEqual(LINKS_VAZIOS);
  });

  // Uma coluna que ainda não existe no banco não pode virar `undefined`
  // no href — o botão precisa cair no ramo desabilitado.
  it("completa com string vazia as chaves ausentes na resposta", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ link_template_word: "https://drive.google.com/file/word" }],
      error: null,
    });
    const links = await carregarLinksDownloads();
    expect(links.link_template_word).toBe("https://drive.google.com/file/word");
    expect(links.link_codigo_etica).toBe("");
    expect(Object.keys(links).sort()).toEqual(Object.keys(LINKS_VAZIOS).sort());
  });
});
