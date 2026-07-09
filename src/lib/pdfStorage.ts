import { supabase } from "@/integrations/supabase/client";

// Bucket privado onde os PDFs dos trabalhos são armazenados. O acesso é
// feito exclusivamente por URLs assinadas com expiração (o bucket não é
// mais público — SEC-05).
export const PDF_BUCKET = import.meta.env.VITE_SUPABASE_PDF_BUCKET || "Pdfs";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h

/**
 * Resolve o valor salvo em trabalhos.pdf_url para uma URL temporária
 * assinada. Aceita tanto o formato novo (caminho do objeto dentro do
 * bucket, ex.: "<user_id>/arquivo.pdf") quanto URLs públicas legadas
 * geradas antes do bucket ficar privado.
 *
 * Retorna null quando o usuário logado não tem permissão de leitura
 * sobre o objeto (política RLS do Storage).
 */
export async function resolvePdfUrl(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;

  let bucket = PDF_BUCKET;
  let path = stored;

  if (/^https?:\/\//i.test(stored)) {
    const match = stored.match(/\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
    if (!match) return stored; // URL externa ao Storage — usa como está
    bucket = match[1];
    path = decodeURIComponent(match[2]);
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Abre o PDF do trabalho em nova aba usando uma URL assinada. */
export async function openPdf(stored: string | null | undefined): Promise<boolean> {
  const url = await resolvePdfUrl(stored);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
