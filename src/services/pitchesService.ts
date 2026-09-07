import { supabase } from "@/integrations/supabase/client";

/**
 * Pitches — a vitrine de vídeos de apresentação do congresso.
 *
 * Migration 20260907120000. A lista pública tem DUAS fontes, e só uma
 * delas é uma tabela:
 *
 *   'trabalho'   os vídeos que os trabalhos APROVADOS desta edição já
 *                entregaram em `trabalho_anexos`. Derivado, nunca
 *                copiado: uma tabela espelhando esses vídeos seria uma
 *                segunda fonte da mesma verdade, e as duas discordariam
 *                no dia em que um autor trocasse o link.
 *   'historico'  os vídeos de edições anteriores, cadastrados à mão em
 *                /co-chairs/pitches — daquela época o sistema não tem
 *                submissão nenhuma.
 *
 * "Só entra quem exigiu vídeo" não é regra escrita em lugar nenhum: uma
 * categoria que não pede vídeo não gera linha `tipo = 'video'` em
 * `trabalho_anexos`, então nada dela aparece. A pergunta já foi
 * respondida no ato da submissão.
 *
 * ⚠ `pitches_publicos()` é a ÚNICA fresta pública sobre `trabalhos`:
 * publica título, autores e link de vídeo de trabalho aprovado para
 * qualquer um, sem sessão. Só `status = 'aprovado'` — 'aprovado_correcoes'
 * ainda espera ação do autor. Quem garante isso é a RPC, e a própria
 * migration quebra se o recorte alargar; o cliente não filtra nada.
 */

/** De onde o pitch veio. É coluna da RPC, não inferência do cliente. */
export type OrigemPitch = "trabalho" | "historico";

/**
 * Um pitch na vitrine.
 *
 * `autores`/`categoria` só vêm preenchidos na origem 'trabalho';
 * `descricao`/`edicao`, só na 'historico'. As duas metades convivem no
 * mesmo tipo porque é UMA lista paginada — separá-las obrigaria a
 * paginar duas fontes em paralelo, que é reinventar o `ORDER BY` da RPC
 * em JavaScript. O cartão mostra as linhas que não estão vazias.
 */
export type Pitch = {
  id: string;
  origem: OrigemPitch;
  titulo: string;
  descricao: string;
  autores: string;
  categoria: string;
  edicao: string;
  video_url: string;
};

/**
 * A vitrine inteira, na ordem que a RPC define (aprovados desta edição,
 * depois o histórico). Falha devolve lista vazia: é conteúdo da vitrine,
 * e uma consulta que não respondeu não pode derrubar a página — a seção
 * simplesmente não aparece.
 *
 * Vem TUDO numa requisição, de propósito: a paginação é do cliente, e é
 * o que faz a troca de página não ir à rede nem correr o risco de a
 * ordem mudar no meio da navegação. Ver `src/lib/pitches.ts`.
 */
export async function carregarPitchesPublicos(): Promise<Pitch[]> {
  const { data, error } = await supabase.rpc("pitches_publicos");
  if (error || !data) return [];
  return data as Pitch[];
}

/* ------------------------------------------------------------------
 * O acervo histórico — a metade editável
 * ----------------------------------------------------------------- */

/** Um vídeo de edição anterior, do ponto de vista de quem edita. */
export type PitchHistorico = {
  id: string;
  titulo: string;
  descricao: string;
  edicao: string;
  video_url: string;
  ordem: number;
};

export type NovoPitchHistorico = Omit<PitchHistorico, "id">;

const COLUNAS = "id, titulo, descricao, edicao, video_url, ordem";

/**
 * O acervo histórico pela TABELA, para /co-chairs/pitches. Só ele é
 * editável — os pitches de origem 'trabalho' não têm linha aqui e não
 * aparecem nesta lista.
 *
 * Erro PROPAGA: quem edita tem de saber que a lista na tela não é a do
 * banco.
 */
export async function listarPitchesHistoricos(): Promise<PitchHistorico[]> {
  const { data, error } = await supabase
    .from("pitches_historico")
    .select(COLUNAS)
    .order("ordem")
    .order("criado_em");
  if (error) throw new Error(error.message);
  return (data ?? []) as PitchHistorico[];
}

/**
 * Publica um vídeo do acervo. `criado_por` vem do `DEFAULT auth.uid()`
 * da coluna. O CHECK da coluna recusa link que não seja do YouTube — a
 * conferência da tela é cortesia.
 */
export async function criarPitchHistorico(
  entrada: NovoPitchHistorico,
): Promise<PitchHistorico> {
  const { data, error } = await supabase
    .from("pitches_historico")
    .insert({
      titulo: entrada.titulo.trim(),
      descricao: entrada.descricao.trim(),
      edicao: entrada.edicao.trim(),
      video_url: entrada.video_url.trim(),
      ordem: entrada.ordem,
    })
    .select(COLUNAS)
    .single();
  if (error) throw new Error(error.message);
  return data as PitchHistorico;
}

/** Corrige um vídeo do acervo. */
export async function atualizarPitchHistorico(
  id: string,
  campos: Partial<NovoPitchHistorico>,
): Promise<void> {
  const { error } = await supabase.from("pitches_historico").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Tira o vídeo da vitrine. Existir é estar no ar. */
export async function removerPitchHistorico(id: string): Promise<void> {
  const { error } = await supabase.from("pitches_historico").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
