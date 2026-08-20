import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Parecer editorial — o lado cliente.
 *
 * A invariante que dá nome ao arquivo: **nenhum trabalho é aprovado ou
 * reprovado sozinho**. Até 20260820140000 a moda dos 3 pareceres virava
 * `trabalhos.status` no instante em que o terceiro revisor clicava em
 * enviar; agora os pareceres só encerram a revisão, e a decisão é de uma
 * pessoa, com justificativa.
 *
 * Disso saem duas regras de tela que quebram em silêncio se alguém
 * mexer sem pensar, e é por elas que os primeiros testes existem.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), remove: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: vi.fn(),
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  },
}));

import {
  AGUARDANDO_CORRECAO,
  AGUARDANDO_EDITORIAL,
  AGUARDANDO_REENVIO,
  desfechoDo,
  statusLabel,
  STATUS_COM_PARECER,
} from "@/pages/estudante/shared";
import {
  carregarDecisaoEditorial,
  registrarParecerEditorial,
  reenviarTrabalho,
} from "@/services/parecerEditorialService";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.upload.mockReset();
  mocks.remove.mockReset();
});

describe("vocabulário de status", () => {
  /**
   * O vazamento que este teste impede: entre o 3º parecer e a decisão do
   * co-chair existe uma janela em que os três vereditos já existem e a
   * organização ainda pode contrariá-los. Se `aguardando_parecer_editorial`
   * entrar em STATUS_COM_PARECER, a tela oferece "Ver pareceres" nessa
   * janela — e o autor lê "3x aprovado" antes de receber um "reprovado".
   */
  it("não oferece pareceres enquanto a decisão editorial não sai", () => {
    expect(STATUS_COM_PARECER).not.toContain(AGUARDANDO_EDITORIAL);
  });

  // Para o autor, "com os revisores" e "com a organização" são a mesma
  // espera: azul, sem ação. Dizer que os pareceres já chegaram só
  // convidaria a perguntar um resultado que ainda não existe.
  it("trata a espera pela decisão como submissão ativa", () => {
    expect(desfechoDo(AGUARDANDO_EDITORIAL)).toBe("ativa");
    expect(desfechoDo("pendente")).toBe("ativa");
    expect(desfechoDo("em_avaliacao")).toBe("ativa");
  });

  // Quem vai refazer o trabalho é justamente quem mais precisa ler o
  // porquê — e a cor tem de distinguir "ajuste o PDF" de "refaça tudo".
  it("dá cor e pareceres próprios ao reenvio", () => {
    expect(desfechoDo(AGUARDANDO_REENVIO)).toBe("reenvio");
    expect(desfechoDo(AGUARDANDO_CORRECAO)).toBe("correcoes");
    expect(STATUS_COM_PARECER).toContain(AGUARDANDO_REENVIO);
  });

  it("tem rótulo para todo status do vocabulário", () => {
    [
      "pendente",
      "em_avaliacao",
      AGUARDANDO_EDITORIAL,
      "aprovado",
      AGUARDANDO_CORRECAO,
      "reprovado",
      AGUARDANDO_REENVIO,
    ].forEach((s) => expect(statusLabel[s]).toBeTruthy());
  });
});

describe("registrarParecerEditorial", () => {
  it("manda decisão e comentário para a RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: "resubmeter", error: null });

    const r = await registrarParecerEditorial({
      trabalhoId: "t1",
      decisao: "resubmeter",
      comentario: "  Refaça a metodologia.  ",
    });

    expect(r).toBe("resubmeter");
    expect(mocks.rpc).toHaveBeenCalledWith("registrar_parecer_editorial", {
      _trabalho_id: "t1",
      _decisao: "resubmeter",
      _comentario: "Refaça a metodologia.",
    });
  });

  // Decisão sem justificativa é exatamente o que o botão cru do Portal
  // Admin fazia. O banco também recusa; aqui a viagem é poupada.
  it("recusa comentário vazio sem chamar o servidor", async () => {
    await expect(
      registrarParecerEditorial({ trabalhoId: "t1", decisao: "aprovado", comentario: "   " }),
    ).rejects.toThrow(/comentário/i);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("propaga a mensagem do banco", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Este trabalho ainda não recebeu os 3 pareceres (tem 2)." },
    });
    await expect(
      registrarParecerEditorial({ trabalhoId: "t1", decisao: "aprovado", comentario: "ok" }),
    ).rejects.toThrow(/3 pareceres/);
  });
});

describe("carregarDecisaoEditorial", () => {
  it("devolve a decisão vigente, sem quem assinou", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          rodada: 1,
          decisao: "aprovado_correcoes",
          comentario: "Ajuste as referências.",
          created_at: "2026-08-20T12:00:00Z",
        },
      ],
      error: null,
    });

    const d = await carregarDecisaoEditorial("t1");
    expect(d?.decisao).toBe("aprovado_correcoes");
    // O contrato do servidor não devolve identidade; se um dia devolver,
    // este teste não pega — mas a RPC é quem tem de continuar omitindo.
    expect(d).not.toHaveProperty("decidido_nome");
  });

  it("devolve null quando ainda não há decisão", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await carregarDecisaoEditorial("t1")).toBeNull();
  });
});

describe("reenviarTrabalho", () => {
  /**
   * A diferença que define a feature: `enviarCorrecao` NÃO manda autoria
   * nem categoria (a RPC dela nem os aceita, e o trigger os mantém
   * imutáveis). O reenvio manda — é a única escrita do autor que os abre,
   * e é segura porque a distribuição da rodada nova vem depois.
   */
  it("envia autoria e categoria, que a correção não envia", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await reenviarTrabalho({
      trabalhoId: "t1",
      ownerId: "u1",
      titulo: "Título novo",
      palavrasChave: ["a", "b"],
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      tipoResumo: "estendido",
      autores: "Ana, Bruno",
      orientadorEmail: "orientador@ufla.br",
      coautores: [{ nome: "Bruno", email: "bruno@ufla.br" }],
      categoriaId: "c2",
      arquivo: null,
    });

    const [nome, args] = mocks.rpc.mock.calls[0];
    expect(nome).toBe("reenviar_trabalho");
    expect(args._autores).toBe("Ana, Bruno");
    expect(args._categoria_id).toBe("c2");
    expect(args._orientador_email).toBe("orientador@ufla.br");
    expect(args._coautores).toEqual([{ nome: "Bruno", email: "bruno@ufla.br" }]);
    // Sem arquivo novo, o PDF atual é mantido.
    expect(args._pdf_url).toBeNull();
  });

  // Mesma ordem de `enviarCorrecao`: sobe, grava, e só então apaga. Se a
  // gravação falha, a tabela ainda aponta para o PDF velho — um upload
  // órfão é melhor do que um trabalho sem arquivo.
  it("não apaga o PDF antigo quando a gravação falha", async () => {
    mocks.upload.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Acesso negado." } });

    await expect(
      reenviarTrabalho({
        trabalhoId: "t1",
        ownerId: "u1",
        titulo: "T",
        palavrasChave: ["a"],
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        tipoResumo: "simples",
        autores: "Ana",
        orientadorEmail: null,
        coautores: [],
        categoriaId: "c1",
        arquivo: new File(["x"], "novo.pdf", { type: "application/pdf" }),
      }),
    ).rejects.toThrow("Acesso negado.");

    expect(mocks.upload).toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
