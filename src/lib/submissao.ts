/**
 * Palavras-chave da submissão — o que o autor digita e o que as telas
 * leem de volta.
 *
 * Vive aqui, e não em `pages/estudante/shared.ts`, porque três portais
 * diferentes precisam das mesmas conversões: o estudante escreve, o
 * revisor lê (`/revisor/analise/:id`) e a organização lê
 * (`/co-chairs/trabalhos/:id`). Uma única definição do que é "uma lista
 * de palavras-chave" evita que as telas discordem sobre o separador.
 */

/*
 * O tipo de resumo ("simples" | "estendido") saiu daqui em 20260904.
 *
 * O radio já não existia em tela nenhuma desde antes, mas a constante
 * `TIPO_RESUMO_PADRAO` sobrevivia porque a coluna `trabalhos.tipo_resumo`
 * era NOT NULL com CHECK e as três RPCs de escrita exigiam
 * `_tipo_resumo`. A migration 20260904120000 dropou a coluna e reescreveu
 * as três assinaturas, então não há mais nada a alimentar.
 */

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
