import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

/**
 * Inscrição no congresso (`congress_registrations`).
 *
 * O participante lê e cria a própria; a organização vê e move o status de
 * todas. Como sempre, quem separa os dois casos é o RLS.
 */

export type Inscricao = Tables<"congress_registrations">;

export type InscricaoComPerfil = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  profiles: {
    id: string;
    nome: string | null;
    email: string | null;
    instituicao: string | null;
  } | null;
};

export async function minhaInscricao(userId: string): Promise<Inscricao | null> {
  const { data, error } = await supabase
    .from("congress_registrations")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function inscrever(userId: string): Promise<void> {
  const { error } = await supabase
    .from("congress_registrations")
    .insert({ user_id: userId });
  if (error) throw error;
}

export async function cancelarMinhaInscricao(userId: string): Promise<void> {
  const { error } = await supabase
    .from("congress_registrations")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * Inscrições com os dados do participante, para o painel admin.
 *
 * Não existe FK de `congress_registrations` para `profiles`, então o
 * embed do PostgREST falha com PGRST200 — a junção é feita aqui, no
 * cliente, com uma segunda consulta filtrada pelos ids encontrados.
 */
export async function listarInscricoesComPerfil(): Promise<InscricaoComPerfil[]> {
  const { data: inscricoes, error } = await supabase
    .from("congress_registrations")
    .select("id, user_id, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const ids = Array.from(new Set((inscricoes ?? []).map((r) => r.user_id)));
  const { data: perfis } = ids.length
    ? await supabase.from("profiles").select("id, nome, email, instituicao").in("id", ids)
    : { data: [] };

  const porId = new Map((perfis ?? []).map((p) => [p.id, p]));
  return (inscricoes ?? []).map((r) => ({
    ...r,
    profiles: porId.get(r.user_id) ?? null,
  }));
}

/** Status possíveis de uma inscrição, conforme o CHECK da tabela. */
export type StatusDaInscricao = "pending" | "approved" | "cancelled";

export async function atualizarStatusDaInscricao(
  id: string,
  status: StatusDaInscricao,
): Promise<void> {
  const { error } = await supabase
    .from("congress_registrations")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
}

export async function excluirInscricao(id: string): Promise<void> {
  const { error } = await supabase.from("congress_registrations").delete().eq("id", id);
  if (error) throw error;
}

/** Ids dos inscritos no congresso, opcionalmente só os aprovados. */
export async function idsDosInscritos(apenasAprovados = false): Promise<string[]> {
  const consulta = supabase.from("congress_registrations").select("user_id");
  const { data, error } = apenasAprovados
    ? await consulta.eq("status", "approved")
    : await consulta;
  if (error) throw error;
  return (data ?? []).map((r) => r.user_id).filter(Boolean);
}
