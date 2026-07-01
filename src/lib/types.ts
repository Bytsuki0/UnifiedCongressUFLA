export type Avaliador = {
  id: string;
  nome: string;
  email: string;
  instituicao: string;
  created_at: string;
};

export type Categoria = {
  id: string;
  nome: string;
  created_at: string;
};

export type Criterio = {
  id: string;
  categoria_id: string;
  ordem: number;
  titulo: string;
  created_at: string;
};

export type Trabalho = {
  id: string;
  titulo: string;
  resumo: string;
  autores: string;
  categoria_id: string;
  data_submissao: string;
  created_at: string;
};

export type Professor = {
  id: string;
  user_id: string | null;
  nome: string;
  email: string;
  departamento: string;
  created_at: string;
};

// Associação de um revisor (avaliador OU professor) a um trabalho, por e-mail.
export type TrabalhoRevisor = {
  id: string;
  trabalho_id: string;
  revisor_email: string;
  revisor_nome: string | null;
  tipo: "avaliador" | "professor";
  created_at: string;
};

// Resultado possível de um parecer.
export type ResultadoParecer = "aprovado" | "aprovado_correcoes" | "nao_aprovado";

export const RESULTADO_OPTIONS: { value: ResultadoParecer; label: string }[] = [
  { value: "aprovado", label: "Aprovado" },
  { value: "aprovado_correcoes", label: "Aprovado com necessidade de correções" },
  { value: "nao_aprovado", label: "Não aprovado" },
];

// Nota e comentário de um critério dentro de um parecer.
export type ParecerItem = {
  criterio_id: string;
  titulo: string;
  nota: number;
  comentario: string;
};

export type Parecer = {
  id: string;
  trabalho_id: string;
  revisor_email: string;
  revisor_nome: string | null;
  resultado: ResultadoParecer;
  itens: ParecerItem[];
  comentario_geral: string | null;
  created_at: string;
  updated_at: string;
};

// Máximo de revisores que podem ser associados a um único trabalho.
export const MAX_REVISORES_POR_TRABALHO = 3;

export type AvaliacaoStatus = "pendente" | "em_avaliacao" | "concluida";
export type AvaliacaoDecisao = "aceito" | "rejeitado";

// Notas por critério persistidas na avaliação (0 a 5 cada).
export type AvaliacaoNotas = {
  originalidade_relevancia: number;
  clareza_objetivos: number;
  fundamentacao_teorica: number;
  metodologia: number;
  analise_resultados: number;
  qualidade_redacao: number;
  impacto: number;
};

export type Avaliacao = {
  id: string;
  avaliador_id: string;
  trabalho_id: string;
  status: AvaliacaoStatus;
  notas: Partial<AvaliacaoNotas>;
  nota_geral: number | null;
  decisao: AvaliacaoDecisao | null;
  comentarios: string | null;
  data_avaliacao: string | null;
  data_atribuicao: string;
  created_at: string;
};

// Limite máximo de trabalhos por avaliador (regra de negócio)
export const LIMITE_TRABALHOS_POR_AVALIADOR = 5;