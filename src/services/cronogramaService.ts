import { supabase } from "@/integrations/supabase/client";

/**
 * Cronograma do congresso — o calendário que a organização publica.
 *
 * Migration 20260829120000. Duas leituras bem diferentes convivem aqui:
 *
 *   · `carregarCronogramaPublico()` — usada pela landing (SEM sessão),
 *     por /cronograma e por /estudante/cronograma. Vai pelas RPCs
 *     `cronograma_publico_*`, que o `anon` pode executar; as tabelas
 *     continuam fechadas para quem não tem sessão.
 *   · `carregarCronogramaGestao()` — usada só por /co-chairs/cronograma.
 *     Lê as TABELAS, porque a tela de edição precisa dos ids e precisa
 *     enxergar marcação em mês que ainda não foi publicado (a RPC
 *     pública filtra essas fora de propósito).
 *
 * ⚠ Datas trafegam como 'AAAA-MM-DD' e ficam assim o tempo todo. Nunca
 * passar isso por `new Date(...)`: a string sem hora é lida como UTC e,
 * no fuso de Lavras, "2026-08-01" vira 31/07 na tela. Os helpers de
 * `src/lib/cronograma.ts` trabalham na própria string.
 */

/** Um mês publicado. */
export type MesCronograma = { ano: number; mes: number };

/** Uma marcação: cor, nome e descrição compartilhados pelos dias dela. */
export type MarcacaoCronograma = {
  id: string;
  titulo: string;
  descricao: string;
  cor: string;
  /** Dias em 'AAAA-MM-DD', em ordem. */
  dias: string[];
};

export type Cronograma = {
  meses: MesCronograma[];
  marcacoes: MarcacaoCronograma[];
};

/** Cronograma vazio — o estado de quem ainda não publicou nada. */
export const CRONOGRAMA_VAZIO: Cronograma = { meses: [], marcacoes: [] };

/**
 * O calendário como o visitante o vê.
 *
 * Falha devolve vazio, e não um erro na tela: o cronograma é conteúdo
 * informativo da landing. Uma consulta que não respondeu não pode
 * derrubar a página inicial inteira — a seção simplesmente não aparece.
 * (Mesma escolha de `carregarLinksDownloads`, e o oposto do prazo de
 * submissão, que falha ABERTO porque lá o "não sei" seguro é deixar
 * passar.)
 */
export async function carregarCronogramaPublico(): Promise<Cronograma> {
  const [meses, dias] = await Promise.all([
    supabase.rpc("cronograma_publico_meses"),
    supabase.rpc("cronograma_publico_dias"),
  ]);

  if (meses.error || dias.error) return CRONOGRAMA_VAZIO;

  // A RPC devolve uma linha por (dia, marcação); a tela quer uma
  // marcação com seus dias. O agrupamento é aqui porque a alternativa
  // seria um array_agg no SQL, que o gerador de tipos entrega como Json.
  const porEvento = new Map<string, MarcacaoCronograma>();
  for (const linha of dias.data ?? []) {
    const existente = porEvento.get(linha.evento_id);
    if (existente) {
      existente.dias.push(linha.dia);
    } else {
      porEvento.set(linha.evento_id, {
        id: linha.evento_id,
        titulo: linha.titulo,
        descricao: linha.descricao,
        cor: linha.cor,
        dias: [linha.dia],
      });
    }
  }

  return {
    meses: meses.data ?? [],
    marcacoes: [...porEvento.values()],
  };
}

/**
 * O mesmo calendário, pelas tabelas, para a tela de gestão. Aqui um
 * erro PRECISA aparecer: quem está editando tem de saber que a lista na
 * tela não é a lista do banco, senão salva por cima do que não viu.
 */
export async function carregarCronogramaGestao(): Promise<Cronograma> {
  const [meses, eventos, dias] = await Promise.all([
    supabase.from("cronograma_meses").select("ano, mes").order("ano").order("mes"),
    supabase.from("cronograma_eventos").select("id, titulo, descricao, cor").order("criado_em"),
    supabase.from("cronograma_dias").select("evento_id, dia").order("dia"),
  ]);

  if (meses.error || eventos.error || dias.error) {
    throw meses.error ?? eventos.error ?? dias.error;
  }

  const porEvento: Record<string, string[]> = {};
  for (const d of dias.data ?? []) (porEvento[d.evento_id] ??= []).push(d.dia);

  return {
    meses: meses.data ?? [],
    marcacoes: (eventos.data ?? []).map((e) => ({
      id: e.id,
      titulo: e.titulo,
      descricao: e.descricao,
      cor: e.cor,
      dias: porEvento[e.id] ?? [],
    })),
  };
}

/** Publica um mês. Repetido não é erro — a lista é um conjunto. */
export async function adicionarMes(ano: number, mes: number): Promise<void> {
  const { error } = await supabase
    .from("cronograma_meses")
    .upsert({ ano, mes }, { onConflict: "ano,mes", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/**
 * Tira um mês do ar. As marcações dele NÃO são apagadas: a RPC pública
 * já as esconde por não caírem em mês publicado, e republicar o mês
 * devolve tudo. Apagar aqui destruiria trabalho de configuração por
 * causa de um clique.
 */
export async function removerMes(ano: number, mes: number): Promise<void> {
  const { error } = await supabase
    .from("cronograma_meses")
    .delete()
    .eq("ano", ano)
    .eq("mes", mes);
  if (error) throw new Error(error.message);
}

/**
 * Cria (`id` nulo) ou reescreve uma marcação, numa transação só. `dias`
 * é o conjunto FINAL: o que não vier na lista deixa de pertencer à
 * marcação.
 */
export async function salvarMarcacao(marcacao: {
  id?: string | null;
  titulo: string;
  descricao: string;
  cor: string;
  dias: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("salvar_marcacao_cronograma", {
    p_id: marcacao.id ?? null,
    p_titulo: marcacao.titulo,
    p_descricao: marcacao.descricao,
    p_cor: marcacao.cor,
    p_dias: marcacao.dias,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Apaga a marcação. Os dias vão junto (ON DELETE CASCADE). */
export async function excluirMarcacao(id: string): Promise<void> {
  const { error } = await supabase.from("cronograma_eventos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
