import { describe, expect, it } from "vitest";
import {
  anexosOrfaos,
  ordenarAnexos,
  rascunhoInicial,
  resumoDoPasso,
  validarAnexos,
  valorAtual,
  MAX_PDF_BYTES,
  type AnexoDaCategoria,
  type AnexoDoTrabalho,
} from "@/lib/anexos";

/**
 * Anexos por categoria — o lado puro.
 *
 * A regra que dá nome ao arquivo: **a quantidade e o tipo de anexo vêm da
 * CATEGORIA**, não do formulário. Até 20260904 `trabalhos` tinha um
 * `pdf_url` e um `video_url`, e as quatro telas do autor pediam
 * exatamente isso de todo mundo. Agora BIC Jr. pede um PDF e um vídeo,
 * Extensão pede dois PDFs e nenhum vídeo, e uma categoria pode não pedir
 * nada.
 *
 * ⚠ Nada aqui é barreira. Quem recusa de verdade é `aplicar_anexos`, no
 * servidor — estes testes travam a CORTESIA (a frase que a pessoa lê
 * antes de mandar um formulário que o banco rejeitaria) e, principalmente,
 * as duas regras que não são óbvias:
 *
 *   · PDF sem arquivo novo em tela de EDIÇÃO significa "mantém o que está
 *     gravado", nunca "faltou anexar". Foi assim que `_pdf_url` ausente
 *     sempre funcionou, e continuar assim é o que impede a edição de um
 *     título de exigir o reenvio de todos os arquivos.
 *   · Entrega que não corresponde a exigência nenhuma é ÓRFÃ, e a tela
 *     precisa avisar antes de descartá-la — senão o arquivo some sem
 *     explicação quando a organização remove uma exigência.
 */

const pdf = (id: string, ordem: number, titulo = `PDF ${id}`): AnexoDaCategoria => ({
  id,
  categoria_id: "c1",
  tipo: "pdf",
  titulo,
  descricao: "",
  ordem,
});

const video = (id: string, ordem: number, titulo = `Vídeo ${id}`): AnexoDaCategoria => ({
  id,
  categoria_id: "c1",
  tipo: "video",
  titulo,
  descricao: "",
  ordem,
});

const entregue = (
  anexoId: string | null,
  tipo: "pdf" | "video",
  valor: string,
  ordem = 1,
): AnexoDoTrabalho => ({
  id: `e-${anexoId ?? "orfao"}-${ordem}`,
  anexo_id: anexoId,
  tipo,
  titulo: `Entrega ${ordem}`,
  ordem,
  valor,
});

const arquivoPdf = (bytes = 10) =>
  new File([new Uint8Array(bytes)], "trabalho.pdf", { type: "application/pdf" });

const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ";

describe("ordenarAnexos", () => {
  it("ordena pela ordem da organização, com o título desempatando", () => {
    const lista = [pdf("b", 2, "Beta"), pdf("c", 1, "Zulu"), pdf("a", 1, "Alfa")];
    expect(ordenarAnexos(lista).map((a) => a.titulo)).toEqual(["Alfa", "Zulu", "Beta"]);
  });

  it("não altera a lista recebida", () => {
    const lista = [pdf("b", 2), pdf("a", 1)];
    ordenarAnexos(lista);
    expect(lista.map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("validarAnexos — submissão nova", () => {
  it("passa quando todas as exigências foram preenchidas", () => {
    expect(
      validarAnexos({
        exigencias: [pdf("a1", 1), video("a2", 2)],
        rascunho: { a1: { arquivo: arquivoPdf() }, a2: { url: YOUTUBE } },
      }),
    ).toBeNull();
  });

  it("categoria sem exigência nenhuma é estado legítimo", () => {
    expect(validarAnexos({ exigencias: [], rascunho: {} })).toBeNull();
  });

  it("cobra o PDF que falta, pelo nome que a organização deu", () => {
    expect(
      validarAnexos({
        exigencias: [pdf("a1", 1, "Relatório de extensão"), pdf("a2", 2, "Plano de trabalho")],
        rascunho: { a1: { arquivo: arquivoPdf() } },
      }),
    ).toBe('Anexe o PDF de "Plano de trabalho".');
  });

  it("cobra o link de vídeo que falta", () => {
    expect(
      validarAnexos({
        exigencias: [video("a1", 1, "Vídeo de apresentação")],
        rascunho: { a1: { url: "   " } },
      }),
    ).toBe('Informe o link de vídeo de "Vídeo de apresentação".');
  });

  it("recusa link que não é do YouTube", () => {
    expect(
      validarAnexos({
        exigencias: [video("a1", 1, "Vídeo do projeto")],
        rascunho: { a1: { url: "https://vimeo.com/123456789" } },
      }),
    ).toBe('O link de "Vídeo do projeto" precisa ser um vídeo do YouTube.');
  });

  it("recusa arquivo que não é PDF e arquivo acima de 10MB", () => {
    expect(
      validarAnexos({
        exigencias: [pdf("a1", 1, "Trabalho")],
        rascunho: { a1: { arquivo: new File(["x"], "a.docx", { type: "application/msword" }) } },
      }),
    ).toBe('"Trabalho": o arquivo precisa estar em formato PDF.');

    expect(
      validarAnexos({
        exigencias: [pdf("a1", 1, "Trabalho")],
        rascunho: { a1: { arquivo: arquivoPdf(MAX_PDF_BYTES + 1) } },
      }),
    ).toBe('"Trabalho": o PDF excede o limite de 10MB.');
  });

  /**
   * A ordem da mensagem segue a ordem da organização, não a ordem em que
   * as chaves caíram no objeto: quem lê o erro procura o campo de cima
   * para baixo.
   */
  it("reclama da primeira exigência em falta, na ordem da tela", () => {
    expect(
      validarAnexos({
        exigencias: [pdf("a2", 2, "Segundo"), pdf("a1", 1, "Primeiro")],
        rascunho: {},
      }),
    ).toBe('Anexe o PDF de "Primeiro".');
  });
});

describe("validarAnexos — edição de um trabalho existente", () => {
  const exigencias = [pdf("a1", 1, "Trabalho"), video("a2", 2, "Vídeo")];
  const atuais = [entregue("a1", "pdf", "u1/antigo.pdf", 1), entregue("a2", "video", YOUTUBE, 2)];

  it("PDF sem arquivo novo MANTÉM o que está gravado", () => {
    // Esta é a regra que impede que corrigir um título obrigue o autor a
    // reenviar todos os arquivos.
    expect(validarAnexos({ exigencias, rascunho: { a2: { url: YOUTUBE } }, atuais })).toBeNull();
  });

  it("mas cobra o PDF quando não há nada gravado para aquela exigência", () => {
    // O caso de uma exigência ACRESCENTADA pela organização depois da
    // submissão: o campo aparece vazio e passa a ser obrigatório.
    const comNova = [...exigencias, pdf("a3", 3, "Anexo novo")];
    expect(
      validarAnexos({ exigencias: comNova, rascunho: { a2: { url: YOUTUBE } }, atuais }),
    ).toBe('Anexe o PDF de "Anexo novo".');
  });

  it("link de vídeo apagado na tela é erro, mesmo havendo um gravado", () => {
    expect(validarAnexos({ exigencias, rascunho: { a2: { url: "" } }, atuais })).toBe(
      'Informe o link de vídeo de "Vídeo".',
    );
  });
});

describe("rascunhoInicial", () => {
  it("preenche só os vídeos; PDF vazio significa manter", () => {
    const inicial = rascunhoInicial(
      [pdf("a1", 1), video("a2", 2)],
      [entregue("a1", "pdf", "u1/x.pdf"), entregue("a2", "video", YOUTUBE, 2)],
    );
    expect(inicial).toEqual({ a2: { url: YOUTUBE } });
  });

  it("vídeo sem entrega correspondente nasce vazio", () => {
    expect(rascunhoInicial([video("a2", 2)], [])).toEqual({ a2: { url: "" } });
  });
});

describe("valorAtual e anexosOrfaos", () => {
  it("acha o que está gravado para uma exigência", () => {
    const atuais = [entregue("a1", "pdf", "u1/x.pdf")];
    expect(valorAtual(atuais, "a1")).toBe("u1/x.pdf");
    expect(valorAtual(atuais, "a2")).toBeNull();
    expect(valorAtual(undefined, "a1")).toBeNull();
  });

  it("entrega cuja exigência foi apagada é órfã", () => {
    // `anexo_id: null` é o que a FK ON DELETE SET NULL deixa para trás
    // quando a organização apaga a exigência (ou a categoria inteira).
    const atuais = [
      entregue("a1", "pdf", "u1/vale.pdf", 1),
      entregue(null, "video", YOUTUBE, 2),
      entregue("removida", "pdf", "u1/saiu.pdf", 3),
    ];
    const orfaos = anexosOrfaos(atuais, [pdf("a1", 1)]);
    expect(orfaos.map((o) => o.valor)).toEqual([YOUTUBE, "u1/saiu.pdf"]);
  });

  it("sem entregas, não há órfãos", () => {
    expect(anexosOrfaos(undefined, [pdf("a1", 1)])).toEqual([]);
  });
});

describe("resumoDoPasso", () => {
  it("conta PDFs e vídeos, no singular e no plural", () => {
    expect(resumoDoPasso([pdf("a1", 1), video("a2", 2)])).toContain(
      "1 arquivo PDF e 1 link de vídeo",
    );
    expect(resumoDoPasso([pdf("a1", 1), pdf("a2", 2)])).toContain("2 arquivos PDF");
    // Extensão: dois PDFs e nenhum vídeo — o caso que motivou a feature.
    expect(resumoDoPasso([pdf("a1", 1), pdf("a2", 2)])).not.toContain("vídeo");
  });

  it("diz que não exige nada quando a lista é vazia", () => {
    expect(resumoDoPasso([])).toBe("Esta categoria não exige anexo.");
  });
});
