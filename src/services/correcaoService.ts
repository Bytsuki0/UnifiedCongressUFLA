import { supabase } from "@/integrations/supabase/client";
import type { AnexoDaCategoria, RascunhoAnexos } from "@/lib/anexos";
import {
  caminhosDevolvidos,
  descartarDoStorage,
  prepararAnexos,
} from "@/services/anexosService";
import type { ParecerItem, ResultadoParecer } from "@/lib/types";

/**
 * Parecer como o AUTOR o enxerga: sem nome nem e-mail do revisor
 * (avaliação às cegas) e só depois de fechada a decisão do trabalho.
 */
export type ParecerAnonimo = {
  ordem: number;
  resultado: ResultadoParecer;
  comentario_geral: string | null;
  itens: ParecerItem[];
};

export async function carregarPareceresDoTrabalho(
  trabalhoId: string,
): Promise<ParecerAnonimo[]> {
  const { data, error } = await supabase.rpc("pareceres_do_meu_trabalho", {
    _trabalho_id: trabalhoId,
  });
  if (error) throw error;
  return ((data ?? []) as unknown as ParecerAnonimo[]).map((p) => ({
    ...p,
    itens: Array.isArray(p.itens) ? p.itens : [],
  }));
}

export type EnviarCorrecaoInput = {
  trabalhoId: string;
  ownerId: string;
  titulo: string;
  palavrasChave: string[];
  /** O que a categoria do trabalho exige. */
  exigencias: AnexoDaCategoria[];
  /** O que o autor preencheu. PDF sem arquivo novo = manter o atual. */
  anexos: RascunhoAnexos;
};

/**
 * Envia a versão corrigida: sobe os PDFs novos (se houver), grava os
 * campos editáveis e os anexos pela RPC e só então apaga os arquivos
 * substituídos.
 *
 * A ordem importa: se a gravação falhar, os PDFs antigos continuam sendo
 * o que a tabela aponta. O que sobra no Storage são os uploads novos, e
 * eles saem no `catch` — preferível a um trabalho sem arquivo.
 *
 * Orientador, coautores e categoria não são enviados: a RPC não os
 * aceita e o trigger do banco os mantém imutáveis. A categoria fica de
 * fora inclusive porque é ela que define QUAIS anexos são exigidos —
 * trocá-la aqui invalidaria a lista que o autor acabou de preencher.
 */
export async function enviarCorrecao(input: EnviarCorrecaoInput): Promise<void> {
  const { payload, enviados } = await prepararAnexos({
    exigencias: input.exigencias,
    rascunho: input.anexos,
    ownerId: input.ownerId,
  });

  const { data, error } = await supabase.rpc("enviar_correcao", {
    _trabalho_id: input.trabalhoId,
    _titulo: input.titulo,
    _palavras_chave: input.palavrasChave,
    _anexos: payload,
  });
  if (error) {
    await descartarDoStorage(enviados);
    throw new Error(error.message ?? "Não foi possível enviar a correção.");
  }

  // A RPC devolve os caminhos que deixaram de ser referenciados. Falha
  // aqui não invalida o envio: o registro já está certo.
  await descartarDoStorage(caminhosDevolvidos(data));
}
