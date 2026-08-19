import { useCallback, useEffect, useState } from "react";
import { listarTrabalhosDoAutorComCategorias } from "@/services/trabalhosService";
import { carregarPrazoSubmissoes, type PrazoSubmissoes } from "@/services/configuracoesService";
import { useAuth } from "@/contexts/AuthContext";

// Tipos e helpers compartilhados pelas páginas do Portal do Estudante.

export type Coautor = { nome?: string; email?: string };

export type Submission = {
  id: string;
  owner_id?: string | null;
  titulo: string;
  /**
   * Texto do resumo. Opcional desde 20260819120000: o formulário não o
   * pede mais (o resumo vive no PDF), mas as submissões antigas ainda
   * têm o conteúdo gravado.
   */
  resumo?: string | null;
  palavras_chave?: string[] | null;
  video_url?: string | null;
  tipo_resumo?: string | null;
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

/** Status em que o trabalho ainda não entrou em avaliação. */
export const PENDENTE = "pendente";

/**
 * Status em que a decisão já está fechada — é quando os pareceres ficam
 * visíveis para o autor. Bate com a regra do servidor
 * (`pareceres_do_meu_trabalho` só revela depois da decisão consolidada);
 * aqui serve só para decidir se vale a pena oferecer o botão.
 */
export const STATUS_COM_PARECER = ["aprovado", AGUARDANDO_CORRECAO, "reprovado"];

/** dd/mm/aaaa a partir do 'aaaa-mm-dd' que o Postgres devolve. */
export const formatarData = (iso: string | null): string =>
  iso ? iso.split("-").reverse().join("/") : "—";

/**
 * Prazo de submissão vigente, do servidor.
 *
 * `aberto` NUNCA é recalculado aqui a partir das datas: o relógio do
 * navegador não decide prazo, e um computador adiantado reabriria a
 * janela na tela. Enquanto carrega, `aberto` fica `null` = "não sei" —
 * as telas tratam isso como "ainda não bloquear", porque quem recusa de
 * verdade é o banco (trigger `protect_trabalhos_fields` e a RPC
 * `editar_submissao`). Esta camada é conveniência, não segurança.
 */
export function usePrazo() {
  const [prazo, setPrazo] = useState<PrazoSubmissoes | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarPrazoSubmissoes()
      .then((p) => { if (vivo) setPrazo(p); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  return { prazo, carregando, aberto: prazo?.aberto ?? null };
}

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
    try {
      const dados = await listarTrabalhosDoAutorComCategorias(ownerId);
      setTrabalhos(
        dados.trabalhos.map((r) => ({
          ...r,
          coautores: Array.isArray(r.coautores) ? (r.coautores as Coautor[]) : [],
        })) as Submission[],
      );
      setCategorias(dados.categorias);
    } finally {
      setLoading(false);
    }
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
