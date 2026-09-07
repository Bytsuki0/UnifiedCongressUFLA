import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Anais e Pitches — o lado cliente (migration 20260907120000).
 *
 * Duas invariantes, e as duas já custaram caro em outras features deste
 * projeto:
 *
 *   1. As leituras PÚBLICAS falham VAZIAS. Não há autoridade nenhuma do
 *      outro lado de um `href` nem de um `<iframe>`: mandar o visitante
 *      para um endereço que ninguém cadastrou só produz uma aba de erro.
 *      (É o inverso do prazo de submissão, que falha ABERTO porque lá
 *      quem recusa de verdade é o banco.)
 *
 *   2. As leituras da TELA DE EDIÇÃO propagam o erro. Quem publica não
 *      pode receber lista vazia por falha de rede e concluir que não há
 *      nada publicado — acrescentaria em cima de um estado que não é o
 *      do banco.
 *
 * O terceiro grupo guarda o que o CLIENTE não pode fazer: filtrar os
 * pitches. O recorte "só trabalho aprovado" é da RPC, e um filtro daqui
 * criaria a ilusão de que o cliente participa dele — no dia em que a RPC
 * alargasse, o vazamento já estaria no ar e ninguém olharia para cá.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

import { carregarAnaisPublicos, listarAnais } from "@/services/anaisService";
import { carregarPitchesPublicos, listarPitchesHistoricos } from "@/services/pitchesService";

const ANAIS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    titulo: "Anais do XII Congresso Unificado ICTIN",
    descricao: "Revista de Ciência e Tecnologia da UFLA, v. 12, n. 3, dezembro de 2025.",
    url: "https://repositorio.ufla.br/anais-2025",
  },
];

const PITCHES = [
  {
    id: "22222222-2222-2222-2222-222222222222",
    origem: "trabalho",
    titulo: "Sensores de baixo custo para qualidade da água",
    descricao: "",
    autores: "Ana Souza; Bruno Lima",
    categoria: "BIC Jr.",
    edicao: "",
    video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    origem: "historico",
    titulo: "Robótica educacional no ensino médio",
    descricao: "Equipe do IFMG",
    autores: "",
    categoria: "",
    edicao: "2024",
    video_url: "https://youtu.be/dQw4w9WgXcQ",
  },
];

/** `.from(t).select(c).order(a).order(b)` → uma promessa com `resposta`. */
const cadeiaDeLeitura = (resposta: { data: unknown; error: unknown }) => {
  const thenable = {
    order: () => thenable,
    then: (aceita: (v: unknown) => unknown) => Promise.resolve(resposta).then(aceita),
  };
  return { select: () => thenable };
};

describe("leituras públicas: falham VAZIAS", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("os anais vêm da RPC pública, na ordem em que o servidor mandou", async () => {
    mocks.rpc.mockResolvedValue({ data: ANAIS, error: null });
    expect(await carregarAnaisPublicos()).toEqual(ANAIS);
    expect(mocks.rpc).toHaveBeenCalledWith("anais_publicos");
  });

  it("os pitches vêm da RPC pública, com as duas origens na mesma lista", async () => {
    mocks.rpc.mockResolvedValue({ data: PITCHES, error: null });
    const lista = await carregarPitchesPublicos();
    expect(lista).toEqual(PITCHES);
    expect(mocks.rpc).toHaveBeenCalledWith("pitches_publicos");
    // A ORDEM é contrato da RPC — a tela pagina em cima dela.
    expect(lista.map((p) => p.origem)).toEqual(["trabalho", "historico"]);
  });

  it.each([
    ["erro do banco", { data: null, error: { message: "boom" } }],
    ["falha de rede", { data: null, error: { message: "Failed to fetch" } }],
    ["resposta sem dados", { data: null, error: null }],
  ])("anais: %s vira lista vazia, nunca uma exceção na landing", async (_caso, resposta) => {
    mocks.rpc.mockResolvedValue(resposta);
    await expect(carregarAnaisPublicos()).resolves.toEqual([]);
  });

  it.each([
    ["erro do banco", { data: null, error: { message: "boom" } }],
    ["falha de rede", { data: null, error: { message: "Failed to fetch" } }],
    ["resposta sem dados", { data: null, error: null }],
  ])("pitches: %s vira lista vazia, nunca uma exceção na landing", async (_caso, resposta) => {
    mocks.rpc.mockResolvedValue(resposta);
    await expect(carregarPitchesPublicos()).resolves.toEqual([]);
  });
});

describe("leituras da tela de edição: PROPAGAM o erro", () => {
  beforeEach(() => mocks.from.mockReset());

  it("listarAnais devolve as linhas da tabela", async () => {
    mocks.from.mockReturnValue(cadeiaDeLeitura({ data: ANAIS, error: null }));
    expect(await listarAnais()).toEqual(ANAIS);
    expect(mocks.from).toHaveBeenCalledWith("anais");
  });

  it("listarAnais joga quando o banco recusa — não devolve lista vazia", async () => {
    mocks.from.mockReturnValue(cadeiaDeLeitura({ data: null, error: { message: "sem permissão" } }));
    await expect(listarAnais()).rejects.toThrow("sem permissão");
  });

  it("listarPitchesHistoricos joga quando o banco recusa", async () => {
    mocks.from.mockReturnValue(cadeiaDeLeitura({ data: null, error: { message: "boom" } }));
    await expect(listarPitchesHistoricos()).rejects.toThrow("boom");
  });

  it("listarPitchesHistoricos lê só a tabela do ACERVO", async () => {
    mocks.from.mockReturnValue(cadeiaDeLeitura({ data: [], error: null }));
    await listarPitchesHistoricos();
    // Os pitches desta edição são DERIVADOS de trabalho_anexos e não têm
    // linha em tabela nenhuma. Se um dia esta asserção falhar apontando
    // para uma tabela nova de "pitches do congresso", a segunda fonte da
    // mesma verdade acabou de nascer.
    expect(mocks.from).toHaveBeenCalledWith("pitches_historico");
  });
});

describe("o recorte dos pitches é do SERVIDOR", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("o cliente devolve o que a RPC mandou, sem filtrar nada", async () => {
    // Se o cliente filtrasse por origem ou por status, esta lista
    // voltaria menor — e a ilusão de que há um segundo gate aqui é
    // exatamente o que não pode existir. Quem recorta é
    // `pitches_publicos()`, e a própria migration quebra se o recorte
    // alargar.
    mocks.rpc.mockResolvedValue({ data: PITCHES, error: null });
    expect(await carregarPitchesPublicos()).toHaveLength(PITCHES.length);
  });

  it("não existe chamada a `trabalhos` no caminho público dos pitches", async () => {
    mocks.from.mockReset();
    mocks.rpc.mockResolvedValue({ data: PITCHES, error: null });
    await carregarPitchesPublicos();
    // A tabela `trabalhos` é fechada por RLS para o visitante: qualquer
    // leitura direta aqui voltaria vazia em produção e passaria nos
    // testes com mock.
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
