-- Enum para status da avaliação
CREATE TYPE public.avaliacao_status AS ENUM ('pendente', 'em_avaliacao', 'concluida');

-- Tabela de avaliações (N:N entre avaliadores e trabalhos)
CREATE TABLE public.avaliacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  avaliador_id UUID NOT NULL REFERENCES public.avaliadores(id) ON DELETE CASCADE,
  trabalho_id UUID NOT NULL REFERENCES public.trabalhos(id) ON DELETE CASCADE,
  status public.avaliacao_status NOT NULL DEFAULT 'pendente',
  data_atribuicao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT avaliacoes_avaliador_trabalho_unique UNIQUE (avaliador_id, trabalho_id)
);

CREATE INDEX idx_avaliacoes_avaliador ON public.avaliacoes(avaliador_id);
CREATE INDEX idx_avaliacoes_trabalho ON public.avaliacoes(trabalho_id);

ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "público pode ver avaliacoes"
  ON public.avaliacoes FOR SELECT USING (true);

CREATE POLICY "público pode inserir avaliacoes"
  ON public.avaliacoes FOR INSERT WITH CHECK (true);

CREATE POLICY "público pode atualizar avaliacoes"
  ON public.avaliacoes FOR UPDATE USING (true);

CREATE POLICY "público pode deletar avaliacoes"
  ON public.avaliacoes FOR DELETE USING (true);