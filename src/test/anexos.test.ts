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
  obrigatorio: true,
  ordem,
});

const video = (id: string, ordem: number, titulo = `Vídeo ${id}`): AnexoDaCategoria => ({
  id,
  categoria_id: "c1",
  tipo: "video",
  titulo,
  descricao: "",
  obrigatorio: true,
  ordem,
});

/**
 * A mesma exigência, afrouxada — é o que o co-chair faz ao marcar
 * "Opcional" na linha, em /co-chairs/categorias.
 */
const opcional = (exigencia: AnexoDaCategoria): AnexoDaCategoria => ({
  ...exigencia,
  obrigatorio: false,
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

/**
 * Anexo opcional (20260911): "estar na lista" deixou de significar "ser
 * cobrado". A organização passa a poder OFERECER um campo — um vídeo
 * para quem tiver um, um segundo PDF para quem precisar — sem trancar a
 * submissão de quem não tem. Antes a única forma de não cobrar era não
 * cadastrar a linha, e aí quem TINHA o vídeo não tinha onde pô-lo.
 *
 * ⚠ São duas metades, e a segunda é a que se perde numa refatoração:
 * opcional dispensa o campo VAZIO, e só isso. Preenchido errado continua
 * sendo erro — senão bastaria marcar a linha como opcional para o
 * formulário aceitar link de qualquer domínio. `aplicar_anexos` faz
 * exatamente isto no servidor, e as duas regras têm de concordar.
 */
describe("validarAnexos — anexo opcional", () => {
  it("deixa a submissão passar sem o PDF e sem o vídeo opcionais", () => {
    expect(
      validarAnexos({
        exigencias: [opcional(pdf("a1", 1)), opcional(video("a2", 2))],
        rascunho: {},
      }),
    ).toBeNull();

    // Campo de vídeo montado e deixado em branco é o mesmo caso: a
    // pessoa viu o campo e seguiu.
    expect(
      validarAnexos({
        exigencias: [opcional(video("a2", 2))],
        rascunho: { a2: { url: "   " } },
      }),
    ).toBeNull();
  });

  it("continua cobrando o que é obrigatório ao lado", () => {
    expect(
      validarAnexos({
        exigencias: [
          opcional(pdf("a1", 1, "Anexos complementares")),
          pdf("a2", 2, "Trabalho completo"),
        ],
        rascunho: {},
      }),
    ).toBe('Anexe o PDF de "Trabalho completo".');
  });

  it("opcional PREENCHIDO passa pelas mesmas conferências", () => {
    expect(
      validarAnexos({
        exigencias: [opcional(video("a1", 1, "Vídeo do projeto"))],
        rascunho: { a1: { url: "https://vimeo.com/123456789" } },
      }),
    ).toBe('O link de "Vídeo do projeto" precisa ser um vídeo do YouTube.');

    expect(
      validarAnexos({
        exigencias: [opcional(pdf("a1", 1, "Carta de anuência"))],
        rascunho: { a1: { arquivo: arquivoPdf(MAX_PDF_BYTES + 1) } },
      }),
    ).toBe('"Carta de anuência": o PDF excede o limite de 10MB.');
  });

  /**
   * Opcional quer dizer "pode nunca ser enviado", NÃO "pode ser
   * desfeito". O contrato de `_anexos` continua sendo "valor nulo =
   * mantém o que está gravado" — é ele que impede que corrigir um título
   * obrigue a reenviar todos os PDFs —, e esvaziar o campo na tela não
   * tem como dizer "apague". A tela não barra; o link gravado é que
   * continua lá. Remover de verdade pede um terceiro estado no corpo da
   * RPC, e é outra migration.
   */
  it("não barra quem esvazia um vídeo opcional já entregue", () => {
    expect(
      validarAnexos({
        exigencias: [opcional(video("a1", 1))],
        rascunho: { a1: { url: "" } },
        atuais: [entregue("a1", "video", YOUTUBE)],
      }),
    ).toBeNull();
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

  it("conta como exigência só o obrigatório; o opcional vira aviso à parte", () => {
    const frase = resumoDoPasso([pdf("a1", 1), opcional(pdf("a2", 2))]);
    expect(frase).toContain("Esta categoria exige 1 arquivo PDF");
    expect(frase).toContain("1 anexo opcional");
    // Somar os dois diria "2 arquivos PDF" e a tela cobraria o que o
    // servidor dispensa.
    expect(frase).not.toContain("2 arquivos PDF");
  });

  it("diz que nada é obrigatório quando só há opcionais", () => {
    expect(resumoDoPasso([opcional(video("a1", 1)), opcional(video("a2", 2))])).toBe(
      "Nenhum anexo é obrigatório aqui · 2 anexos opcionais",
    );
  });

  it("só menciona o limite de 10MB quando há PDF em jogo", () => {
    expect(resumoDoPasso([video("a1", 1)])).not.toContain("10MB");
    expect(resumoDoPasso([opcional(pdf("a1", 1))])).toContain("Limite de 10MB por PDF");
  });
});
