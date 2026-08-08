import { supabase } from "@/integrations/supabase/client";

/**
 * Listagem unificada de contas para o painel do evento.
 *
 * Os participantes vivem em quatro lugares por herança do cadastro:
 * `estudantes`, `professores`, `avaliadores` e — no caso do externo, que
 * não tem tabela institucional — `profiles` cruzado com `user_roles`.
 * Este serviço é o que costura os quatro numa lista só.
 */

export type TipoDeConta = "Estudante" | "Professor" | "Avaliador" | "Externo";
export type OrigemDaConta = "estudantes" | "professores" | "avaliadores" | "profiles";

export type ContaListada = {
  id: string;
  nome: string;
  email: string;
  /** curso / departamento / instituição, conforme a origem. */
  detalhe: string;
  tipo: TipoDeConta;
  source: OrigemDaConta;
  created_at?: string;
};

/**
 * Todas as contas, exceto as de administrador.
 *
 * Admins são omitidos de propósito: a tela serve para gerir participantes
 * e a remoção acidental de um admin não deve ser possível daqui. O papel
 * vem de `user_roles` (não de e-mail hardcoded — SEC-06).
 */
export async function listarContasDoEvento(): Promise<ContaListada[]> {
  const [estudantes, professores, avaliadores, admins, externos] = await Promise.all([
    supabase.from("estudantes").select("id, user_id, nome, email, curso, created_at"),
    supabase.from("professores").select("id, user_id, nome, email, departamento, created_at"),
    supabase.from("avaliadores").select("id, nome, email, instituicao, created_at"),
    supabase.from("user_roles").select("user_id").eq("role", "admin"),
    supabase.from("user_roles").select("user_id").eq("role", "externo"),
  ]);

  const idsAdmin = new Set((admins.data ?? []).map((r) => r.user_id));

  // `user_roles` não tem FK para `profiles` (ambos apontam para
  // auth.users), então os dados do externo saem numa segunda consulta.
  const idsExternos = (externos.data ?? [])
    .map((r) => r.user_id)
    .filter((id) => !idsAdmin.has(id));
  const { data: perfisExternos } = idsExternos.length
    ? await supabase
        .from("profiles")
        .select("id, nome, email, instituicao, created_at")
        .in("id", idsExternos)
    : { data: [] };

  const linhas: ContaListada[] = [
    ...(estudantes.data ?? [])
      .filter((u) => !idsAdmin.has(u.user_id))
      .map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        detalhe: u.curso ?? "",
        tipo: "Estudante" as const,
        source: "estudantes" as const,
        created_at: u.created_at,
      })),
    ...(professores.data ?? [])
      .filter((u) => !idsAdmin.has(u.user_id))
      .map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        detalhe: u.departamento ?? "",
        tipo: "Professor" as const,
        source: "professores" as const,
        created_at: u.created_at,
      })),
    ...(avaliadores.data ?? []).map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      detalhe: u.instituicao ?? "",
      tipo: "Avaliador" as const,
      source: "avaliadores" as const,
      created_at: u.created_at,
    })),
    ...(perfisExternos ?? []).map((u) => ({
      id: u.id,
      nome: u.nome ?? "",
      email: u.email ?? "",
      detalhe: u.instituicao ?? "",
      tipo: "Externo" as const,
      source: "profiles" as const,
      created_at: u.created_at,
    })),
  ];

  return linhas.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

/** Remove a conta da tabela de origem em que ela foi listada. */
export async function excluirConta(conta: ContaListada): Promise<void> {
  const { error } = await supabase.from(conta.source).delete().eq("id", conta.id);
  if (error) throw error;
}

/** Perfis por id, para as telas que precisam do nome de quem se inscreveu. */
export async function listarPerfisPorIds(ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, email")
    .in("id", ids);
  if (error) throw error;
  return data ?? [];
}

export type ResumoDoEvento = {
  estudantes: number;
  professores: number;
  avaliadores: number;
  inscricoes: number;
  minicursos: number;
  certificados: number;
  programacao: number;
};

/**
 * Contadores da capa do painel. Usa `head: true` com `count: "exact"`:
 * o Postgres conta sem devolver linha nenhuma, então o custo não cresce
 * com o tamanho das tabelas.
 */
export async function resumoDoEvento(): Promise<ResumoDoEvento> {
  const contar = (tabela: "estudantes" | "professores" | "avaliadores" | "congress_registrations" | "minicourses" | "certificates" | "schedule") =>
    supabase.from(tabela).select("id", { count: "exact", head: true });

  const [est, prof, aval, insc, mini, cert, sched] = await Promise.all([
    contar("estudantes"),
    contar("professores"),
    contar("avaliadores"),
    contar("congress_registrations"),
    contar("minicourses"),
    contar("certificates"),
    contar("schedule"),
  ]);

  return {
    estudantes: est.count ?? 0,
    professores: prof.count ?? 0,
    avaliadores: aval.count ?? 0,
    inscricoes: insc.count ?? 0,
    minicursos: mini.count ?? 0,
    certificados: cert.count ?? 0,
    programacao: sched.count ?? 0,
  };
}
