-- ============================================================
-- Avaliação persistida por revisor
-- ------------------------------------------------------------
-- Guarda as notas por critério, a média geral e a decisão final
-- diretamente na atribuição (public.avaliacoes).
-- ============================================================

ALTER TABLE public.avaliacoes
  ADD COLUMN IF NOT EXISTS notas JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS nota_geral NUMERIC(4, 2),
  ADD COLUMN IF NOT EXISTS decisao TEXT,
  ADD COLUMN IF NOT EXISTS data_avaliacao TIMESTAMPTZ;

ALTER TABLE public.avaliacoes
  DROP CONSTRAINT IF EXISTS avaliacoes_decisao_check;

ALTER TABLE public.avaliacoes
  ADD CONSTRAINT avaliacoes_decisao_check
  CHECK (decisao IS NULL OR decisao IN ('aceito', 'rejeitado'));

ALTER TABLE public.avaliacoes
  DROP CONSTRAINT IF EXISTS avaliacoes_nota_geral_check;

ALTER TABLE public.avaliacoes
  ADD CONSTRAINT avaliacoes_nota_geral_check
  CHECK (nota_geral IS NULL OR (nota_geral >= 0 AND nota_geral <= 5));

CREATE INDEX IF NOT EXISTS idx_avaliacoes_nota_geral
  ON public.avaliacoes(nota_geral DESC)
  WHERE nota_geral IS NOT NULL;
