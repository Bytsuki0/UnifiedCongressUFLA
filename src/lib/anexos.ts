import { idDoVideo } from "@/lib/youtube";

/**
 * Anexos da submissão — o que cada categoria exige e o que cada trabalho
 * entregou.
 *
 * Até 20260904 a submissão era a mesma para todo mundo: `trabalhos` tinha
 * UM `pdf_url` e UM `video_url`, e as quatro telas do autor tinham uma
 * área de upload e um campo de link, fixos. Agora a organização define
 * por categoria — BIC Jr. pede um PDF e um vídeo, Extensão pede dois PDFs
 * e nenhum vídeo — e as telas se montam a partir disso.
 *
 * Este arquivo é só a parte PURA: tipos, ordenação e validação. Quem fala
 * com o Storage e com as RPCs é `services/anexosService.ts`. A separação
 * importa porque a validação daqui roda em quatro telas do autor e
 * precisa ser testável sem rede.
 *
 * ⚠ A validação abaixo é CORTESIA, para a pessoa não preencher um
 * formulário que o banco vai recusar. Quem recusa de verdade é
 * `aplicar_anexos`, no servidor. As mensagens são propositalmente
 * parecidas com as de lá.
 */

export type TipoAnexo = "pdf" | "video";

/** Uma exigência da categoria: "esta categoria pede isto". */
export type AnexoDaCategoria = {
  id: string;
  categoria_id: string;
  tipo: TipoAnexo;
  /** Rótulo curto — é ele que vira nome de aba na tela do revisor. */
  titulo: string;
  /** Frase de apoio sob o campo. Vazia esconde a linha. */
  descricao: string;
  ordem: number;
};

/**
 * Uma entrega do trabalho: "este trabalho mandou isto".
 *
 * `anexo_id` nulo significa que a exigência que a originou foi apagada
 * (ou a categoria inteira). A linha sobrevive de propósito — `tipo`,
 * `titulo` e `ordem` são cópia feita na escrita, e é isso que mantém a
 * aba do revisor com nome depois que a exigência some.
 */
export type AnexoDoTrabalho = {
  id: string;
  anexo_id: string | null;
  tipo: TipoAnexo;
  titulo: string;
  ordem: number;
  /** Caminho no bucket `Pdfs` (tipo 'pdf') ou URL do YouTube (tipo 'video'). */
  valor: string;
};

/** O que o formulário guarda para UMA exigência. */
export type RascunhoAnexo = {
  /** PDF escolhido agora. Ausente = manter o que já está gravado. */
  arquivo?: File | null;
  /** Link de vídeo digitado. */
  url?: string;
};

/** Estado do formulário, indexado pelo id da exigência. */
export type RascunhoAnexos = Record<string, RascunhoAnexo>;

/** Um item do corpo `_anexos` das RPCs. `valor` nulo = "mantém o atual". */
export type AnexoParaEnvio = { anexo_id: string; valor: string | null };

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * A ordem em que as telas mostram anexo: a que a organização definiu,
 * com o título desempatando para a lista nunca embaralhar entre dois
 * carregamentos. É a mesma ordem do `ORDER BY` do servidor.
 */
export function ordenarAnexos<T extends { ordem: number; titulo: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo, "pt-BR"));
}

/** O que o trabalho já tem gravado para uma exigência, se tiver. */
export function valorAtual(
  atuais: AnexoDoTrabalho[] | undefined,
  anexoId: string,
): string | null {
  return (atuais ?? []).find((a) => a.anexo_id === anexoId)?.valor ?? null;
}

/**
 * Entregas que não correspondem a exigência nenhuma da categoria atual.
 *
 * Aparecem quando a organização remove uma exigência (ou apaga a
 * categoria) depois de o trabalho ter sido submetido. As telas do autor
 * as mostram em modo leitura, avisando que a próxima gravação as
 * descarta — que é exatamente o que `aplicar_anexos` faz. Sem esse aviso
 * o arquivo sumiria sem explicação.
 */
export function anexosOrfaos(
  atuais: AnexoDoTrabalho[] | undefined,
  exigencias: AnexoDaCategoria[],
): AnexoDoTrabalho[] {
  const exigidos = new Set(exigencias.map((e) => e.id));
  return ordenarAnexos((atuais ?? []).filter((a) => !a.anexo_id || !exigidos.has(a.anexo_id)));
}

/**
 * Confere o rascunho contra as exigências. Devolve a primeira mensagem de
 * erro em pt-BR, ou `null` quando está tudo certo.
 *
 * `atuais` é o que já está gravado: com ele, não mandar arquivo novo
 * significa "mantém o que está lá"; sem ele (submissão nova), significa
 * que falta anexar.
 */
export function validarAnexos(args: {
  exigencias: AnexoDaCategoria[];
  rascunho: RascunhoAnexos;
  atuais?: AnexoDoTrabalho[];
}): string | null {
  const { exigencias, rascunho, atuais } = args;

  for (const exigencia of ordenarAnexos(exigencias)) {
    const item = rascunho[exigencia.id] ?? {};
    const jaGravado = valorAtual(atuais, exigencia.id);

    if (exigencia.tipo === "video") {
      // O campo de vídeo é texto: o que vale é o que está na tela agora.
      // `undefined` (a tela nem montou o campo ainda) cai no que está
      // gravado; string vazia é a pessoa tendo apagado o link.
      const url = (item.url ?? jaGravado ?? "").trim();
      if (!url) {
        return `Informe o link de vídeo de "${exigencia.titulo}".`;
      }
      if (!idDoVideo(url)) {
        return `O link de "${exigencia.titulo}" precisa ser um vídeo do YouTube.`;
      }
      continue;
    }

    const arquivo = item.arquivo ?? null;
    if (!arquivo) {
      if (!jaGravado) return `Anexe o PDF de "${exigencia.titulo}".`;
      continue; // mantém o arquivo que já está gravado
    }
    if (arquivo.type !== "application/pdf") {
      return `"${exigencia.titulo}": o arquivo precisa estar em formato PDF.`;
    }
    if (arquivo.size > MAX_PDF_BYTES) {
      return `"${exigencia.titulo}": o PDF excede o limite de 10MB.`;
    }
  }

  return null;
}

/**
 * O rascunho inicial de uma tela de EDIÇÃO: os links de vídeo já
 * preenchidos com o que está gravado, os PDFs vazios (que significa
 * "manter").
 */
export function rascunhoInicial(
  exigencias: AnexoDaCategoria[],
  atuais: AnexoDoTrabalho[],
): RascunhoAnexos {
  const inicial: RascunhoAnexos = {};
  for (const exigencia of exigencias) {
    if (exigencia.tipo === "video") {
      inicial[exigencia.id] = { url: valorAtual(atuais, exigencia.id) ?? "" };
    }
  }
  return inicial;
}

/**
 * A frase que resume o que a categoria pede, para o cabeçalho do passo de
 * anexos nas telas do autor.
 *
 * Mora aqui, e não junto do componente, por duas razões: um .tsx só pode
 * exportar componentes (`react-refresh/only-export-components`), e a
 * frase tem de concordar com o que `validarAnexos` cobra — as duas mudam
 * no mesmo arquivo se um dia existir anexo opcional.
 */
export function resumoDoPasso(exigencias: AnexoDaCategoria[]): string {
  const pdfs = exigencias.filter((e) => e.tipo === "pdf").length;
  const videos = exigencias.filter((e) => e.tipo === "video").length;
  const partes: string[] = [];
  if (pdfs > 0) partes.push(pdfs === 1 ? "1 arquivo PDF" : `${pdfs} arquivos PDF`);
  if (videos > 0) partes.push(videos === 1 ? "1 link de vídeo" : `${videos} links de vídeo`);
  if (partes.length === 0) return "Esta categoria não exige anexo.";
  return `Esta categoria exige ${partes.join(" e ")} · Limite de 10MB por PDF`;
}
