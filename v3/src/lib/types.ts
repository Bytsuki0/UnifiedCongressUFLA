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

export type Trabalho = {
  id: string;
  titulo: string;
  resumo: string;
  autores: string;
  categoria_id: string;
  data_submissao: string;
  created_at: string;
};

export type AvaliacaoStatus = "pendente" | "em_avaliacao" | "concluida";

export type Avaliacao = {
  id: string;
  avaliador_id: string;
  trabalho_id: string;
  status: AvaliacaoStatus;
  data_atribuicao: string;
  created_at: string;
};

// Limite máximo de trabalhos por avaliador (regra de negócio)
export const LIMITE_TRABALHOS_POR_AVALIADOR = 5;