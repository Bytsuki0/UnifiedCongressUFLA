-- ============================================================
-- Critérios de análise por categoria
-- ------------------------------------------------------------
-- Cada categoria possui um conjunto de critérios (pontos de
-- análise) usados para avaliar os trabalhos. Editáveis pela
-- página /categorias.
-- ============================================================

-- A FK trabalhos.categoria_id é ON DELETE SET NULL, mas a coluna estava
-- NOT NULL — o que faria a exclusão de uma categoria com trabalhos falhar.
-- Tornamos a coluna anulável para que excluir a categoria apenas desvincule
-- os trabalhos (deixa-os sem categoria) em vez de gerar erro.
ALTER TABLE public.trabalhos ALTER COLUMN categoria_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.criterios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  ordem        INTEGER NOT NULL DEFAULT 1,
  titulo       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_criterios_categoria ON public.criterios(categoria_id);

ALTER TABLE public.criterios ENABLE ROW LEVEL SECURITY;

-- Acesso público (consistente com o restante do app neste sprint).
DROP POLICY IF EXISTS "public all criterios" ON public.criterios;
CREATE POLICY "public all criterios" ON public.criterios FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.criterios TO anon, authenticated;
GRANT ALL ON public.criterios TO service_role;

-- ------------------------------------------------------------
-- Seed: 5 critérios iniciais para cada categoria existente.
-- Casado por nome da categoria; só insere se a categoria ainda
-- não tiver critérios (idempotente).
-- ------------------------------------------------------------
INSERT INTO public.criterios (categoria_id, ordem, titulo)
SELECT c.id, v.ordem, v.titulo
FROM public.categorias c
JOIN (VALUES
  -- Pesquisa (PIBIC)
  ('Pesquisa', 1, 'Clareza e originalidade do problema'),
  ('Pesquisa', 2, 'Rigor metodológico'),
  ('Pesquisa', 3, 'Consistência dos resultados'),
  ('Pesquisa', 4, 'Aderência ao referencial teórico'),
  ('Pesquisa', 5, 'Qualidade da redação científica'),
  -- BIC Jr. (mesmos critérios da Pesquisa)
  ('BIC Jr.', 1, 'Clareza e originalidade do problema'),
  ('BIC Jr.', 2, 'Rigor metodológico'),
  ('BIC Jr.', 3, 'Consistência dos resultados'),
  ('BIC Jr.', 4, 'Aderência ao referencial teórico'),
  ('BIC Jr.', 5, 'Qualidade da redação científica'),
  -- Extensão
  ('Extensão', 1, 'Impacto social mensurável'),
  ('Extensão', 2, 'Articulação universidade-comunidade'),
  ('Extensão', 3, 'Pertinência territorial'),
  ('Extensão', 4, 'Indicadores de continuidade'),
  ('Extensão', 5, 'Participação ativa dos beneficiários'),
  -- Ensino
  ('Ensino', 1, 'Inovação didática e criatividade'),
  ('Ensino', 2, 'Alinhamento com o projeto pedagógico'),
  ('Ensino', 3, 'Avaliação e acompanhamento'),
  ('Ensino', 4, 'Replicabilidade da prática'),
  ('Ensino', 5, 'Engajamento discente gerado')
) AS v(nome, ordem, titulo) ON v.nome = c.nome
WHERE NOT EXISTS (
  SELECT 1 FROM public.criterios cr WHERE cr.categoria_id = c.id
);
