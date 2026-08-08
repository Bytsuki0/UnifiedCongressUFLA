import { supabase } from "@/integrations/supabase/client";
import type { Avaliador } from "@/lib/types";

/**
 * Co-chairs cadastrados (tabela `avaliadores`).
 *
 * Não confundir com o pool de revisores do revisorService: o pool é a
 * lista de quem PODE revisar, montada a partir de `user_roles`; esta
 * tabela é o cadastro da organização, que inclui co-chairs sem conta.
 * Escrita é restrita à organização pelo RLS (`avaliadores write`).
 */

export type ProfessorElegivel = {
  id: string;
  nome: string;
  email: string;
  departamento: string;
};

export async function listarAvaliadores(): Promise<Avaliador[]> {
  const { data, error } = await supabase
    .from("avaliadores")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function excluirAvaliador(id: string): Promise<void> {
  const { error } = await supabase.from("avaliadores").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Professores que ainda NÃO são avaliadores.
 *
 * O cruzamento é feito no cliente por e-mail porque as duas tabelas são
 * pequenas e não existe FK entre elas — um professor vira avaliador por
 * cópia de nome/e-mail, não por referência.
 */
export async function listarProfessoresElegiveis(): Promise<ProfessorElegivel[]> {
  const [professores, avaliadores] = await Promise.all([
    supabase.from("professores").select("id, nome, email, departamento").order("nome"),
    supabase.from("avaliadores").select("email"),
  ]);
  if (professores.error) throw professores.error;

  const jaAvaliadores = new Set((avaliadores.data ?? []).map((a) => a.email));
  return (professores.data ?? []).filter((p) => !jaAvaliadores.has(p.email));
}

/** Erro de e-mail duplicado, para o chamador distinguir a mensagem. */
export class AvaliadorDuplicadoError extends Error {
  constructor() {
    super("Este professor já é avaliador");
    this.name = "AvaliadorDuplicadoError";
  }
}

export async function promoverProfessor(prof: ProfessorElegivel): Promise<void> {
  const { error } = await supabase.from("avaliadores").insert({
    nome: prof.nome,
    email: prof.email,
    instituicao: prof.departamento || "UFLA",
  });
  if (!error) return;
  // 23505 = unique_violation: alguém já promoveu este professor.
  if (error.code === "23505") throw new AvaliadorDuplicadoError();
  throw error;
}
