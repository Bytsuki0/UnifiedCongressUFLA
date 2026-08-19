/**
 * Campos que o autor declara na submissão: tipo de resumo e
 * palavras-chave.
 *
 * Vive aqui, e não em `pages/estudante/shared.ts`, porque três portais
 * diferentes precisam das mesmas conversões: o estudante escreve, o
 * revisor lê (`/revisor/analise/:id`) e a organização lê
 * (`/co-chairs/trabalhos/:id`). Uma única definição do que é "uma lista
 * de palavras-chave" evita que as telas discordem sobre o separador.
 */

export type TipoResumo = "simples" | "estendido";

export const TIPO_RESUMO_OPTIONS: { value: TipoResumo; label: string }[] = [
  { value: "simples", label: "Resumo simples" },
  { value: "estendido", label: "Resumo estendido" },
];

export const TIPO_RESUMO_LABEL: Record<string, string> = {
  simples: "Resumo simples",
  estendido: "Resumo estendido",
};

/** Rótulo do tipo de resumo, tolerante a valor ausente ou desconhecido. */
export function rotuloTipoResumo(tipo: string | null | undefined): string {
  return tipo ? (TIPO_RESUMO_LABEL[tipo] ?? tipo) : "—";
}

/**
 * Texto digitado -> lista de termos.
 *
 * Aceita vírgula e ponto e vírgula como separador (quem escreve em
 * pt-BR usa os dois), descarta espaços e vazios e remove repetições
 * SEM reordenar — a ordem em que o autor digitou é a ordem que o banco
 * guarda e que as telas mostram.
 */
export function parsePalavrasChave(texto: string): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of texto.split(/[,;]/)) {
    const termo = bruto.trim();
    if (!termo) continue;
    const chave = termo.toLocaleLowerCase("pt-BR");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(termo);
  }
  return saida;
}

/** Lista do banco -> texto para preencher o input de edição. */
export function formatarPalavrasChave(lista: string[] | null | undefined): string {
  return (lista ?? []).join(", ");
}
