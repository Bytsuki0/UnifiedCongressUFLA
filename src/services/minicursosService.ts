import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

/**
 * Minicursos e as inscrições neles.
 *
 * `minicourses` é a única tabela (com `schedule`) legível por `anon` — a
 * página de divulgação abre sem sessão. A escrita é da organização, e as
 * inscrições são do próprio usuário; ambas as regras vêm do RLS.
 */

export type Minicurso = Tables<"minicourses">;

export async function listarMinicursos(): Promise<Minicurso[]> {
  const { data, error } = await supabase
    .from("minicourses")
    .select("*")
    .order("data")
    .order("horario_inicio");
  if (error) throw error;
  return data ?? [];
}

/** Versão do painel admin: ordenada só por data. */
export async function listarMinicursosAdmin(): Promise<Minicurso[]> {
  const { data, error } = await supabase.from("minicourses").select("*").order("data");
  if (error) throw error;
  return data ?? [];
}

/** Ids dos minicursos em que este usuário está inscrito. */
export async function listarMinhasInscricoesEmMinicursos(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("minicourse_registrations")
    .select("minicourse_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.minicourse_id);
}

/**
 * Ocupação por minicurso. Vem de RPC porque contar inscrições exigiria
 * ler `minicourse_registrations` de todo mundo, o que o RLS (com razão)
 * não permite ao participante.
 */
export async function ocupacaoDosMinicursos(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("minicourse_occupancy");
  if (error) throw error;
  const mapa: Record<string, number> = {};
  for (const linha of data ?? []) {
    mapa[linha.minicourse_id] = Number(linha.inscritos) || 0;
  }
  return mapa;
}

/** Contagem de inscritos por minicurso, para o painel admin. */
export async function contarInscritosPorMinicurso(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("minicourse_registrations")
    .select("minicourse_id");
  if (error) throw error;
  const mapa: Record<string, number> = {};
  for (const r of data ?? []) {
    mapa[r.minicourse_id] = (mapa[r.minicourse_id] ?? 0) + 1;
  }
  return mapa;
}

export async function inscreverEmMinicurso(
  userId: string,
  minicursoId: string,
): Promise<void> {
  const { error } = await supabase
    .from("minicourse_registrations")
    .insert({ user_id: userId, minicourse_id: minicursoId });
  if (error) throw error;
}

export async function cancelarInscricaoEmMinicurso(
  userId: string,
  minicursoId: string,
): Promise<void> {
  const { error } = await supabase
    .from("minicourse_registrations")
    .delete()
    .eq("user_id", userId)
    .eq("minicourse_id", minicursoId);
  if (error) throw error;
}

/** Cria ou atualiza um minicurso (painel admin). */
export async function salvarMinicurso(
  id: string | undefined,
  dados: TablesInsert<"minicourses">,
): Promise<void> {
  const { error } = id
    ? await supabase.from("minicourses").update(dados).eq("id", id)
    : await supabase.from("minicourses").insert(dados);
  if (error) throw error;
}

export async function excluirMinicurso(id: string): Promise<void> {
  const { error } = await supabase.from("minicourses").delete().eq("id", id);
  if (error) throw error;
}

/** Lista reduzida (id + título) para os seletores de evento. */
export async function listarMinicursosParaSelecao(): Promise<
  { id: string; titulo: string }[]
> {
  const { data, error } = await supabase.from("minicourses").select("id, nome");
  if (error) throw error;
  return (data ?? []).map((m) => ({ id: m.id, titulo: m.nome }));
}

/** Minicursos em que o usuário está inscrito, com os dados de cada um. */
export async function listarMeusMinicursos(userId: string) {
  const { data, error } = await supabase
    .from("minicourse_registrations")
    .select("id, minicourses(nome, data, horario_inicio, local)")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

/** Minhas inscrições com o minicurso completo, para a tela de inscrição. */
export async function listarMinhasInscricoesDetalhadas(userId: string) {
  const { data, error } = await supabase
    .from("minicourse_registrations")
    .select(
      "id, minicourse_id, status, minicourses(id, nome, descricao, ministrante, data, horario_inicio, horario_fim, local)",
    )
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}
