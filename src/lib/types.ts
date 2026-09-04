import type { Tables } from "@/integrations/supabase/types";

/**
 * Tipos de linha derivados do schema gerado (`npm run gen:types`).
 *
 * Antes eram redigitados à mão aqui e tinham saído de sincronia com o
 * banco — `Trabalho` não declarava status/owner_id/coautores e dava
 * categoria_id como não-nulo, sendo que a coluna aceita NULL. Derivar do
 * gerado faz o TypeScript acusar a divergência na próxima vez — foi o que
 * apontou, uma a uma, as telas que liam `pdf_url` quando a 20260904120000
 * moveu os anexos para tabela própria.
 */
export type Avaliador = Tables<"avaliadores">;
export type Categoria = Tables<"categorias">;

export type Criterio = {
  id: string;
  categoria_id: string;
  ordem: number;
  titulo: string;
  created_at: string;
};

export type Trabalho = Tables<"trabalhos">;

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
  /** Rodada em que a associação nasceu; carimbada pelo banco, nunca pelo cliente. */
  rodada: number;
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

// Limite máximo de trabalhos por avaliador no sistema legado de
// `avaliacoes` (o que alimenta Avaliadores e Atribuições). NÃO vale para a
// associação de revisores em `trabalho_revisores` — lá o número abaixo é o
// que conta.
export const LIMITE_TRABALHOS_POR_AVALIADOR = 5;

/**
 * Quantos trabalhos a recomendação tenta não passar por revisor.
 *
 * ⚠ É uma META, não um teto: nada recusa um revisor acima disso. A
 * recomendação sempre escolhe quem tem menos trabalhos, então ninguém
 * chega a 5 enquanto houver alguém elegível com 4 ou menos — e quando
 * todo o pool já está em 4 e ainda faltam revisores para completar os
 * trabalhos, o número passa de 4 em vez de deixar trabalho a descoberto.
 * Um teto duro fazia exatamente isso: parava a distribuição no 5 e o
 * trabalho ficava com menos de 3 revisores sem ninguém avisar.
 */
export const META_TRABALHOS_POR_REVISOR = 4;