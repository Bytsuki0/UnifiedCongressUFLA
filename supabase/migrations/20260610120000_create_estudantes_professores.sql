-- ============================================================
-- Tabelas de perfil: estudantes e professores
-- ============================================================

-- Estudantes
CREATE TABLE IF NOT EXISTS public.estudantes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  matricula   TEXT,
  periodo     TEXT,
  curso       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Professores
CREATE TABLE IF NOT EXISTS public.professores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  departamento  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.estudantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professores ENABLE ROW LEVEL SECURITY;

-- Public access policies (consistent with rest of project)
CREATE POLICY "public all estudantes"  ON public.estudantes  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all professores" ON public.professores FOR ALL USING (true) WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estudantes  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professores TO anon, authenticated;
GRANT ALL ON public.estudantes, public.professores TO service_role;
