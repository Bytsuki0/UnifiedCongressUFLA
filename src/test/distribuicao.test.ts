import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Distribuição de revisores — o lado cliente.
 *
 * A invariante que dá nome ao arquivo: **nada é associado sem o aval de um
 * co-chair**. Até 20260820 o sistema fazia duas coisas sozinho — distribuía
 * no instante da submissão e gravava direto no botão da tela de
 * Atribuições. A primeira sumiu; a segunda virou proposta + confirmação.
 *
 * O primeiro teste é o guarda-costas dessa mudança: reintroduzir a chamada
 * a `distribuir_revisores` em `submeterTrabalho` reabriria a distribuição
 * automática sem que ninguém percebesse na tela, porque a chamada antiga
 * era best-effort e engolia o próprio erro.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({
      insert: () => ({
        select: () => ({ single: mocks.insert }),
      }),
    }),
    storage: { from: () => ({ upload: mocks.upload }) },
  },
}));

import { submeterTrabalho } from "@/services/trabalhosService";
import {
  confirmarDistribuicao,
  opcoesParaSlot,
  recomendarDistribuicao,
  type MotivoConflito,
  type RevisorOption,
} from "@/services/revisorService";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.insert.mockReset();
  mocks.upload.mockReset();
});

describe("submeterTrabalho", () => {
  it("NÃO distribui revisores — o trabalho nasce sem nenhum", async () => {
    mocks.upload.mockResolvedValue({ error: null });
    mocks.insert.mockResolvedValue({ data: { id: "t1" }, error: null });

    const id = await submeterTrabalho({
      ownerId: "u1",
      titulo: "Um trabalho",
      palavrasChave: ["a"],
      videoUrl: "https://youtu.be/x",
      tipoResumo: "simples",
      categoriaId: "c1",
      autores: "Alguém",
      orientadorEmail: "orientador@ufla.br",
      coautores: [],
      arquivo: new File(["conteudo"], "trabalho.pdf", { type: "application/pdf" }),
    });

    expect(id).toBe("t1");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("recomendarDistribuicao", () => {
  it("devolve a proposta do servidor sem gravar nada", async () => {
    const proposta = [
      { trabalho_id: "t1", revisor_email: "ana@ufla.br", revisor_nome: "Ana", tipo: "professor" },
    ];
    mocks.rpc.mockResolvedValue({ data: proposta, error: null });

    expect(await recomendarDistribuicao()).toEqual(proposta);
    expect(mocks.rpc).toHaveBeenCalledWith("recomendar_distribuicao");
  });
});

describe("confirmarDistribuicao", () => {
  it("manda os pares em `_pares` e devolve quantos foram criados", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const pares = [
      { trabalho_id: "t1", revisor_email: "ana@ufla.br" },
      { trabalho_id: "t1", revisor_email: "bruno@ufla.br" },
    ];

    expect(await confirmarDistribuicao(pares)).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("confirmar_distribuicao", { _pares: pares });
  });

  it("não bate no servidor com lista vazia", async () => {
    expect(await confirmarDistribuicao([])).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  // A frase do banco diz QUEM foi recusado e por quê; trocá-la por um
  // "Erro ao confirmar" genérico deixaria o co-chair sem saber que linha
  // consertar num lote que foi recusado inteiro.
  it("propaga a mensagem do banco", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Conflito de interesse: ana@ufla.br consta como orientador deste trabalho." },
    });

    await expect(
      confirmarDistribuicao([{ trabalho_id: "t1", revisor_email: "ana@ufla.br" }]),
    ).rejects.toThrow(/consta como orientador/);
  });
});

/**
 * `opcoesParaSlot` é pura — sem mock nenhum. Ela é a cortesia da tela: o
 * banco continua sendo quem recusa, mas montar um lote fadado a ser
 * rejeitado inteiro custaria uma rodada de frustração ao co-chair.
 */
describe("opcoesParaSlot", () => {
  const pool: RevisorOption[] = [
    { email: "ana@ufla.br", nome: "Ana", tipo: "professor" },
    { email: "bruno@ufla.br", nome: "Bruno", tipo: "avaliador" },
    { email: "carla@ufla.br", nome: "Carla", tipo: "professor" },
  ];
  const semConflito = new Map<string, Map<string, MotivoConflito>>();

  const chamar = (over: Partial<Parameters<typeof opcoesParaSlot>[0]> = {}) =>
    opcoesParaSlot({
      pool,
      conflitos: semConflito,
      cargaBase: new Map(),
      escolhas: new Map([["t1", [null, null, null]]]),
      jaAssociados: [],
      trabalhoId: "t1",
      slotAtual: 0,
      ...over,
    });

  const por = (lista: ReturnType<typeof opcoesParaSlot>, email: string) =>
    lista.find((o) => o.opcao.email === email)!;

  it("libera todo o pool quando não há impedimento", () => {
    expect(chamar().every((o) => !o.desabilitado)).toBe(true);
  });

  it("desabilita quem está em conflito de interesse", () => {
    const conflitos = new Map([["t1", new Map<string, MotivoConflito>([["ana@ufla.br", "orientador"]])]]);
    const r = chamar({ conflitos });
    expect(por(r, "ana@ufla.br").desabilitado).toBe(true);
    expect(por(r, "ana@ufla.br").motivo).toContain("orientador");
    expect(por(r, "bruno@ufla.br").desabilitado).toBe(false);
  });

  it("desabilita quem já revisa este trabalho, comparando sem caixa", () => {
    const r = chamar({ jaAssociados: ["ANA@ufla.br"] });
    expect(por(r, "ana@ufla.br").desabilitado).toBe(true);
    expect(por(r, "ana@ufla.br").motivo).toBe("já revisa este trabalho");
  });

  it("desabilita quem já foi escolhido em outro slot do mesmo trabalho", () => {
    const r = chamar({ escolhas: new Map([["t1", [null, "bruno@ufla.br", null]]]) });
    expect(por(r, "bruno@ufla.br").desabilitado).toBe(true);
    expect(por(r, "bruno@ufla.br").motivo).toBe("já escolhido neste trabalho");
  });

  it("soma as escolhas do diálogo à carga já gravada", () => {
    const r = chamar({
      cargaBase: new Map([["carla@ufla.br", 3]]),
      escolhas: new Map([
        ["t1", [null, null, null]],
        ["t2", ["carla@ufla.br", null, null]],
        ["t3", ["carla@ufla.br", null, null]],
      ]),
    });
    expect(por(r, "carla@ufla.br").carga).toBe(5);
  });

  // A regra que substituiu o teto duro de 5. Carga alta AVISA e não
  // impede: com o pool esgotado, barrar aqui significaria deixar o
  // trabalho com menos de 3 revisores — que é pior, e silencioso.
  it("marca acima da meta sem desabilitar", () => {
    const r = chamar({ cargaBase: new Map([["carla@ufla.br", 9]]) });
    expect(por(r, "carla@ufla.br").acimaDaMeta).toBe(true);
    expect(por(r, "carla@ufla.br").desabilitado).toBe(false);
    expect(por(r, "carla@ufla.br").motivo).toBeUndefined();
    // E quem está abaixo da meta não é marcado.
    expect(por(r, "ana@ufla.br").acimaDaMeta).toBe(false);
  });

  // Sem este desconto, a escolha do próprio slot se marcaria sozinha:
  // ela conta na carga, empurraria o revisor por cima da meta e o Select
  // abriria acusando de "acima da meta" a opção que ele mesmo mostra.
  it("não conta a escolha do próprio slot contra ela mesma", () => {
    const r = chamar({
      cargaBase: new Map([["ana@ufla.br", 3]]),
      escolhas: new Map([["t1", ["ana@ufla.br", null, null]]]),
    });
    expect(por(r, "ana@ufla.br").carga).toBe(3);
    expect(por(r, "ana@ufla.br").acimaDaMeta).toBe(false);
  });
});
