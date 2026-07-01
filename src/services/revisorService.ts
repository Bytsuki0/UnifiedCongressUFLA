import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  Criterio,
  LIMITE_TRABALHOS_POR_AVALIADOR,
  MAX_REVISORES_POR_TRABALHO,
  Parecer,
  ParecerItem,
  ResultadoParecer,
  TrabalhoRevisor,
} from "@/lib/types";

// Um revisor associável: avaliador OU professor, tratados igualmente.
export type RevisorOption = {
  email: string;
  nome: string;
  tipo: "avaliador" | "professor";
};

/**
 * Serviço da análise de trabalhos pelo revisor.
 * Lida com a associação revisor<->trabalho (tabela trabalho_revisores) e
 * com os pareceres estruturados (nota/comentário por critério).
 */

// Trabalho como vem embarcado na associação (campos usados na análise).
export type TrabalhoAssociado = {
  id: string;
  titulo: string;
  resumo: string;
  autores: string;
  categoria_id: string | null;
  status: string;
  data_submissao: string;
  orientador_email: string | null;
  coautores: unknown;
  pdf_url: string | null;
};

export type AssociacaoComTrabalho = TrabalhoRevisor & {
  trabalho: TrabalhoAssociado | null;
};

/** Lista os trabalhos associados a um revisor (por e-mail), com os dados do trabalho. */
export async function listarTrabalhosAssociados(
  email: string,
): Promise<AssociacaoComTrabalho[]> {
  const { data, error } = await supabase
    .from("trabalho_revisores")
    .select("*, trabalho:trabalhos(*)")
    .eq("revisor_email", email)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AssociacaoComTrabalho[];
}

/** Critérios de avaliação de uma categoria, em ordem. */
export async function listarCriterios(categoriaId: string): Promise<Criterio[]> {
  const { data, error } = await supabase
    .from("criterios")
    .select("*")
    .eq("categoria_id", categoriaId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Criterio[];
}

/** Parecer já registrado por este revisor para este trabalho (se houver). */
export async function obterParecer(
  trabalhoId: string,
  email: string,
): Promise<Parecer | null> {
  const { data, error } = await supabase
    .from("pareceres")
    .select("*")
    .eq("trabalho_id", trabalhoId)
    .eq("revisor_email", email)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    itens: Array.isArray(data.itens) ? (data.itens as unknown as ParecerItem[]) : [],
  } as Parecer;
}

export type SalvarParecerInput = {
  trabalhoId: string;
  revisorEmail: string;
  revisorNome?: string | null;
  resultado: ResultadoParecer;
  itens: ParecerItem[];
  comentarioGeral?: string | null;
};

/** Cria ou atualiza o parecer do revisor para o trabalho (1 por par revisor/trabalho). */
export async function salvarParecer(input: SalvarParecerInput): Promise<void> {
  const { error } = await supabase.from("pareceres").upsert(
    {
      trabalho_id: input.trabalhoId,
      revisor_email: input.revisorEmail,
      revisor_nome: input.revisorNome ?? null,
      resultado: input.resultado,
      itens: input.itens as unknown as Json,
      comentario_geral: input.comentarioGeral ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "trabalho_id,revisor_email" },
  );
  if (error) throw error;
}

/**
 * Espelha um parecer na tabela `avaliacoes`, alimentando a página de Rankings.
 * Só atualiza quando existe uma atribuição (avaliador registrado + trabalho)
 * para o e-mail informado; caso contrário, é um no-op silencioso.
 */
export async function espelharParecerEmAvaliacao(input: {
  trabalhoId: string;
  revisorEmail: string;
  notas: ParecerItem[];
  resultado: ResultadoParecer;
  comentarioGeral?: string | null;
}): Promise<void> {
  if (input.notas.length === 0) return;

  const { data: avaliador } = await supabase
    .from("avaliadores")
    .select("id")
    .ilike("email", input.revisorEmail)
    .maybeSingle();
  if (!avaliador) return; // revisor não é um avaliador com atribuição -> nada a espelhar

  const media =
    input.notas.reduce((soma, item) => soma + Number(item.nota), 0) / input.notas.length;
  const decisao = input.resultado === "nao_aprovado" ? "rejeitado" : "aceito";

  await supabase
    .from("avaliacoes")
    .update({
      nota_geral: Number(media.toFixed(2)),
      decisao,
      comentarios: input.comentarioGeral?.trim() || null,
      status: "concluida",
      data_avaliacao: new Date().toISOString(),
    })
    .eq("avaliador_id", avaliador.id)
    .eq("trabalho_id", input.trabalhoId);
}

/** Revisores associados a um trabalho. */
export async function listarRevisoresDoTrabalho(
  trabalhoId: string,
): Promise<TrabalhoRevisor[]> {
  const { data, error } = await supabase
    .from("trabalho_revisores")
    .select("*")
    .eq("trabalho_id", trabalhoId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TrabalhoRevisor[];
}

/** Associa um revisor (avaliador ou professor) a um trabalho. Máximo de 3. */
export async function associarRevisor(
  trabalhoId: string,
  email: string,
  nome: string | null,
  tipo: "avaliador" | "professor",
): Promise<void> {
  // Validação amigável antes de bater no trigger do banco.
  const { count, error: countError } = await supabase
    .from("trabalho_revisores")
    .select("*", { count: "exact", head: true })
    .eq("trabalho_id", trabalhoId);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_REVISORES_POR_TRABALHO) {
    throw new Error(
      `Este trabalho já possui ${MAX_REVISORES_POR_TRABALHO} revisores associados (máximo).`,
    );
  }

  const { error } = await supabase
    .from("trabalho_revisores")
    .insert({ trabalho_id: trabalhoId, revisor_email: email, revisor_nome: nome, tipo });
  if (error) {
    if (error.code === "23505") {
      throw new Error("Este revisor já está associado a este trabalho.");
    }
    throw error;
  }
}

export async function removerRevisor(id: string): Promise<void> {
  const { error } = await supabase.from("trabalho_revisores").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Distribuição automática unificada: para cada trabalho ainda sem revisor,
 * associa o revisor (avaliador OU professor, tratados igualmente) com menor
 * carga, respeitando o limite por revisor. Retorna o número de associações criadas.
 */
export async function distribuirRevisoresAutomaticamente(
  revisores: RevisorOption[],
  trabalhoIds: string[],
): Promise<number> {
  if (revisores.length === 0) {
    throw new Error("Nenhum revisor disponível (cadastre avaliadores ou professores).");
  }

  const { data, error } = await supabase
    .from("trabalho_revisores")
    .select("trabalho_id, revisor_email");
  if (error) throw error;
  const existentes = data ?? [];

  // Carga atual por revisor (e-mail).
  const carga = new Map<string, number>();
  revisores.forEach((r) => carga.set(r.email, 0));
  existentes.forEach((e) => carga.set(e.revisor_email, (carga.get(e.revisor_email) ?? 0) + 1));

  // Nº de revisores já associados por trabalho.
  const countTrab = new Map<string, number>();
  existentes.forEach((e) => countTrab.set(e.trabalho_id, (countTrab.get(e.trabalho_id) ?? 0) + 1));

  const jaAtribuido = new Set(existentes.map((e) => `${e.revisor_email}:${e.trabalho_id}`));

  // Só os trabalhos que ainda não têm nenhum revisor.
  const pendentes = trabalhoIds.filter((id) => (countTrab.get(id) ?? 0) === 0);

  let criados = 0;
  for (const tid of pendentes) {
    const candidato = [...revisores]
      .filter(
        (r) =>
          (carga.get(r.email) ?? 0) < LIMITE_TRABALHOS_POR_AVALIADOR &&
          !jaAtribuido.has(`${r.email}:${tid}`),
      )
      .sort((a, b) => (carga.get(a.email) ?? 0) - (carga.get(b.email) ?? 0))[0];

    if (!candidato) continue;

    const { error: insErr } = await supabase.from("trabalho_revisores").insert({
      trabalho_id: tid,
      revisor_email: candidato.email,
      revisor_nome: candidato.nome,
      tipo: candidato.tipo,
    });

    if (!insErr) {
      carga.set(candidato.email, (carga.get(candidato.email) ?? 0) + 1);
      jaAtribuido.add(`${candidato.email}:${tid}`);
      criados++;
    }
  }

  return criados;
}
