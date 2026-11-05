import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Avaliação ao vivo — o lado cliente (migration 20261103120000).
 *
 * Quem pode avaliar o quê é da RPC (provada no PGlite com 10 bugs
 * plantados). Aqui ficam a busca, o ranking e a única regra do cliente que
 * falha em silêncio: o "Minhas avaliações" tem de filtrar pelo avaliador,
 * porque a RLS deixa a organização ler TODAS — sem o filtro, um admin veria
 * as notas de todo mundo como se fossem dele, e nenhum teste de tela notaria.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

import { filtrarTrabalhos, rankingPorCategoria } from "@/lib/avaliacaoEvento";
import {
  avaliarTrabalhoEvento,
  carregarAvaliacaoEvento,
  carregarPeriodoAvaliacao,
  listarPdfsParaAvaliacao,
} from "@/services/avaliacaoEventoService";

const T = (id: string, titulo: string, autores: string, categoria_id: string | null) => ({
  id, titulo, autores, categoria_id, em_conflito: false,
});

const LISTA = [
  T("1", "Robótica educacional", "João Silva, Ana Souza", "bic"),
  T("2", "Água e solo", "Márcia Lima", "ext"),
  T("3", "Redes neurais", "Pedro Alves", "bic"),
];

describe("filtrarTrabalhos", () => {
  it("sem filtro devolve tudo", () => {
    expect(filtrarTrabalhos(LISTA, { categoriaId: "", termo: "  " })).toHaveLength(3);
  });

  it("recorta pela categoria", () => {
    expect(filtrarTrabalhos(LISTA, { categoriaId: "bic", termo: "" }).map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("acha pelo autor sem acento e sem caixa", () => {
    // "joao" tem de achar "João": a busca ao vivo é digitada às pressas.
    expect(filtrarTrabalhos(LISTA, { categoriaId: "", termo: "JOAO" }).map((t) => t.id)).toEqual(["1"]);
    expect(filtrarTrabalhos(LISTA, { categoriaId: "", termo: "marcia" }).map((t) => t.id)).toEqual(["2"]);
  });

  it("acha pelo título e combina com a categoria", () => {
    expect(filtrarTrabalhos(LISTA, { categoriaId: "", termo: "agua" }).map((t) => t.id)).toEqual(["2"]);
    expect(filtrarTrabalhos(LISTA, { categoriaId: "bic", termo: "agua" })).toEqual([]);
  });
});

describe("rankingPorCategoria", () => {
  it("média das médias, por categoria, só de quem recebeu nota", () => {
    const r = rankingPorCategoria(
      [
        { trabalho_id: "1", media: 4 },
        { trabalho_id: "1", media: 5 },
        { trabalho_id: "3", media: 3 },
      ],
      LISTA,
    );
    expect(Object.keys(r)).toEqual(["bic"]);
    expect(r.bic.map((l) => [l.trabalho.id, l.media, l.total])).toEqual([
      ["1", 4.5, 2],
      ["3", 3, 1],
    ]);
  });

  it("empate: mais avaliações na frente, depois o título", () => {
    const r = rankingPorCategoria(
      [
        { trabalho_id: "3", media: 4 },
        { trabalho_id: "1", media: 4 },
        { trabalho_id: "1", media: 4 },
      ],
      LISTA,
    );
    expect(r.bic.map((l) => l.trabalho.id)).toEqual(["1", "3"]);

    const r2 = rankingPorCategoria(
      [
        { trabalho_id: "3", media: 4 },
        { trabalho_id: "4", media: 4 },
      ],
      [...LISTA, T("4", "Abelhas", "Rui", "bic")],
    );
    expect(r2.bic.map((l) => l.trabalho.id)).toEqual(["4", "3"]);
  });

  it("trabalho sem categoria vai para a chave vazia", () => {
    const r = rankingPorCategoria([{ trabalho_id: "9", media: 2 }], [T("9", "Órfão", "X", null)]);
    expect(r[""]).toHaveLength(1);
  });
});

describe("avaliacaoEventoService", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
  });

  it("'Minhas avaliações' filtra pelo avaliador no request", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{ trabalho_id: "1", itens: [], media: 4, updated_at: "2026-11-03" }],
      error: null,
    });
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    mocks.rpc.mockResolvedValue({ data: LISTA, error: null });

    const r = await carregarAvaliacaoEvento("uid-1");

    expect(mocks.from).toHaveBeenCalledWith("avaliacoes_evento");
    expect(eq).toHaveBeenCalledWith("avaliador_id", "uid-1");
    expect(mocks.rpc).toHaveBeenCalledWith("trabalhos_para_avaliacao");
    expect(Object.keys(r.minhas)).toEqual(["1"]);
  });

  it("manda só trabalho e notas por critério, e devolve a frase do banco", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "Atribua uma nota de 1 a 5 a todos os critérios." } });
    await expect(avaliarTrabalhoEvento("t1", { c1: 4 })).rejects.toThrow("Atribua uma nota de 1 a 5");
    expect(mocks.rpc).toHaveBeenCalledWith("avaliar_trabalho_evento", { _trabalho_id: "t1", _notas: { c1: 4 } });
  });

  // Migration 20261105120000. Quem fecha o portal é a fresta; aqui só a
  // política de erro: "não sei" (null) não pode virar "fechado" (false).
  it("período: devolve o do servidor; falha vira aberto null, nunca false", async () => {
    const janela = { abertura: "2026-11-20", encerramento: "2026-11-22", aberto: false, hoje: "2026-11-05" };
    mocks.rpc.mockResolvedValue({ data: [janela], error: null });
    expect(await carregarPeriodoAvaliacao()).toEqual(janela);
    expect(mocks.rpc).toHaveBeenCalledWith("periodo_avaliacao");

    mocks.rpc.mockResolvedValue({ data: null, error: { message: "rede" } });
    expect((await carregarPeriodoAvaliacao()).aberto).toBeNull();
  });

  it("PDF: pede à RPC da fresta, nunca à tabela", async () => {
    const pdf = { id: "a1", anexo_id: "e1", tipo: "pdf", titulo: "Resumo", ordem: 1, valor: "u/x.pdf", poster: false };
    mocks.rpc.mockResolvedValue({ data: [pdf], error: null });
    expect(await listarPdfsParaAvaliacao("t1")).toEqual([pdf]);
    expect(mocks.rpc).toHaveBeenCalledWith("anexos_para_avaliacao", { _trabalho_id: "t1" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
