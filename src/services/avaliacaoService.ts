import { supabase } from "@/integrations/supabase/client";
import {
  Avaliacao,
  AvaliacaoStatus,
  Avaliador,
  LIMITE_TRABALHOS_POR_AVALIADOR,
  Trabalho,
} from "@/lib/types";

/**
 * Service responsável pela lógica de distribuição de trabalhos para avaliadores.
 * Centraliza regras de negócio: limite de carga, unicidade e distribuição automática.
 */

export async function listarAvaliacoes(): Promise<Avaliacao[]> {
  const { data, error } = await supabase
    .from("avaliacoes")
    .select("*")
    .order("data_atribuicao", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Avaliacao[];
}

export async function listarTrabalhosDoAvaliador(avaliadorId: string): Promise<Avaliacao[]> {
  const { data, error } = await supabase
    .from("avaliacoes")
    .select("*")
    .eq("avaliador_id", avaliadorId);
  if (error) throw error;
  return (data ?? []) as Avaliacao[];
}

export async function listarAvaliadoresDoTrabalho(trabalhoId: string): Promise<Avaliacao[]> {
  const { data, error } = await supabase
    .from("avaliacoes")
    .select("*")
    .eq("trabalho_id", trabalhoId);
  if (error) throw error;
  return (data ?? []) as Avaliacao[];
}

/**
 * Conta quantos trabalhos cada avaliador já tem atribuídos.
 * Retorna um mapa { avaliadorId: quantidade }.
 */
export async function contarCargaPorAvaliador(): Promise<Record<string, number>> {
  const avaliacoes = await listarAvaliacoes();
  return avaliacoes.reduce<Record<string, number>>((acc, a) => {
    acc[a.avaliador_id] = (acc[a.avaliador_id] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Atribuição manual: valida limite e duplicidade antes de inserir.
 */
export async function atribuirTrabalho(
  avaliadorId: string,
  trabalhoId: string,
): Promise<Avaliacao> {
  // Valida limite de carga
  const { count, error: countError } = await supabase
    .from("avaliacoes")
    .select("*", { count: "exact", head: true })
    .eq("avaliador_id", avaliadorId);
  if (countError) throw countError;
  if ((count ?? 0) >= LIMITE_TRABALHOS_POR_AVALIADOR) {
    throw new Error(
      `Avaliador já atingiu o limite de ${LIMITE_TRABALHOS_POR_AVALIADOR} trabalhos.`,
    );
  }

  const { data, error } = await supabase
    .from("avaliacoes")
    .insert({ avaliador_id: avaliadorId, trabalho_id: trabalhoId })
    .select()
    .single();

  if (error) {
    // 23505 = violação de unique constraint (avaliador + trabalho)
    if (error.code === "23505") {
      throw new Error("Este trabalho já foi atribuído a este avaliador.");
    }
    throw error;
  }
  return data as Avaliacao;
}

export async function removerAvaliacao(id: string): Promise<void> {
  const { error } = await supabase.from("avaliacoes").delete().eq("id", id);
  if (error) throw error;
}

export async function atualizarStatus(id: string, status: AvaliacaoStatus): Promise<void> {
  const { error } = await supabase.from("avaliacoes").update({ status }).eq("id", id);
  if (error) throw error;
}

/**
 * Distribuição semi-automática.
 * Para cada trabalho ainda não atribuído, escolhe o avaliador com menor carga
 * que ainda não avaliou aquele trabalho e respeita o limite máximo.
 * Retorna o número de atribuições criadas.
 */
export async function distribuirAutomaticamente(
  avaliadores: Avaliador[],
  trabalhos: Trabalho[],
): Promise<number> {
  if (avaliadores.length === 0) {
    throw new Error("Nenhum avaliador cadastrado.");
  }

  const existentes = await listarAvaliacoes();

  // carga atual por avaliador
  const carga = new Map<string, number>();
  avaliadores.forEach((a) => carga.set(a.id, 0));
  existentes.forEach((e) => carga.set(e.avaliador_id, (carga.get(e.avaliador_id) ?? 0) + 1));

  // par já existente
  const jaAtribuido = new Set(existentes.map((e) => `${e.avaliador_id}:${e.trabalho_id}`));

  // trabalhos que ainda não têm nenhum avaliador
  const trabalhosComAvaliador = new Set(existentes.map((e) => e.trabalho_id));
  const pendentes = trabalhos.filter((t) => !trabalhosComAvaliador.has(t.id));

  let criados = 0;

  for (const trabalho of pendentes) {
    // ordena avaliadores pela menor carga, respeitando limite e unicidade
    const candidato = [...avaliadores]
      .filter(
        (a) =>
          (carga.get(a.id) ?? 0) < LIMITE_TRABALHOS_POR_AVALIADOR &&
          !jaAtribuido.has(`${a.id}:${trabalho.id}`),
      )
      .sort((a, b) => (carga.get(a.id) ?? 0) - (carga.get(b.id) ?? 0))[0];

    if (!candidato) continue; // ninguém disponível para este trabalho

    const { error } = await supabase
      .from("avaliacoes")
      .insert({ avaliador_id: candidato.id, trabalho_id: trabalho.id });

    if (!error) {
      carga.set(candidato.id, (carga.get(candidato.id) ?? 0) + 1);
      jaAtribuido.add(`${candidato.id}:${trabalho.id}`);
      criados++;
    }
  }

  return criados;
}