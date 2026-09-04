import { supabase } from "@/integrations/supabase/client";

/**
 * Cronograma do congresso — a LISTA de datas que a organização publica.
 *
 * Migration 20260829120000, reescrita pela 20260903120000: era um
 * calendário (meses publicados, dias pintados um a um) e virou uma lista
 * de itens, cada um com nome, descrição, cor e um período. Sumiram junto
 * as tabelas `cronograma_meses` e `cronograma_dias` e a RPC de escrita —
 * com uma tabela só não há duas gravações para coordenar.
 *
 * Duas leituras bem diferentes convivem aqui:
 *
 *   · `carregarCronogramaPublico()` — a landing (SEM sessão), /cronograma
 *     e /estudante/cronograma. Vai pela RPC `cronograma_publico()`, que o
 *     `anon` pode executar; a tabela continua fechada para quem não tem
 *     sessão.
 *   · `carregarCronogramaGestao()` — só /co-chairs/cronograma. Lê a
 *     TABELA, porque quem edita precisa que um erro apareça.
 *
 * As duas devolvem o mesmo conjunto de itens: publicar deixou de ser um
 * estado (era "estar num mês publicado") e passou a ser simplesmente
 * existir na tabela. O que separa as duas é a política de ERRO e o
 * caminho de acesso, não o recorte dos dados.
 *
 * ⚠ Datas trafegam como 'AAAA-MM-DD' e ficam assim o tempo todo. Nunca
 * passar isso por `new Date(...)`: a string sem hora é lida como UTC e,
 * no fuso de Lavras, "2026-08-01" vira 31/07. Os helpers de
 * `src/lib/cronograma.ts` trabalham na própria string.
 */

/** Um item da lista: nome, descrição, cor e o período que ele cobre. */
export type ItemCronograma = {
  id: string;
  titulo: string;
  descricao: string;
  /** Hex de 6 dígitos — o CHECK da coluna não aceita outra coisa. */
  cor: string;
  data_inicio: string;
  data_fim: string;
};

/** O que a tela de gestão manda para criar ou atualizar um item. */
export type NovoItemCronograma = Omit<ItemCronograma, "id">;

const COLUNAS = "id, titulo, descricao, cor, data_inicio, data_fim";

/**
 * O cronograma como o visitante o vê, em ordem cronológica (a ordem vem
 * da própria RPC).
 *
 * Falha devolve lista vazia, e não um erro na tela: o cronograma é
 * conteúdo informativo da landing, e uma consulta que não respondeu não
 * pode derrubar a página inicial inteira — a seção simplesmente não
 * aparece. (Mesma escolha de `carregarArquivosDownload`, e o oposto do
 * prazo de submissão, que falha ABERTO porque lá o "não sei" seguro é
 * deixar passar.)
 */
export async function carregarCronogramaPublico(): Promise<ItemCronograma[]> {
  const { data, error } = await supabase.rpc("cronograma_publico");
  if (error) return [];
  return data ?? [];
}

/**
 * A mesma lista, pela tabela, para a tela de gestão. Aqui um erro
 * PRECISA aparecer: quem está editando tem de saber que a lista na tela
 * não é a lista do banco, senão acrescenta em cima de um estado que não
 * é o do servidor.
 */
export async function carregarCronogramaGestao(): Promise<ItemCronograma[]> {
  const { data, error } = await supabase
    .from("cronograma_eventos")
    .select(COLUNAS)
    .order("data_inicio")
    .order("data_fim")
    .order("titulo");

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Cria um item. `criado_por` NÃO vai no corpo: a coluna tem
 * `DEFAULT auth.uid()`, então o autor é carimbado pelo banco e o cliente
 * não tem como informar outro.
 */
export async function criarItemCronograma(entrada: NovoItemCronograma): Promise<ItemCronograma> {
  const { data, error } = await supabase
    .from("cronograma_eventos")
    .insert(entrada)
    .select(COLUNAS)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Reescreve um item. */
export async function atualizarItemCronograma(
  id: string,
  campos: Partial<NovoItemCronograma>,
): Promise<void> {
  const { error } = await supabase.from("cronograma_eventos").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Tira um item do cronograma. Não há "despublicar": existir é estar no ar. */
export async function removerItemCronograma(id: string): Promise<void> {
  const { error } = await supabase.from("cronograma_eventos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
