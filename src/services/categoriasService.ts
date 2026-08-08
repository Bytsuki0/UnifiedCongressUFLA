import { supabase } from "@/integrations/supabase/client";
import type { Categoria } from "@/lib/types";

/**
 * Categorias do congresso e os critérios de análise de cada uma.
 *
 * Escrita é restrita à organização pelo RLS (`categorias write` /
 * `criterios write` exigem is_event_staff()); a leitura é liberada a
 * qualquer autenticado, porque o formulário de submissão precisa da lista.
 */

export type Criterio = { id?: string; ordem: number; titulo: string };
export type CategoriaComCriterios = { id: string; nome: string; criterios: Criterio[] };

export type CategoriasCarregadas = {
  categorias: CategoriaComCriterios[];
  /** Quantos trabalhos apontam para cada categoria, por id. */
  contagens: Record<string, number>;
};

/**
 * Carrega categorias, critérios e a contagem de trabalhos numa tacada.
 *
 * As três consultas vão em paralelo e são cruzadas aqui em memória: são
 * tabelas pequenas (dezenas de linhas) e um join no servidor exigiria uma
 * view nova só para a tela de gestão.
 */
export async function carregarCategorias(): Promise<CategoriasCarregadas> {
  const [cats, crits, trabalhos] = await Promise.all([
    supabase.from("categorias").select("id, nome").order("nome"),
    supabase.from("criterios").select("id, categoria_id, ordem, titulo"),
    supabase.from("trabalhos").select("id, categoria_id"),
  ]);

  if (cats.error || crits.error || trabalhos.error) {
    throw cats.error ?? crits.error ?? trabalhos.error;
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

  const contagens: Record<string, number> = {};
  for (const t of trabalhos.data ?? []) {
    if (t.categoria_id) contagens[t.categoria_id] = (contagens[t.categoria_id] ?? 0) + 1;
  }

  return {
    categorias: (cats.data ?? []).map((c) => ({
      id: c.id,
      nome: c.nome,
      criterios: porCategoria[c.id] ?? [],
    })),
    contagens,
  };
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

/** Cria a categoria e, junto, os critérios de título não vazio. */
export async function criarCategoria(
  nome: string,
  criterios: Criterio[],
): Promise<{ id: string; criteriosComErro: boolean }> {
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

  // A categoria já existe: um erro só nos critérios não desfaz a criação,
  // o chamador avisa e a tela de edição resolve.
  let criteriosComErro = false;
  if (linhas.length) {
    const { error: erroCriterios } = await supabase.from("criterios").insert(linhas);
    criteriosComErro = !!erroCriterios;
  }

  return { id: categoria.id, criteriosComErro };
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
