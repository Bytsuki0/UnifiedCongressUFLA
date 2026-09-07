import { supabase } from "@/integrations/supabase/client";

/**
 * Anais do Congresso — onde os trabalhos do congresso foram publicados.
 *
 * Migration 20260907120000. Mesmo desenho de `arquivos_download` e do
 * cronograma: a organização edita as linhas em /co-chairs/anais, o
 * visitante lê pela RPC `anais_publicos()` e a tabela continua fechada
 * para quem não tem sessão.
 *
 * Duas leituras, com políticas de ERRO opostas — e a diferença é o
 * ponto:
 *
 *   · `carregarAnaisPublicos()` — /anais e a seção da landing, SEM
 *     sessão. Falha devolve lista vazia. Não há autoridade do outro lado
 *     de um `href`: mandar o visitante para um endereço que ninguém
 *     cadastrou só produz uma aba de erro.
 *   · `listarAnais()` — a tela de gestão. Falha PROPAGA: quem publica
 *     não pode receber lista vazia por falha de rede e acrescentar em
 *     cima de um estado que não é o do banco.
 *
 * (É a mesma dupla de `carregarArquivosDownload` / `listarArquivosDownload`,
 * e o oposto do prazo de submissão, que falha ABERTO porque lá o "não
 * sei" seguro é deixar passar.)
 */

/** Uma publicação, como as telas públicas a recebem. */
export type PublicacaoAnais = {
  id: string;
  titulo: string;
  /** Onde e quando saiu, em texto livre. Vazio esconde a linha. */
  descricao: string;
  url: string;
};

/** A mesma linha do ponto de vista de quem edita: leva a ordem junto. */
export type PublicacaoAnaisAdmin = PublicacaoAnais & { ordem: number };

const COLUNAS = "id, titulo, descricao, url, ordem";

/** O que a tela de gestão manda para criar ou atualizar. */
export type NovaPublicacaoAnais = {
  titulo: string;
  descricao: string;
  url: string;
  ordem: number;
};

/** Os anais publicados, em ordem. Falha silenciosa — ver o cabeçalho. */
export async function carregarAnaisPublicos(): Promise<PublicacaoAnais[]> {
  const { data, error } = await supabase.rpc("anais_publicos");
  if (error || !data) return [];
  return data as PublicacaoAnais[];
}

/** A mesma lista pela TABELA, para a tela de gestão. Aqui o erro aparece. */
export async function listarAnais(): Promise<PublicacaoAnaisAdmin[]> {
  const { data, error } = await supabase
    .from("anais")
    .select(COLUNAS)
    .order("ordem")
    .order("criado_em");
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicacaoAnaisAdmin[];
}

/**
 * Publica uma linha nos anais. `criado_por` NÃO vai no corpo: a coluna
 * tem `DEFAULT auth.uid()`, então o autor é carimbado pelo banco e o
 * cliente não tem como informar outro. A RLS recusa quem não é staff.
 */
export async function criarPublicacaoAnais(
  entrada: NovaPublicacaoAnais,
): Promise<PublicacaoAnaisAdmin> {
  const { data, error } = await supabase
    .from("anais")
    .insert({
      titulo: entrada.titulo.trim(),
      descricao: entrada.descricao.trim(),
      url: entrada.url.trim(),
      ordem: entrada.ordem,
    })
    .select(COLUNAS)
    .single();
  if (error) throw new Error(error.message);
  return data as PublicacaoAnaisAdmin;
}

/** Corrige título, referência ou link de uma publicação já no ar. */
export async function atualizarPublicacaoAnais(
  id: string,
  campos: Partial<NovaPublicacaoAnais>,
): Promise<void> {
  const { error } = await supabase.from("anais").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Tira a publicação do ar. Não há "despublicar": existir é estar no ar. */
export async function removerPublicacaoAnais(id: string): Promise<void> {
  const { error } = await supabase.from("anais").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
