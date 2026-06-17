-- Drop existing restrictive policies
DROP POLICY IF EXISTS "avaliador update own" ON public.avaliadores;
DROP POLICY IF EXISTS "gestor delete avaliadores" ON public.avaliadores;
DROP POLICY IF EXISTS "gestor insert avaliadores" ON public.avaliadores;
DROP POLICY IF EXISTS "gestor update avaliadores" ON public.avaliadores;
DROP POLICY IF EXISTS "view avaliadores" ON public.avaliadores;

DROP POLICY IF EXISTS "aluno insert own trabalho" ON public.trabalhos;
DROP POLICY IF EXISTS "aluno update own or gestor" ON public.trabalhos;
DROP POLICY IF EXISTS "gestor delete trabalhos" ON public.trabalhos;
DROP POLICY IF EXISTS "view trabalhos by role" ON public.trabalhos;

DROP POLICY IF EXISTS "gestor manage categorias" ON public.categorias;
DROP POLICY IF EXISTS "view categorias" ON public.categorias;

DROP POLICY IF EXISTS "gestor delete avaliacoes" ON public.avaliacoes;
DROP POLICY IF EXISTS "gestor insert avaliacoes" ON public.avaliacoes;
DROP POLICY IF EXISTS "gestor or avaliador update avaliacoes" ON public.avaliacoes;
DROP POLICY IF EXISTS "view avaliacoes by role" ON public.avaliacoes;

-- Public access policies (restoring previous sprint behavior - no auth)
CREATE POLICY "public all avaliadores" ON public.avaliadores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all trabalhos" ON public.trabalhos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all categorias" ON public.categorias FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all avaliacoes" ON public.avaliacoes FOR ALL USING (true) WITH CHECK (true);

-- Ensure Data API grants for anon (app uses anon key without login)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avaliadores TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trabalhos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avaliacoes TO anon, authenticated;
GRANT ALL ON public.avaliadores, public.trabalhos, public.categorias, public.avaliacoes TO service_role;