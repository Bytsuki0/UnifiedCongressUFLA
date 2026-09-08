import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Avisos de login o lado cliente (migration 20260908120000).
 *
 * Três grupos, e cada um guarda uma invariante que já custou caro em
 * outra feature deste projeto:
 *
 *   1. A MARCAÇÃO. O corpo do aviso é texto, e vira uma árvore de blocos
 *      nunca HTML. É a única entrada do sistema em que o texto de uma
 *      pessoa aparece no navegador de todas as outras sem que ninguém
 *      tenha clicado em nada, e os testes daqui existem para que a
 *      conversão continue sendo DADOS.
 *
 *   2. A BARRA de ferramentas. O caso que sempre quebra é clicar no
 *      botão com a seleção já marcada: se ele só souber ligar, dois
 *      cliques produzem `****negrito****`, que a marcação lê como
 *      asteriscos literais.
 *
 *   3. As POLÍTICAS DE ERRO do serviço, que são opostas de propósito
 *      a leitura do diálogo falha VAZIA (um aviso não pode segurar a
 *      entrada de ninguém), a da tela de gestão PROPAGA (quem publica
 *      não pode achar que não há nada no ar por causa de uma falha de
 *      rede). Mesma dupla de `carregarArquivosDownload` /
 *      `listarArquivosDownload`.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), storage: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from, storage: { from: mocks.storage } },
}));

import {
  alternarLista,
  blocosDoTexto,
  envolverSelecao,
  temConteudo,
  trechosDaLinha,
  PAPEIS_AVISO,
  ROTULO_PAPEL,
} from "@/lib/avisos";
import { carregarMeusAvisos, listarAvisos, descartarBanner } from "@/services/avisosService";

/* ------------------------------------------------------------------
 * 1. A marcação
 * ----------------------------------------------------------------- */
describe("marcação do aviso", () => {
  it("marca negrito e itálico, e deixa o resto como texto", () => {
    expect(trechosDaLinha("Prazo **prorrogado** até *sexta*")).toEqual([
      { texto: "Prazo ", negrito: false, italico: false },
      { texto: "prorrogado", negrito: true, italico: false },
      { texto: " até ", negrito: false, italico: false },
      { texto: "sexta", negrito: false, italico: true },
    ]);
  });

  it("aceita itálico dentro de negrito", () => {
    expect(trechosDaLinha("**muito *urgente* mesmo**")).toEqual([
      { texto: "muito ", negrito: true, italico: false },
      { texto: "urgente", negrito: true, italico: true },
      { texto: " mesmo", negrito: true, italico: false },
    ]);
  });

  it("asterisco sem par é texto, não abre formatação até o fim da linha", () => {
    // Sem esta regra, "5 * 3" italizaria toda a metade direita do aviso
    // e quem escreveu não teria como adivinhar o motivo.
    expect(trechosDaLinha("multiplique 5 * 3 = 15")).toEqual([
      { texto: "multiplique 5 * 3 = 15", negrito: false, italico: false },
    ]);
    expect(trechosDaLinha("nota final*")).toEqual([
      { texto: "nota final*", negrito: false, italico: false },
    ]);
  });

  it("linhas seguidas viram UM parágrafo com quebras, não um por linha", () => {
    const blocos = blocosDoTexto("Primeira\nSegunda");
    expect(blocos).toHaveLength(1);
    expect(blocos[0].tipo).toBe("paragrafo");
    if (blocos[0].tipo === "paragrafo") expect(blocos[0].linhas).toHaveLength(2);
  });

  it("linha em branco separa parágrafos", () => {
    const blocos = blocosDoTexto("Um\n\nDois");
    expect(blocos.map((b) => b.tipo)).toEqual(["paragrafo", "paragrafo"]);
  });

  it("itens consecutivos formam uma lista só, e o marcador some do texto", () => {
    const blocos = blocosDoTexto("Faça:\n- Enviar o PDF\n- Conferir coautores\nObrigado.");
    expect(blocos.map((b) => b.tipo)).toEqual(["paragrafo", "lista", "paragrafo"]);

    const lista = blocos[1];
    if (lista.tipo !== "lista") throw new Error("bloco do meio deveria ser lista");
    expect(lista.itens).toHaveLength(2);
    expect(lista.itens[0][0].texto).toBe("Enviar o PDF");
  });

  it("um travessão solto não abre lista", () => {
    // "-" sozinho é pontuação que alguém digitou, não um item vazio.
    const blocos = blocosDoTexto("-");
    expect(blocos[0].tipo).toBe("paragrafo");
  });

  it("texto vazio ou só espaços não produz bloco nenhum", () => {
    expect(blocosDoTexto("")).toEqual([]);
    expect(blocosDoTexto("   \n\n  ")).toEqual([]);
    expect(temConteudo("   ")).toBe(false);
    expect(temConteudo("oi")).toBe(true);
  });

  it("todo papel tem rótulo a tela não pode mostrar o valor cru do banco", () => {
    for (const papel of PAPEIS_AVISO) {
      expect(ROTULO_PAPEL[papel]).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------
 * 2. A barra de ferramentas
 * ----------------------------------------------------------------- */
describe("barra de ferramentas", () => {
  it("envolve a seleção e mantém o mesmo texto selecionado", () => {
    const r = envolverSelecao("Prazo prorrogado", 6, 16, "**");
    expect(r.texto).toBe("Prazo **prorrogado**");
    expect(r.texto.slice(r.inicio, r.fim)).toBe("prorrogado");
  });

  it("clicar de novo DESMARCA, em vez de empilhar asteriscos", () => {
    // Sem isto o segundo clique produz ****texto****, que a marcação lê
    // como asteriscos literais.
    const marcado = envolverSelecao("Prazo prorrogado", 6, 16, "**");
    const desmarcado = envolverSelecao(marcado.texto, marcado.inicio, marcado.fim, "**");
    expect(desmarcado.texto).toBe("Prazo prorrogado");
  });

  it("desmarca também quando os marcadores ficam FORA da seleção", () => {
    const r = envolverSelecao("Prazo **prorrogado**", 8, 18, "**");
    expect(r.texto).toBe("Prazo prorrogado");
    expect(r.texto.slice(r.inicio, r.fim)).toBe("prorrogado");
  });

  it("sem seleção, insere o par e deixa o cursor no meio", () => {
    const r = envolverSelecao("Prazo ", 6, 6, "**");
    expect(r.texto).toBe("Prazo ****");
    expect(r.inicio).toBe(8);
    expect(r.fim).toBe(8);
  });

  it("a lista opera em linhas inteiras, mesmo com meia linha selecionada", () => {
    const texto = "Enviar o PDF\nConferir coautores";
    const r = alternarLista(texto, 3, 17); // pega o meio das duas linhas
    expect(r.texto).toBe("- Enviar o PDF\n- Conferir coautores");
  });

  it("a lista desmarca quando todas as linhas alcançadas já são itens", () => {
    const texto = "- Enviar o PDF\n- Conferir coautores";
    const r = alternarLista(texto, 0, texto.length);
    expect(r.texto).toBe("Enviar o PDF\nConferir coautores");
  });

  it("linha em branco no meio da seleção não vira item vazio", () => {
    const r = alternarLista("Um\n\nDois", 0, 8);
    expect(r.texto).toBe("- Um\n\n- Dois");
  });
});

/* ------------------------------------------------------------------
 * 3. As políticas de erro do serviço
 * ----------------------------------------------------------------- */
describe("avisosService", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.storage.mockReset();
  });

  const AVISOS = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      tipo: "texto",
      titulo: "Prazo prorrogado",
      corpo: "Até **20 de outubro**.",
      imagem: "",
    },
  ];

  it("carregarMeusAvisos devolve o que a RPC deu", async () => {
    mocks.rpc.mockResolvedValue({ data: AVISOS, error: null });
    await expect(carregarMeusAvisos()).resolves.toEqual(AVISOS);
    expect(mocks.rpc).toHaveBeenCalledWith("meus_avisos");
  });

  it("carregarMeusAvisos falha VAZIA um aviso não segura a entrada de ninguém", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(carregarMeusAvisos()).resolves.toEqual([]);
  });

  it("carregarMeusAvisos NÃO filtra por papel: o recorte é do servidor", async () => {
    // Se a RPC devolveu, é porque `papeis_efetivos()` já casou. Um filtro
    // aqui criaria a ilusão de que o cliente participa do endereçamento
    // e no dia em que a RPC alargasse, ninguém olharia para cá.
    mocks.rpc.mockResolvedValue({ data: AVISOS, error: null });
    const recebidos = await carregarMeusAvisos();
    expect(recebidos).toHaveLength(AVISOS.length);
  });

  it("listarAvisos PROPAGA o erro quem publica não pode ver lista vazia por falha de rede", async () => {
    const ordem2 = vi.fn().mockResolvedValue({ data: null, error: { message: "sem rede" } });
    const ordem1 = vi.fn().mockReturnValue({ order: ordem2 });
    mocks.from.mockReturnValue({ select: () => ({ order: ordem1 }) });

    await expect(listarAvisos()).rejects.toThrow("sem rede");
  });

  it("descartarBanner ignora caminho vazio e URL completa", async () => {
    // `remove()` não entende URL: apagar às cegas alcançaria o objeto
    // errado. Mesma guarda de `descartarDoStorage`.
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.storage.mockReturnValue({ remove });

    await descartarBanner("");
    await descartarBanner("https://exemplo.test/imagem.png");
    expect(remove).not.toHaveBeenCalled();

    await descartarBanner("abc/123-cartaz.png");
    expect(remove).toHaveBeenCalledWith(["abc/123-cartaz.png"]);
  });
});
