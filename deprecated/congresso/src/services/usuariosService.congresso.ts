/**
 * Saiu de src/services/usuariosService.ts quando a área /congresso foi
 * aposentada: só as telas do congresso (AdminIndex e AdminVerificar)
 * usavam estas duas funções. Ao restaurar, devolva-as para lá — as telas
 * importam de "@/services/usuariosService".
 */
import { supabase } from "@/integrations/supabase/client";

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
