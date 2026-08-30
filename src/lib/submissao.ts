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

export type TipoResumo = "simples" | "estendido";

/**
 * O tipo de resumo saiu do formulário — a organização deixou de pedir
 * essa distinção ao autor, e com ela saíram os rótulos e as telas que
 * mostravam o valor.
 *
 * A constante fica porque a coluna `trabalhos.tipo_resumo` continua
 * `NOT NULL` com `CHECK (tipo_resumo IN ('simples','estendido'))`, e as
 * RPCs de escrita (`editar_submissao`, `enviar_correcao`,
 * `reenviar_trabalho`) continuam exigindo `_tipo_resumo`. Toda escrita
 * manda este valor. Apagar a constante exige migration mexendo no CHECK
 * e na assinatura das três RPCs — não é edição de cliente.
 */
export const TIPO_RESUMO_PADRAO: TipoResumo = "simples";

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
