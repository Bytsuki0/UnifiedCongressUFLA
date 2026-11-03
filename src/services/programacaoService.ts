import { supabase } from "@/integrations/supabase/client";

/**
 * Programação do evento (migration 20261103160000).
 *
 * Um arquivo só — PNG, JPEG ou PDF — no bucket `programacao`. Sem tabela:
 * o arquivo em vigor é o objeto MAIS RECENTE do bucket. Enviar sobe um
 * nome novo (`<epoch ms>.<ext>`) e só DEPOIS apaga os antigos, então um
 * envio que falha nunca deixa a programação fora do ar.
 *
 * Mesma dupla de políticas de erro de `carregarArquivosDownload` /
 * `listarArquivosDownload`: a leitura pública (`carregarProgramacao`)
 * falha VAZIA — a seção some —, a da tela de gestão (`buscarProgramacao`)
 * PROPAGA.
 */

const BUCKET = "programacao";
const URL_ASSINADA_SEGUNDOS = 60 * 60;

/** Tipos que o bucket aceita (`allowed_mime_types`), com a extensão gravada. */
export const TIPOS_PROGRAMACAO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

/** O `file_size_limit` do bucket. */
export const MAX_PROGRAMACAO_BYTES = 10 * 1024 * 1024;

export type Programacao = { url: string; pdf: boolean };

/** Os nomes dos arquivos do bucket, do mais recente para o mais antigo. */
async function listarNomes(): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) throw new Error(error.message);
  // Pasta vem com `id` nulo — não é arquivo.
  return (data ?? []).filter((o) => o.id).map((o) => o.name);
}

/** A programação em vigor, ou `null` se não há. Erro PROPAGA (tela de gestão). */
export async function buscarProgramacao(): Promise<Programacao | null> {
  const [nome] = await listarNomes();
  if (!nome) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(nome, URL_ASSINADA_SEGUNDOS);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Falha ao assinar a URL.");
  return { url: data.signedUrl, pdf: nome.endsWith(".pdf") };
}

/** A mesma, para quem só EXIBE: falha devolve `null` e a seção some. */
export async function carregarProgramacao(): Promise<Programacao | null> {
  try {
    return await buscarProgramacao();
  } catch {
    return null;
  }
}

/** Apaga todos os arquivos do bucket, menos `manter`. */
export async function removerProgramacao(manter = ""): Promise<void> {
  const nomes = (await listarNomes()).filter((n) => n !== manter);
  if (nomes.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(nomes);
  if (error) throw new Error(error.message);
}

/** Sobe a programação nova e descarta as anteriores. */
export async function enviarProgramacao(arquivo: File): Promise<void> {
  const ext = TIPOS_PROGRAMACAO[arquivo.type];
  if (!ext) throw new Error("Envie um arquivo PNG, JPEG ou PDF.");
  const nome = `${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(nome, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error("Não foi possível enviar a programação.");

  // Best-effort: o novo já é o mais recente, então já está no ar. Falhar
  // aqui só deixa um arquivo antigo esquecido no bucket.
  await removerProgramacao(nome).catch(() => {});
}
