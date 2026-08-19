import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  Criterio,
  LIMITE_TRABALHOS_POR_AVALIADOR,
  MAX_REVISORES_POR_TRABALHO,
  Parecer,
  ParecerItem,
  ResultadoParecer,
  Trabalho,
  TrabalhoRevisor,
} from "@/lib/types";

/**
 * Pool unificado de revisores, único por e-mail.
 *
 * A fonte de verdade é `user_roles` (é o que a tela de Papéis edita):
 * toda conta com papel `avaliador` ou `professor` entra no pool, mais
 * os co-chairs que a organização cadastrou e que ainda não têm conta.
 * A RPC resolve isso no servidor porque o pool cruza `profiles` com
 * `user_roles` e `auth.users`.
 */
export async function carregarPoolRevisores(): Promise<RevisorOption[]> {
  const { data, error } = await supabase.rpc("pool_revisores");
  if (error) throw error;
  return ((data ?? []) as RevisorOption[]).slice().sort((a, b) => a.nome.localeCompare(b.nome));
}

// Um revisor associável: avaliador OU professor, tratados igualmente.
export type RevisorOption = {
  email: string;
  nome: string;
  tipo: "avaliador" | "professor";
};

/** Motivo pelo qual um e-mail não pode revisar um trabalho. */
export type MotivoConflito = "autor" | "orientador" | "coautor";

export type Conflito = {
  trabalho_id: string;
  email: string;
  motivo: MotivoConflito;
};

/**
 * Conflitos de interesse de todos os trabalhos: autor que submeteu,
 * orientador informado e coautores. Quem consta aqui não pode ser
 * associado como revisor — a regra também é aplicada por trigger no
 * banco, esta consulta só permite refletir isso na interface.
 */
export async function carregarConflitos(): Promise<Conflito[]> {
  const { data, error } = await supabase.rpc("conflitos_por_trabalho");
  if (error) throw error;
  return (data ?? []) as Conflito[];
}

/** Índice trabalho_id -> (e-mail em minúsculas -> motivo). */
export function indexarConflitos(conflitos: Conflito[]): Map<string, Map<string, MotivoConflito>> {
  const m = new Map<string, Map<string, MotivoConflito>>();
  conflitos.forEach((c) => {
    const porEmail = m.get(c.trabalho_id) ?? new Map<string, MotivoConflito>();
    porEmail.set(c.email.toLowerCase(), c.motivo);
    m.set(c.trabalho_id, porEmail);
  });
  return m;
}

/**
 * Serviço da análise de trabalhos pelo revisor.
 * Lida com a associação revisor<->trabalho (tabela trabalho_revisores) e
 * com os pareceres estruturados (nota/comentário por critério).
 */

/**
 * Trabalho como o REVISOR o enxerga — avaliação às cegas.
 *
 * A lista de campos é deliberadamente curta: `autores`, `coautores`,
 * `orientador_email`, `data_submissao` e `resumo` ficam de fora porque
 * identificam (ou ajudam a identificar) quem submeteu. Eles continuam
 * na tabela e continuam visíveis para a organização e para os
 * co-chairs, que decidem a partir deles — só não descem para a tela de
 * quem dá o parecer.
 *
 * Este tipo é a metade do cuidado; a outra é `COLUNAS_VISIVEIS` abaixo.
 * Esconder no JSX não bastaria: a linha inteira chegaria ao navegador do
 * revisor e bastaria abrir o DevTools para ler o nome do autor.
 */
export type TrabalhoAssociado = {
  id: string;
  titulo: string;
  categoria_id: string | null;
  status: string;
  pdf_url: string | null;
  video_url: string | null;
  palavras_chave: string[] | null;
  tipo_resumo: string | null;
};

/**
 * As colunas de `trabalhos` que o PostgREST tem permissão de embarcar na
 * resposta. Precisa espelhar `TrabalhoAssociado` — acrescentar um campo
 * aqui sem pensar reabre o buraco da avaliação às cegas.
 */
const COLUNAS_VISIVEIS =
  "id, titulo, categoria_id, status, pdf_url, video_url, palavras_chave, tipo_resumo";

export type AssociacaoComTrabalho = TrabalhoRevisor & {
  trabalho: TrabalhoAssociado | null;
};

/** Lista os trabalhos associados a um revisor (por e-mail), com os dados do trabalho. */
export async function listarTrabalhosAssociados(
  email: string,
): Promise<AssociacaoComTrabalho[]> {
  const { data, error } = await supabase
    .from("trabalho_revisores")
    .select(`*, trabalho:trabalhos(${COLUNAS_VISIVEIS})`)
    .eq("revisor_email", email)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AssociacaoComTrabalho[];
}

/** Uma associação específica (por id), com os dados do trabalho embarcados. */
export async function obterAssociacao(
  id: string,
): Promise<AssociacaoComTrabalho | null> {
  const { data, error } = await supabase
    .from("trabalho_revisores")
    .select(`*, trabalho:trabalhos(${COLUNAS_VISIVEIS})`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as AssociacaoComTrabalho) ?? null;
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
    // 23514: trigger de conflito de interesse — a mensagem do banco já
    // diz quem é a pessoa e em que qualidade ela consta no trabalho.
    if (error.code === "23514") {
      throw new Error(error.message);
    }
    throw error;
  }
}

export async function removerRevisor(id: string): Promise<void> {
  const { error } = await supabase.from("trabalho_revisores").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Distribuição automática unificada: para cada trabalho, tenta preencher até
 * MAX_REVISORES_POR_TRABALHO (3) revisores (avaliador OU professor, tratados
 * igualmente), sempre escolhendo o revisor de menor carga e respeitando o
 * limite por revisor. Trabalhos que já têm revisores são complementados até 3.
 * Só associa menos de 3 quando não há revisores disponíveis o bastante.
 * Retorna o número de associações criadas.
 */
export async function distribuirRevisoresAutomaticamente(
  revisores: RevisorOption[],
  trabalhoIds: string[],
): Promise<number> {
  if (revisores.length === 0) {
    throw new Error("Nenhum revisor disponível (conceda o papel de professor ou avaliador a alguma conta).");
  }

  const [{ data, error }, conflitos] = await Promise.all([
    supabase.from("trabalho_revisores").select("trabalho_id, revisor_email"),
    carregarConflitos(),
  ]);
  if (error) throw error;
  const existentes = data ?? [];
  const conflitoPorTrabalho = indexarConflitos(conflitos);

  // Carga atual por revisor (e-mail).
  const carga = new Map<string, number>();
  revisores.forEach((r) => carga.set(r.email, 0));
  existentes.forEach((e) => carga.set(e.revisor_email, (carga.get(e.revisor_email) ?? 0) + 1));

  // Nº de revisores já associados por trabalho.
  const countTrab = new Map<string, number>();
  existentes.forEach((e) => countTrab.set(e.trabalho_id, (countTrab.get(e.trabalho_id) ?? 0) + 1));

  const jaAtribuido = new Set(existentes.map((e) => `${e.revisor_email}:${e.trabalho_id}`));

  let criados = 0;
  for (const tid of trabalhoIds) {
    let atuais = countTrab.get(tid) ?? 0;
    const emConflito = conflitoPorTrabalho.get(tid);

    // Tenta preencher o trabalho até o máximo de revisores.
    while (atuais < MAX_REVISORES_POR_TRABALHO) {
      const candidato = [...revisores]
        .filter(
          (r) =>
            (carga.get(r.email) ?? 0) < LIMITE_TRABALHOS_POR_AVALIADOR &&
            !jaAtribuido.has(`${r.email}:${tid}`) &&
            // Autor, orientador ou coautor não revisa o próprio trabalho.
            !emConflito?.has(r.email.toLowerCase()),
        )
        .sort((a, b) => (carga.get(a.email) ?? 0) - (carga.get(b.email) ?? 0))[0];

      // Sem revisor possível para este trabalho — segue para o próximo.
      if (!candidato) break;

      const { error: insErr } = await supabase.from("trabalho_revisores").insert({
        trabalho_id: tid,
        revisor_email: candidato.email,
        revisor_nome: candidato.nome,
        tipo: candidato.tipo,
      });

      // Falha (ex.: trigger de limite) — para este trabalho e segue adiante.
      if (insErr) break;

      carga.set(candidato.email, (carga.get(candidato.email) ?? 0) + 1);
      jaAtribuido.add(`${candidato.email}:${tid}`);
      atuais++;
      criados++;
    }
  }

  return criados;
}

/**
 * Parecer reduzido ao que a tela de Atribuições precisa exibir.
 * `resultado` é NOT NULL no banco — um parecer sempre nasce com veredito.
 */
export type ParecerLite = {
  trabalho_id: string;
  revisor_email: string;
  resultado: ResultadoParecer;
};

/**
 * Carga completa da tela de Atribuições: pool, trabalhos, associações,
 * pareceres e conflitos numa só ida.
 *
 * Vão todas em paralelo porque a tela só renderiza com o conjunto
 * completo — encadeá-las só somaria latência.
 */
export async function carregarPainelAtribuicoes(): Promise<{
  pool: RevisorOption[];
  trabalhos: Trabalho[];
  revisores: TrabalhoRevisor[];
  pareceres: ParecerLite[];
  conflitos: Conflito[];
}> {
  const [pool, tr, rv, pa, conflitos] = await Promise.all([
    carregarPoolRevisores(),
    supabase.from("trabalhos").select("*").order("titulo"),
    supabase.from("trabalho_revisores").select("*").order("created_at"),
    supabase.from("pareceres").select("trabalho_id, revisor_email, resultado"),
    carregarConflitos(),
  ]);
  if (tr.error || rv.error || pa.error) throw tr.error ?? rv.error ?? pa.error;
  return {
    pool,
    trabalhos: tr.data ?? [],
    revisores: (rv.data ?? []) as TrabalhoRevisor[],
    pareceres: (pa.data ?? []) as ParecerLite[],
    conflitos,
  };
}

/** Linha do painel de conflitos do Admin. */
export type LinhaConflito = {
  trabalhoId: string;
  titulo: string;
  email: string;
  motivo: MotivoConflito;
  /** Preenchido só quando a pessoa impedida ESTÁ associada como revisora. */
  associacaoId?: string;
};

/**
 * Painel de conflitos: separa o que é apenas um bloqueio previsto do que
 * é uma violação já materializada.
 *
 * A regra é aplicada por trigger no banco (`trg_conflito_revisor`), então
 * uma associação em violação só existe se o trabalho foi editado DEPOIS
 * de o revisor ter sido associado — por isso essas linhas ganham ação de
 * desfazer e as outras não.
 */
export async function carregarPainelConflitos(): Promise<{
  violacoes: LinhaConflito[];
  bloqueios: LinhaConflito[];
}> {
  const [conflitos, trabalhos, assocs] = await Promise.all([
    carregarConflitos(),
    supabase.from("trabalhos").select("id, titulo"),
    supabase.from("trabalho_revisores").select("id, trabalho_id, revisor_email"),
  ]);
  if (trabalhos.error || assocs.error) throw trabalhos.error ?? assocs.error;

  const titulos = new Map((trabalhos.data ?? []).map((t) => [t.id, t.titulo]));
  const porTrabalho = indexarConflitos(conflitos);

  const violacoes: LinhaConflito[] = [];
  for (const a of assocs.data ?? []) {
    const motivo = porTrabalho.get(a.trabalho_id)?.get(a.revisor_email.toLowerCase());
    if (motivo) {
      violacoes.push({
        trabalhoId: a.trabalho_id,
        titulo: titulos.get(a.trabalho_id) ?? "Trabalho removido",
        email: a.revisor_email,
        motivo,
        associacaoId: a.id,
      });
    }
  }

  const bloqueios: LinhaConflito[] = conflitos
    .filter((c) => titulos.has(c.trabalho_id))
    .map((c) => ({
      trabalhoId: c.trabalho_id,
      titulo: titulos.get(c.trabalho_id) as string,
      email: c.email,
      motivo: c.motivo,
    }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo) || a.email.localeCompare(b.email));

  return { violacoes, bloqueios };
}

/**
 * Desfaz uma associação em conflito, apagando antes o parecer que ela
 * porventura gerou: um parecer emitido por quem nunca poderia avaliar o
 * trabalho não pode seguir contando nas Atribuições nem nos Rankings.
 */
export async function desfazerAssociacaoEmConflito(linha: LinhaConflito): Promise<void> {
  const { error } = await supabase
    .from("pareceres")
    .delete()
    .eq("trabalho_id", linha.trabalhoId)
    .ilike("revisor_email", linha.email);
  if (error) throw error;
  await removerRevisor(linha.associacaoId as string);
}

/**
 * Resultado dos pareceres já emitidos por um revisor, indexado por
 * trabalho — usado para marcar "já avaliado" na lista de análise.
 */
export async function listarResultadosDoRevisor(
  email: string,
): Promise<Record<string, ResultadoParecer>> {
  const { data, error } = await supabase
    .from("pareceres")
    .select("trabalho_id, resultado")
    .eq("revisor_email", email);
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map((p) => [p.trabalho_id, p.resultado as ResultadoParecer]),
  );
}
