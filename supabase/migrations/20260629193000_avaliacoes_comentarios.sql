-- ============================================================
-- Comentários do avaliador
-- ------------------------------------------------------------
-- Texto livre salvo junto à avaliação do trabalho.
-- ============================================================

ALTER TABLE public.avaliacoes
  ADD COLUMN IF NOT EXISTS comentarios TEXT;
