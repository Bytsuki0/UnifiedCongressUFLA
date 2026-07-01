import { ResultadoParecer } from "@/lib/types";

// Tipos, constantes e helpers compartilhados pelas páginas do Painel do Revisor.

export const RESULTADO_LABEL: Record<ResultadoParecer, string> = {
  aprovado: "Aprovado",
  aprovado_correcoes: "Aprovado c/ correções",
  nao_aprovado: "Não aprovado",
};
export const RESULTADO_BADGE: Record<ResultadoParecer, string> = {
  aprovado: "badge-solid-green",
  aprovado_correcoes: "badge-solid-blue",
  nao_aprovado: "badge-solid-red",
};
export const TRABALHO_STATUS_LABEL: Record<string, string> = {
  pendente: "Recebido",
  em_avaliacao: "Em Avaliação",
  aprovado: "Aprovado",
  reprovado: "Reprovado",
};
export const TRABALHO_STATUS_BADGE: Record<string, string> = {
  pendente: "badge-amber",
  em_avaliacao: "badge-blue",
  aprovado: "badge-green",
  reprovado: "badge-red",
};
export const NOTA_OPCOES = [
  { value: "1", label: "1 - Insuficiente" },
  { value: "2", label: "2 - Regular" },
  { value: "3", label: "3 - Bom" },
  { value: "4", label: "4 - Muito Bom" },
  { value: "5", label: "5 - Excelente" },
];

// ===== Fluxo legado de atribuições/avaliação, persistido em localStorage =====

export type Submissao = {
  id: string;
  titulo: string;
  categoria: string;
  status: string;
  dataSubmissao: string;
  ultimaAtualizacao?: string;
  revisorEmail?: string;
  rodadas: Rodada[];
  orientador?: string;
  coautores?: { email?: string }[];
  statusHistory?: { statusAnterior: string; statusNovo: string; dataHora: string; justificativa: string }[];
};

export type Rodada = {
  rodada: number;
  pdfName: string;
  pdfData?: string;
  parecer: string;
  comentarios: string;
  dataEnvio: string;
  dataAvaliacao?: string;
  ratings?: Record<string, string>;
  status?: string;
};

export const LS = {
  get<T>(key: string, def: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : def;
    } catch {
      return def;
    }
  },
  set(key: string, val: unknown) {
    localStorage.setItem(key, JSON.stringify(val));
  },
};

export const CRITERIA: Record<string, string[]> = {
  pibic: ["Clareza e originalidade do tema", "Rigor metodológico aplicado", "Consistência dos resultados alcançados", "Aderência ao referencial teórico", "Qualidade geral da redação científica"],
  "bic-junior": ["Clareza e originalidade do tema", "Rigor metodológico aplicado", "Consistência dos resultados alcançados", "Aderência ao referencial teórico", "Qualidade geral da redação científica"],
  extensao: ["Impacto social e transformador mensurável", "Articulação ativa universidade-comunidade", "Pertinência territorial do projeto", "Indicadores claros de continuidade", "Participação efetiva dos beneficiários"],
};
export const DEFAULT_CRITERIA = ["Inovação didática e criatividade", "Alinhamento com o projeto pedagógico", "Avaliação e acompanhamento da aprendizagem", "Replicabilidade e escalabilidade da prática", "Engajamento e interesse discente gerado"];

export const REVIEWER_EMAIL = "prof.almeida@ufla.br";

export function getAlertHours() {
  return parseInt(localStorage.getItem("nexus_config_alert_hours") || "48");
}

export function initials(name?: string) {
  if (!name) return "PR";
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0][0].toUpperCase();
}

export function deadlineOf(sub: Submissao) {
  const ref = new Date(sub.ultimaAtualizacao || sub.dataSubmissao);
  ref.setDate(ref.getDate() + 7);
  return ref;
}
