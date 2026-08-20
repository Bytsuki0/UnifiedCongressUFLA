import { supabase } from "@/integrations/supabase/client";
import { PDF_BUCKET } from "@/lib/pdfStorage";
import type { TipoResumo } from "@/lib/submissao";
import type {
  Categoria,
  Criterio,
  Parecer,
  ParecerItem,
  Trabalho,
  TrabalhoRevisor,
} from "@/lib/types";

/**
 * Parecer editorial: a decisão final do trabalho, tomada por um co-chair.
 *
 * Até 20260820140000 essa decisão era automática — a moda dos 3 pareceres
 * virava `trabalhos.status` no instante em que o terceiro revisor
 * clicava em enviar. Agora os 3 pareceres apenas ENCERRAM a revisão
 * (status `aguardando_parecer_editorial`) e uma pessoa decide, com
 * justificativa, em /co-chairs/parecer-editorial.
 */

/** As quatro decisões que um co-chair pode registrar. */
export type DecisaoEditorial =
  | "aprovado"
  | "aprovado_correcoes"
  | "reprovado"
  | "resubmeter";

export const DECISAO_OPTIONS: { value: DecisaoEditorial; label: string; ajuda: string }[] = [
  {
    value: "aprovado",
    label: "Aprovado",
    ajuda: "O trabalho é aceito como está. Nada mais é pedido ao autor.",
  },
  {
    value: "aprovado_correcoes",
    label: "Aprovado com correções",
    ajuda:
      "O autor reenvia o PDF com ajustes (título, palavras-chave, vídeo e arquivo) e o trabalho passa a aprovado. Não volta para revisão.",
  },
  {
    value: "resubmeter",
    label: "Reenviar para nova avaliação",
    ajuda:
      "O autor reedita o trabalho INTEIRO uma única vez — inclusive autoria e categoria — e ele volta ao começo: 3 revisores novos, atribuídos de novo em Atribuições.",
  },
  {
    value: "reprovado",
    label: "Não aprovado",
    ajuda: "O trabalho é recusado. O autor lê a justificativa e os pareceres.",
  },
];

export const DECISAO_LABEL = Object.fromEntries(
  DECISAO_OPTIONS.map((o) => [o.value, o.label]),
) as Record<DecisaoEditorial, string>;

export const DECISAO_BADGE: Record<DecisaoEditorial, string> = {
  aprovado: "badge badge-green",
  aprovado_correcoes: "badge badge-amber",
  resubmeter: "badge badge-orange",
  reprovado: "badge badge-red",
};

/** Quantos pareceres um trabalho precisa antes de ir para a mesa do co-chair. */
export const PARECERES_PARA_DECIDIR = 3;

/** Uma decisão registrada, como a organização a vê (com quem assinou). */
export type DecisaoRegistrada = {
  id: string;
  trabalho_id: string;
  rodada: number;
  decisao: DecisaoEditorial;
  comentario: string;
  decidido_por: string | null;
  decidido_nome: string | null;
  created_at: string;
};

/** Uma decisão como o AUTOR a lê: sem quem assinou. */
export type DecisaoDoAutor = {
  rodada: number;
  decisao: DecisaoEditorial;
  comentario: string;
  created_at: string;
};

/** Uma linha da lista de Parecer Editorial. */
export type LinhaParecerEditorial = {
  trabalho: Trabalho;
  categoriaNome: string;
  /** Pareceres da rodada CORRENTE. Abaixo de 3, a linha fica cinza. */
  pareceres: number;
  /** Decisão vigente da rodada corrente, quando já houver. */
  decisao: DecisaoRegistrada | null;
  /** Pronto para análise: os 3 pareceres entraram. */
  pronto: boolean;
};

/**
 * A lista da tela: todos os trabalhos, com quantos pareceres já têm na
 * rodada corrente e a decisão vigente, se houver.
 *
 * Tudo por `select` normal — a policy `pareceres select` já libera
 * `is_event_staff()`, e `decisoes_editoriais` tem policy própria de
 * leitura para a organização. Nenhuma RPC precisa existir só para ler.
 */
export async function carregarPainelParecerEditorial(): Promise<LinhaParecerEditorial[]> {
  const [tr, pa, de, ca] = await Promise.all([
    supabase.from("trabalhos").select("*").order("titulo"),
    supabase.from("pareceres").select("trabalho_id, revisor_email, rodada"),
    supabase
      .from("decisoes_editoriais")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("categorias").select("id, nome"),
  ]);
  if (tr.error || pa.error || de.error || ca.error) {
    throw tr.error ?? pa.error ?? de.error ?? ca.error;
  }

  const nomeCategoria = new Map((ca.data ?? []).map((c) => [c.id, c.nome]));

  // Contagem por (trabalho, rodada) — depois recortada pela rodada
  // corrente de cada trabalho. Um revisor conta uma vez só.
  const contagem = new Map<string, Set<string>>();
  (pa.data ?? []).forEach((p) => {
    const chave = `${p.trabalho_id}:${p.rodada}`;
    const s = contagem.get(chave) ?? new Set<string>();
    s.add(p.revisor_email.toLowerCase());
    contagem.set(chave, s);
  });

  // `de` vem ordenado do mais recente para o mais antigo, então o
  // primeiro de cada (trabalho, rodada) é a decisão VIGENTE — as demais
  // são o histórico de quem reviu a própria decisão.
  const vigente = new Map<string, DecisaoRegistrada>();
  ((de.data ?? []) as DecisaoRegistrada[]).forEach((d) => {
    const chave = `${d.trabalho_id}:${d.rodada}`;
    if (!vigente.has(chave)) vigente.set(chave, d);
  });

  return (tr.data ?? []).map((trabalho) => {
    const chave = `${trabalho.id}:${trabalho.rodada}`;
    const pareceres = contagem.get(chave)?.size ?? 0;
    return {
      trabalho,
      categoriaNome: trabalho.categoria_id
        ? (nomeCategoria.get(trabalho.categoria_id) ?? "—")
        : "—",
      pareceres,
      decisao: vigente.get(chave) ?? null,
      pronto: pareceres >= PARECERES_PARA_DECIDIR,
    };
  });
}

/** Um parecer completo, COM a identificação do revisor. */
export type ParecerIdentificado = Parecer & { rodada: number };

export type AnaliseEditorial = {
  trabalho: Trabalho;
  categoria: Categoria | null;
  criterios: Criterio[];
  /** Pareceres da rodada corrente, identificados. */
  pareceres: ParecerIdentificado[];
  /** Pareceres das rodadas anteriores, quando o trabalho já foi reenviado. */
  anteriores: ParecerIdentificado[];
  /** Revisores designados na rodada corrente (inclusive os que ainda não deram parecer). */
  revisores: TrabalhoRevisor[];
  /** Moda dos pareceres — SUGESTÃO, não decisão. */
  sugestao: string | null;
  /** Decisão vigente da rodada corrente. */
  decisao: DecisaoRegistrada | null;
  /** Todas as decisões do trabalho, mais recente primeiro (histórico). */
  historico: DecisaoRegistrada[];
  /** O autor já cumpriu a decisão: ela não pode mais ser alterada. */
  travada: boolean;
};

/**
 * Tudo que a tela de análise precisa, numa ida só.
 *
 * Ao contrário do que o REVISOR recebe (`COLUNAS_VISIVEIS` em
 * revisorService, que omite autoria de propósito), aqui o trabalho vem
 * inteiro: autor, orientador, coautores, data. É a contrapartida
 * deliberada da avaliação às cegas — quem decide precisa ver tudo.
 */
export async function carregarAnaliseEditorial(
  trabalhoId: string,
): Promise<AnaliseEditorial | null> {
  const { data: trabalho, error } = await supabase
    .from("trabalhos")
    .select("*")
    .eq("id", trabalhoId)
    .maybeSingle();
  if (error) throw error;
  if (!trabalho) return null;

  const [pa, rv, de, cat, sug] = await Promise.all([
    supabase
      .from("pareceres")
      .select("*")
      .eq("trabalho_id", trabalhoId)
      .order("created_at", { ascending: true }),
    supabase
      .from("trabalho_revisores")
      .select("*")
      .eq("trabalho_id", trabalhoId)
      .eq("rodada", trabalho.rodada)
      .order("created_at", { ascending: true }),
    supabase
      .from("decisoes_editoriais")
      .select("*")
      .eq("trabalho_id", trabalhoId)
      .order("created_at", { ascending: false }),
    trabalho.categoria_id
      ? supabase.from("categorias").select("*").eq("id", trabalho.categoria_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("decisao_consolidada", { _trabalho_id: trabalhoId }),
  ]);
  if (pa.error || rv.error || de.error) throw pa.error ?? rv.error ?? de.error;

  const criterios = trabalho.categoria_id
    ? await supabase
        .from("criterios")
        .select("*")
        .eq("categoria_id", trabalho.categoria_id)
        .order("ordem", { ascending: true })
    : { data: [] as Criterio[], error: null };
  if (criterios.error) throw criterios.error;

  const todos = ((pa.data ?? []) as unknown as ParecerIdentificado[]).map((p) => ({
    ...p,
    itens: Array.isArray(p.itens) ? p.itens : ([] as ParecerItem[]),
  }));
  const historico = (de.data ?? []) as DecisaoRegistrada[];
  const daRodada = historico.filter((d) => d.rodada === trabalho.rodada);

  return {
    trabalho,
    categoria: (cat.data as Categoria) ?? null,
    criterios: (criterios.data ?? []) as Criterio[],
    pareceres: todos.filter((p) => p.rodada === trabalho.rodada),
    anteriores: todos.filter((p) => p.rodada < trabalho.rodada),
    revisores: (rv.data ?? []) as TrabalhoRevisor[],
    sugestao: (sug.data as string) ?? null,
    decisao: daRodada[0] ?? null,
    historico,
    // Mesma regra do servidor (`registrar_parecer_editorial`): rever a
    // decisão só vale enquanto o autor não agiu. Aqui é cortesia — quem
    // recusa é a RPC.
    travada:
      (trabalho.status === "aprovado" && trabalho.correcoes_enviadas_em != null) ||
      (trabalho.status === "pendente" && trabalho.reenviado_em != null),
  };
}

/**
 * Registra a decisão do co-chair.
 *
 * Rever uma decisão já registrada INSERE outra linha — a vigente é a mais
 * recente, e as anteriores viram histórico. O servidor recusa quando o
 * autor já cumpriu a decisão.
 */
export async function registrarParecerEditorial(input: {
  trabalhoId: string;
  decisao: DecisaoEditorial;
  comentario: string;
}): Promise<DecisaoEditorial> {
  const comentario = input.comentario.trim();
  // Barrado aqui e no banco: uma decisão editorial sem justificativa é
  // exatamente o que o botão cru do Portal Admin fazia.
  if (!comentario) {
    throw new Error("Escreva o comentário que justifica a decisão.");
  }

  const { data, error } = await supabase.rpc("registrar_parecer_editorial", {
    _trabalho_id: input.trabalhoId,
    _decisao: input.decisao,
    _comentario: comentario,
  });
  if (error) throw new Error(error.message);
  return data as DecisaoEditorial;
}

/** A decisão da rodada corrente como o AUTOR a lê — sem quem assinou. */
export async function carregarDecisaoEditorial(
  trabalhoId: string,
): Promise<DecisaoDoAutor | null> {
  const { data, error } = await supabase.rpc("parecer_editorial_do_meu_trabalho", {
    _trabalho_id: trabalhoId,
  });
  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as DecisaoDoAutor[];
  return linhas[0] ?? null;
}

export type ReenviarTrabalhoInput = {
  trabalhoId: string;
  ownerId: string;
  titulo: string;
  palavrasChave: string[];
  videoUrl: string;
  tipoResumo: TipoResumo;
  autores: string;
  orientadorEmail: string | null;
  coautores: { nome?: string; email?: string }[];
  categoriaId: string;
  /** Novo PDF. Quando ausente, o arquivo atual é mantido. */
  arquivo?: File | null;
};

/**
 * Reenvio do trabalho após a decisão "resubmeter".
 *
 * Mesma ordem de operações de `enviarCorrecao` — sobe o PDF novo, grava
 * pela RPC e só então apaga o antigo — porque a razão é a mesma: se a
 * gravação falhar, a tabela continua apontando para o arquivo velho e o
 * que sobra é um upload órfão, melhor do que um trabalho sem PDF.
 *
 * A diferença para `enviarCorrecao` é o que vai no corpo: aqui seguem
 * também AUTORIA e CATEGORIA. É a única escrita do autor que as abre, e
 * é segura porque a distribuição da rodada nova acontece depois, sobre os
 * conflitos novos.
 */
export async function reenviarTrabalho(input: ReenviarTrabalhoInput): Promise<void> {
  let caminhoNovo: string | null = null;

  if (input.arquivo) {
    const nomeSeguro = input.arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    caminhoNovo = `${input.ownerId}/${Date.now()}-${nomeSeguro}`;
    const { error: uploadError } = await supabase.storage
      .from(PDF_BUCKET)
      .upload(caminhoNovo, input.arquivo, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) throw new Error("Não foi possível enviar o novo PDF.");
  }

  const { data, error } = await supabase.rpc("reenviar_trabalho", {
    _trabalho_id: input.trabalhoId,
    _titulo: input.titulo,
    _palavras_chave: input.palavrasChave,
    _video_url: input.videoUrl,
    _tipo_resumo: input.tipoResumo,
    _autores: input.autores,
    _orientador_email: input.orientadorEmail,
    _coautores: input.coautores,
    _categoria_id: input.categoriaId,
    _pdf_url: caminhoNovo,
  });
  if (error) throw new Error(error.message ?? "Não foi possível reenviar o trabalho.");

  const caminhoAntigo = typeof data === "string" ? data : null;
  if (caminhoAntigo && !/^https?:\/\//i.test(caminhoAntigo)) {
    await supabase.storage.from(PDF_BUCKET).remove([caminhoAntigo]);
  }
}
