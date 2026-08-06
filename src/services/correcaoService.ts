import { supabase } from "@/integrations/supabase/client";
import { PDF_BUCKET } from "@/lib/pdfStorage";
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
  resumo: string;
  /** Novo PDF. Quando ausente, o arquivo atual é mantido. */
  arquivo?: File | null;
};

/**
 * Envia a versão corrigida: sobe o PDF novo (se houver), grava
 * título/resumo/PDF pela RPC e só então apaga o arquivo antigo.
 *
 * A ordem importa: se a gravação falhar, o PDF antigo continua sendo o
 * que a tabela aponta. O que sobra no Storage é o upload novo, órfão —
 * preferível a um trabalho sem arquivo.
 *
 * Orientador, coautores e categoria não são enviados: a RPC não os
 * aceita e o trigger do banco os mantém imutáveis.
 */
export async function enviarCorrecao(input: EnviarCorrecaoInput): Promise<void> {
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

  const { data, error } = await supabase.rpc("enviar_correcao", {
    _trabalho_id: input.trabalhoId,
    _titulo: input.titulo,
    _resumo: input.resumo,
    _pdf_url: caminhoNovo,
  });
  if (error) throw new Error(error.message ?? "Não foi possível enviar a correção.");

  // A RPC devolve o caminho do arquivo substituído — o antigo pode sair
  // do Storage. Falha aqui não invalida o envio: o registro já está certo.
  const caminhoAntigo = typeof data === "string" ? data : null;
  if (caminhoAntigo && !/^https?:\/\//i.test(caminhoAntigo)) {
    await supabase.storage.from(PDF_BUCKET).remove([caminhoAntigo]);
  }
}
