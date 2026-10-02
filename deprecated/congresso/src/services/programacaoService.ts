import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

/**
 * Programação do congresso (`schedule`).
 *
 * Como `minicourses`, é legível por `anon`: a grade é material de
 * divulgação e não tem PII. Escrita só pela organização.
 */

export type ItemProgramacao = Tables<"schedule">;

export async function listarProgramacao(): Promise<ItemProgramacao[]> {
  const { data, error } = await supabase
    .from("schedule")
    .select("*")
    .order("data")
    .order("horario_inicio");
  if (error) throw error;
  return data ?? [];
}

/** Próximas atividades, para o resumo do painel do participante. */
export async function proximasAtividades(limite = 3): Promise<ItemProgramacao[]> {
  const { data, error } = await supabase
    .from("schedule")
    .select("*")
    .order("data")
    .order("horario_inicio")
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}

export async function salvarItemProgramacao(
  id: string | undefined,
  dados: TablesInsert<"schedule">,
): Promise<void> {
  const { error } = id
    ? await supabase.from("schedule").update(dados).eq("id", id)
    : await supabase.from("schedule").insert(dados);
  if (error) throw error;
}

export async function excluirItemProgramacao(id: string): Promise<void> {
  const { error } = await supabase.from("schedule").delete().eq("id", id);
  if (error) throw error;
}

/** Lista reduzida (id + título) para os seletores de evento. */
export async function listarProgramacaoParaSelecao(): Promise<
  { id: string; titulo: string }[]
> {
  const { data, error } = await supabase.from("schedule").select("id, titulo");
  if (error) throw error;
  return data ?? [];
}
