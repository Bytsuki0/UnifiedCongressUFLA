import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Tipos e helpers compartilhados pelas páginas do Portal do Estudante.

export type Coautor = { nome?: string; email?: string };

export type Submission = {
  id: string;
  titulo: string;
  autores: string;
  categoria_id: string | null;
  status: string;
  data_submissao: string;
  created_at: string;
  orientador_email?: string | null;
  coautores?: Coautor[] | null;
  pdf_url?: string | null;
};

export type Categoria = { id: string; nome: string };

// Bucket de Storage onde os PDFs são enviados. É o mesmo bucket exposto
// pelo endpoint S3-compatível do projeto (VITE_SUPABASE_S3_ENDPOINT).
export const PDF_BUCKET = import.meta.env.VITE_SUPABASE_PDF_BUCKET || "Pdfs";
export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

export const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    pendente: "badge badge-amber",
    em_avaliacao: "badge badge-blue",
    aprovado: "badge badge-green",
    reprovado: "badge badge-red",
  };
  return map[s] ?? "badge badge-gray";
};

export const statusLabel: Record<string, string> = {
  pendente: "Recebido",
  em_avaliacao: "Em Avaliação",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
};

/** Carrega trabalhos + categorias do estudante (Supabase). */
export function useTrabalhos() {
  const [trabalhos, setTrabalhos] = useState<Submission[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from("trabalhos").select("*").order("created_at", { ascending: false }),
      supabase.from("categorias").select("*").order("nome"),
    ]);
    const rows: Submission[] = (t ?? []).map((r) => ({
      ...r,
      coautores: Array.isArray(r.coautores) ? (r.coautores as Coautor[]) : [],
    }));
    setTrabalhos(rows);
    setCategorias(c ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const catNome = (id: string | null) =>
    id ? (categorias.find((c) => c.id === id)?.nome ?? "—") : "—";

  return { trabalhos, categorias, loading, reload, catNome };
}
