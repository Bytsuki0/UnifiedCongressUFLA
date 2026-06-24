-- ============================================================
-- Associação de revisores aos trabalhos + pareceres por critério
-- ------------------------------------------------------------
-- 1. trabalho_revisores: associa um revisor (avaliador OU professor)
--    a um trabalho, identificado pelo e-mail. Máximo de 3 revisores
--    por trabalho (garantido por trigger).
-- 2. pareceres: o parecer estruturado emitido por um revisor para um
--    trabalho — nota e comentário por critério + resultado final.
-- ============================================================

-- 1. Associação revisor <-> trabalho -------------------------
CREATE TABLE IF NOT EXISTS public.trabalho_revisores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabalho_id   UUID NOT NULL REFERENCES public.trabalhos(id) ON DELETE CASCADE,
  revisor_email TEXT NOT NULL,
  revisor_nome  TEXT,
  -- 'avaliador' | 'professor' — apenas informativo (de onde veio o revisor).
  tipo          TEXT NOT NULL DEFAULT 'professor',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trabalho_id, revisor_email)
);

CREATE INDEX IF NOT EXISTS idx_trabalho_revisores_trabalho ON public.trabalho_revisores(trabalho_id);
CREATE INDEX IF NOT EXISTS idx_trabalho_revisores_email    ON public.trabalho_revisores(revisor_email);

-- Limite de 3 revisores por trabalho.
CREATE OR REPLACE FUNCTION public.check_max_revisores()
RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.trabalho_revisores
      WHERE trabalho_id = NEW.trabalho_id) >= 3 THEN
    RAISE EXCEPTION 'Um trabalho pode ter no máximo 3 revisores associados.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_max_revisores ON public.trabalho_revisores;
CREATE TRIGGER trg_max_revisores
  BEFORE INSERT ON public.trabalho_revisores
  FOR EACH ROW EXECUTE FUNCTION public.check_max_revisores();

-- 2. Pareceres estruturados ----------------------------------
-- itens: array JSON de objetos
--   { "criterio_id": uuid, "titulo": texto, "nota": 1..5, "comentario": texto }
-- resultado: 'aprovado' | 'aprovado_correcoes' | 'nao_aprovado'
CREATE TABLE IF NOT EXISTS public.pareceres (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabalho_id       UUID NOT NULL REFERENCES public.trabalhos(id) ON DELETE CASCADE,
  revisor_email     TEXT NOT NULL,
  revisor_nome      TEXT,
  resultado         TEXT NOT NULL,
  itens             JSONB NOT NULL DEFAULT '[]'::jsonb,
  comentario_geral  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trabalho_id, revisor_email)
);

CREATE INDEX IF NOT EXISTS idx_pareceres_trabalho ON public.pareceres(trabalho_id);
CREATE INDEX IF NOT EXISTS idx_pareceres_email    ON public.pareceres(revisor_email);

-- 3. RLS + grants (políticas abertas, consistente com o restante do app)
ALTER TABLE public.trabalho_revisores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pareceres          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public all trabalho_revisores" ON public.trabalho_revisores;
CREATE POLICY "public all trabalho_revisores" ON public.trabalho_revisores FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public all pareceres" ON public.pareceres;
CREATE POLICY "public all pareceres" ON public.pareceres FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trabalho_revisores TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pareceres          TO anon, authenticated;
GRANT ALL ON public.trabalho_revisores, public.pareceres TO service_role;
