import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Tipos e helpers compartilhados pelas páginas do Portal do Estudante.

export type Coautor = { nome?: string; email?: string };

export type Submission = {
  id: string;
  owner_id?: string | null;
  titulo: string;
  resumo?: string | null;
  autores: string;
  categoria_id: string | null;
  status: string;
  data_submissao: string;
  created_at: string;
  orientador_email?: string | null;
  coautores?: Coautor[] | null;
  pdf_url?: string | null;
  correcoes_enviadas_em?: string | null;
};

export type Categoria = { id: string; nome: string };

// O bucket de PDFs (privado) e o helper de URL assinada vivem em
// "@/lib/pdfStorage".
export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

export const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    pendente: "badge badge-amber",
    em_avaliacao: "badge badge-blue",
    aprovado_correcoes: "badge badge-amber",
    aprovado: "badge badge-green",
    reprovado: "badge badge-red",
  };
  return map[s] ?? "badge badge-gray";
};

export const statusLabel: Record<string, string> = {
  pendente: "Recebido",
  em_avaliacao: "Em Avaliação",
  aprovado_correcoes: "Aprovado c/ correções",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
};

/** Status em que o autor deve reenviar o trabalho corrigido. */
export const AGUARDANDO_CORRECAO = "aprovado_correcoes";

/**
 * Carrega as submissões DO USUÁRIO LOGADO + as categorias.
 *
 * O recorte por dono é explícito de propósito. A RLS de `trabalhos`
 * deixa a organização (admin/avaliador) ler tudo e o revisor ler o que
 * lhe foi atribuído — necessário para /admin, /trabalhos e /revisor.
 * O Portal do Estudante, porém, é sempre "as MINHAS submissões",
 * qualquer que seja o papel de quem entra; sem este filtro um professor
 * enxergava aqui os trabalhos de todo mundo.
 */
export function useTrabalhos() {
  const { user, loading: authLoading } = useAuth();
  const ownerId = user?.id ?? null;
  const [trabalhos, setTrabalhos] = useState<Submission[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const [resTrabalhos, resCategorias] = await Promise.all([
      ownerId
        ? supabase
            .from("trabalhos")
            .select("*")
            .eq("owner_id", ownerId)
            .order("created_at", { ascending: false })
        : null,
      supabase.from("categorias").select("*").order("nome"),
    ]);
    const rows: Submission[] = (resTrabalhos?.data ?? []).map((r) => ({
      ...r,
      coautores: Array.isArray(r.coautores) ? (r.coautores as Coautor[]) : [],
    }));
    setTrabalhos(rows);
    setCategorias(resCategorias.data ?? []);
    setLoading(false);
  }, [ownerId]);

  useEffect(() => {
    // Espera a sessão resolver: sem isso a primeira carga rodaria sem
    // dono e a tela piscaria "nenhuma submissão".
    if (authLoading) return;
    reload();
  }, [authLoading, reload]);

  const catNome = (id: string | null) =>
    id ? (categorias.find((c) => c.id === id)?.nome ?? "—") : "—";

  return { trabalhos, categorias, loading, reload, catNome };
}
