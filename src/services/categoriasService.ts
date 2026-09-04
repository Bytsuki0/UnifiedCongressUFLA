import { supabase } from "@/integrations/supabase/client";
import { ordenarAnexos, type AnexoDaCategoria, type TipoAnexo } from "@/lib/anexos";
import type { Categoria } from "@/lib/types";

/**
 * Categorias do congresso: os critérios de análise e os ANEXOS EXIGIDOS
 * de cada uma.
 *
 * Escrita é restrita à organização pelo RLS (`categorias write`,
 * `criterios write` e `categoria_anexos write` exigem is_event_staff());
 * a leitura é liberada a qualquer autenticado, porque o formulário de
 * submissão precisa saber o que pedir.
 */

export type Criterio = { id?: string; ordem: number; titulo: string };

export type CategoriaComCriterios = {
  id: string;
  nome: string;
  criterios: Criterio[];
  /** O que esta categoria exige da submissão. Pode ser lista vazia. */
  anexos: AnexoDaCategoria[];
};

export type CategoriasCarregadas = {
  categorias: CategoriaComCriterios[];
  /** Quantos trabalhos apontam para cada categoria, por id. */
  contagens: Record<string, number>;
};

/**
 * Carrega categorias, critérios, anexos exigidos e a contagem de
 * trabalhos numa tacada.
 *
 * As consultas vão em paralelo e são cruzadas aqui em memória: são
 * tabelas pequenas (dezenas de linhas) e um join no servidor exigiria uma
 * view nova só para a tela de gestão.
 */
export async function carregarCategorias(): Promise<CategoriasCarregadas> {
  const [cats, crits, anexos, trabalhos] = await Promise.all([
    supabase.from("categorias").select("id, nome").order("nome"),
    supabase.from("criterios").select("id, categoria_id, ordem, titulo"),
    supabase
      .from("categoria_anexos")
      .select("id, categoria_id, tipo, titulo, descricao, ordem"),
    supabase.from("trabalhos").select("id, categoria_id"),
  ]);

  if (cats.error || crits.error || anexos.error || trabalhos.error) {
    throw cats.error ?? crits.error ?? anexos.error ?? trabalhos.error;
  }

  const porCategoria: Record<string, Criterio[]> = {};
  for (const cr of crits.data ?? []) {
    (porCategoria[cr.categoria_id] ??= []).push({
      id: cr.id,
      ordem: cr.ordem,
      titulo: cr.titulo,
    });
  }
  for (const lista of Object.values(porCategoria)) lista.sort((a, b) => a.ordem - b.ordem);

  const anexosPor = agruparAnexos(anexos.data ?? []);

  const contagens: Record<string, number> = {};
  for (const t of trabalhos.data ?? []) {
    if (t.categoria_id) contagens[t.categoria_id] = (contagens[t.categoria_id] ?? 0) + 1;
  }

  return {
    categorias: (cats.data ?? []).map((c) => ({
      id: c.id,
      nome: c.nome,
      criterios: porCategoria[c.id] ?? [],
      anexos: anexosPor[c.id] ?? [],
    })),
    contagens,
  };
}

/* -----------------------------------------------------------------
 * Anexos exigidos por categoria
 * ----------------------------------------------------------------- */

function agruparAnexos(
  linhas: { id: string; categoria_id: string; tipo: string; titulo: string; descricao: string; ordem: number }[],
): Record<string, AnexoDaCategoria[]> {
  const porCategoria: Record<string, AnexoDaCategoria[]> = {};
  for (const linha of linhas) {
    (porCategoria[linha.categoria_id] ??= []).push({
      ...linha,
      tipo: linha.tipo as TipoAnexo,
    });
  }
  for (const chave of Object.keys(porCategoria)) {
    porCategoria[chave] = ordenarAnexos(porCategoria[chave]);
  }
  return porCategoria;
}

/**
 * O que cada categoria exige, indexado por categoria — é o que as quatro
 * telas do autor consultam para montar os campos.
 *
 * Carrega TUDO de uma vez em vez de uma consulta por categoria escolhida:
 * a tabela tem dezenas de linhas, e assim trocar a categoria no
 * formulário não pisca um "carregando" no meio do preenchimento.
 */
export async function listarAnexosPorCategoria(): Promise<Record<string, AnexoDaCategoria[]>> {
  const { data, error } = await supabase
    .from("categoria_anexos")
    .select("id, categoria_id, tipo, titulo, descricao, ordem");
  if (error) throw error;
  return agruparAnexos(data ?? []);
}

export type NovoAnexoCategoria = {
  categoriaId: string;
  tipo: TipoAnexo;
  titulo: string;
  descricao: string;
  ordem: number;
};

/** Acrescenta uma exigência à categoria. A RLS recusa quem não é staff. */
export async function criarAnexoCategoria(
  entrada: NovoAnexoCategoria,
): Promise<AnexoDaCategoria> {
  const { data, error } = await supabase
    .from("categoria_anexos")
    .insert({
      categoria_id: entrada.categoriaId,
      tipo: entrada.tipo,
      titulo: entrada.titulo.trim(),
      descricao: entrada.descricao.trim(),
      ordem: entrada.ordem,
    })
    .select("id, categoria_id, tipo, titulo, descricao, ordem")
    .single();
  if (error) throw new Error(error.message);
  return { ...data, tipo: data.tipo as TipoAnexo };
}

/**
 * Corrige título, descrição ou ordem de uma exigência.
 *
 * `tipo` fica de fora de propósito: trocar 'pdf' por 'video' numa
 * exigência já cumprida deixaria entregas de PDF penduradas numa
 * exigência de vídeo. Quem quiser trocar o tipo remove e cria outra.
 */
export async function atualizarAnexoCategoria(
  id: string,
  campos: { titulo?: string; descricao?: string; ordem?: number },
): Promise<void> {
  const { error } = await supabase.from("categoria_anexos").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Remove uma exigência.
 *
 * O que já foi entregue por ela NÃO some: a FK de `trabalho_anexos` é
 * ON DELETE SET NULL e o título fica gravado na entrega, então o revisor
 * continua vendo a aba. A entrega só sai de fato na próxima gravação do
 * autor, quando `aplicar_anexos` a descarta.
 */
export async function excluirAnexoCategoria(id: string): Promise<void> {
  const { error } = await supabase.from("categoria_anexos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Lista simples para preencher selects (formulário de submissão, filtros). */
export async function listarCategorias(): Promise<Categoria[]> {
  const { data, error } = await supabase.from("categorias").select("*").order("nome");
  if (error) throw error;
  return data ?? [];
}

/**
 * Índice id -> nome, para as telas que só precisam rotular a categoria de
 * um trabalho sem exibir a lista.
 */
export async function mapaCategorias(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("categorias").select("id, nome");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((c) => [c.id, c.nome]));
}

/** Uma exigência ainda não persistida, como o diálogo de nova categoria a monta. */
export type RascunhoAnexoCategoria = { tipo: TipoAnexo; titulo: string; descricao: string };

/**
 * Cria a categoria e, junto, os critérios e os anexos exigidos de título
 * não vazio.
 *
 * Três inserts em vez de um: a categoria precisa existir para as outras
 * duas terem `categoria_id`. Um erro nas listas NÃO desfaz a criação — a
 * categoria já está lá e a tela de edição resolve —, por isso o retorno
 * diz qual das duas falhou em vez de estourar.
 */
export async function criarCategoria(
  nome: string,
  criterios: Criterio[],
  anexos: RascunhoAnexoCategoria[] = [],
): Promise<{ id: string; criteriosComErro: boolean; anexosComErro: boolean }> {
  const { data: categoria, error } = await supabase
    .from("categorias")
    .insert({ nome: nome.trim() })
    .select()
    .single();
  if (error || !categoria) {
    throw new Error("Erro ao criar categoria (o nome já existe?).");
  }

  const linhas = criterios
    .map((c, i) => ({ categoria_id: categoria.id, ordem: i + 1, titulo: c.titulo.trim() }))
    .filter((c) => c.titulo);

  let criteriosComErro = false;
  if (linhas.length) {
    const { error: erroCriterios } = await supabase.from("criterios").insert(linhas);
    criteriosComErro = !!erroCriterios;
  }

  const linhasAnexos = anexos
    .map((a, i) => ({
      categoria_id: categoria.id,
      tipo: a.tipo,
      titulo: a.titulo.trim(),
      descricao: a.descricao.trim(),
      ordem: i + 1,
    }))
    .filter((a) => a.titulo);

  let anexosComErro = false;
  if (linhasAnexos.length) {
    const { error: erroAnexos } = await supabase.from("categoria_anexos").insert(linhasAnexos);
    anexosComErro = !!erroAnexos;
  }

  return { id: categoria.id, criteriosComErro, anexosComErro };
}

export async function excluirCategoria(id: string): Promise<void> {
  const { error } = await supabase.from("categorias").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Grava os critérios de uma categoria: atualiza os que já têm id e insere
 * os novos, renumerando a ordem pela posição atual na lista.
 */
export async function salvarCriterios(
  categoriaId: string,
  criterios: Criterio[],
): Promise<void> {
  const resultados = await Promise.all(
    criterios.map((cr, i) => {
      const payload = { ordem: i + 1, titulo: cr.titulo.trim() };
      return cr.id
        ? supabase.from("criterios").update(payload).eq("id", cr.id)
        : supabase.from("criterios").insert({ ...payload, categoria_id: categoriaId });
    }),
  );
  const falha = resultados.find((r) => r.error);
  if (falha?.error) throw falha.error;
}

/** Remove um critério já persistido. Critério ainda não salvo não chega aqui. */
export async function excluirCriterio(id: string): Promise<void> {
  const { error } = await supabase.from("criterios").delete().eq("id", id);
  if (error) throw error;
}
