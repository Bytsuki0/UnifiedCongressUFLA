-- ============================================================
-- Avaliação ao vivo — notas dadas durante o congresso
-- ------------------------------------------------------------
-- Pedido de 2026-11-02. Um portal novo, /avaliacao, onde professor,
-- avaliador e admin dão nota às APRESENTAÇÕES durante o evento. Não há
-- distribuição: quem avalia procura o trabalho (categoria, título,
-- autor) e clica em Avaliar.
--
--   criterios_evento    Os critérios DESTA avaliação, por categoria,
--                       editados em /co-chairs/criterios-evento. São
--                       outra lista: os de `criterios` seguem valendo só
--                       para o parecer de /revisor, que não muda nada.
--   avaliacoes_evento   Uma linha por (trabalho, avaliador), com as notas
--                       copiadas em `itens` e a média.
--
-- ⚠ MUDANÇA DE VISIBILIDADE: o professor não lê `trabalhos` pelo RLS (só
-- dono, revisor associado e organização). `trabalhos_para_avaliacao()` é
-- a fresta, estreita de propósito:
--   · só 'aprovado' e 'aprovado_correcoes' — é o que se apresenta;
--   · só id, título, autores e categoria. Autor aparece porque a
--     apresentação é pública e a busca é por autor: aqui não há avaliação
--     às cegas. E-mail, orientador, coautores, resumo e parecer, nunca.
--   · só para professor/avaliador/admin de e-mail confirmado.
--
-- Conflito de interesse é o MESMO de /revisor (`conflitos_do_trabalho`):
-- dono, orientador e coautor não avaliam aquele trabalho.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. `criterios_evento` — mesmo formato de `criterios`
-- ------------------------------------------------------------
-- Formato idêntico de propósito: a tela de co-chairs grava as duas
-- listas pelas mesmas funções (`salvarCriterios`/`excluirCriterio`).
CREATE TABLE IF NOT EXISTS public.criterios_evento (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID NOT NULL REFERENCES public.categorias(id) ON DELETE CASCADE,
  ordem        INTEGER NOT NULL DEFAULT 1,
  titulo       TEXT NOT NULL CHECK (btrim(titulo) <> ''),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_criterios_evento_categoria
  ON public.criterios_evento(categoria_id);

COMMENT ON TABLE public.criterios_evento IS
  'Critérios da avaliação ao vivo (/avaliacao), por categoria. Os do parecer de /revisor ficam em criterios.';

ALTER TABLE public.criterios_evento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "criterios_evento select" ON public.criterios_evento;
CREATE POLICY "criterios_evento select" ON public.criterios_evento FOR SELECT TO authenticated
  USING (public.email_confirmado());

DROP POLICY IF EXISTS "criterios_evento write" ON public.criterios_evento;
CREATE POLICY "criterios_evento write" ON public.criterios_evento FOR ALL TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado())
  WITH CHECK (public.is_event_staff() AND public.email_confirmado());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.criterios_evento TO authenticated;
GRANT ALL ON public.criterios_evento TO service_role;
-- ALTER DEFAULT PRIVILEGES do projeto concede tudo a `anon`.
REVOKE ALL ON public.criterios_evento FROM anon;

-- ------------------------------------------------------------
-- 2. `avaliacoes_evento` — as notas dadas
-- ------------------------------------------------------------
-- `itens` = [{criterio_id, titulo, nota}], com o TÍTULO copiado como em
-- `pareceres.itens`: um co-chair renomeando ou apagando um critério no
-- meio do evento não muda o que já foi dado. `media` é gravada pela RPC
-- (única escritora) para o ranking não ter de abrir o JSON.
CREATE TABLE IF NOT EXISTS public.avaliacoes_evento (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trabalho_id  UUID NOT NULL REFERENCES public.trabalhos(id) ON DELETE CASCADE,
  avaliador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  itens        JSONB NOT NULL DEFAULT '[]'::jsonb,
  media        NUMERIC(4,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trabalho_id, avaliador_id)
);

COMMENT ON TABLE public.avaliacoes_evento IS
  'Notas da avaliação ao vivo. Só avaliar_trabalho_evento() grava; sem policy de escrita.';

ALTER TABLE public.avaliacoes_evento ENABLE ROW LEVEL SECURITY;

-- Cada um lê as suas; a organização lê todas (é quem monta o ranking).
-- ⚠ Por isso a tela "Minhas avaliações" filtra por `avaliador_id` no
-- request: para um admin, o RLS sozinho devolveria as de todo mundo.
DROP POLICY IF EXISTS "avaliacoes_evento select" ON public.avaliacoes_evento;
CREATE POLICY "avaliacoes_evento select" ON public.avaliacoes_evento FOR SELECT TO authenticated
  USING ((avaliador_id = auth.uid() OR public.is_event_staff()) AND public.email_confirmado());

-- Sem INSERT/UPDATE/DELETE para `authenticated`: escrever direto pularia a
-- validação das notas e o conflito de interesse. O REVOKE explícito é
-- porque o ALTER DEFAULT PRIVILEGES também pode ter dado tudo a ele.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.avaliacoes_evento FROM authenticated;
GRANT SELECT ON public.avaliacoes_evento TO authenticated;
GRANT ALL ON public.avaliacoes_evento TO service_role;
REVOKE ALL ON public.avaliacoes_evento FROM anon;

-- ------------------------------------------------------------
-- 3. O que quem avalia enxerga — a fresta sobre `trabalhos`
-- ------------------------------------------------------------
-- É também a definição ÚNICA de "quem pode avaliar o quê":
-- `avaliar_trabalho_evento` pergunta a ela em vez de repetir a regra.
CREATE OR REPLACE FUNCTION public.trabalhos_para_avaliacao()
RETURNS TABLE(id uuid, titulo text, autores text, categoria_id uuid, em_conflito boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.titulo, t.autores, t.categoria_id,
         EXISTS (SELECT 1 FROM public.conflitos_do_trabalho(t.id) c
                  WHERE c.email = lower(auth.email()))
    FROM public.trabalhos t
   WHERE t.status IN ('aprovado', 'aprovado_correcoes')
     AND (public.is_event_staff() OR public.has_role(auth.uid(), 'professor'))
     AND public.email_confirmado()
   ORDER BY t.titulo, t.id;
$$;
-- `FROM PUBLIC` não tira o grant direto do ALTER DEFAULT PRIVILEGES.
REVOKE ALL ON FUNCTION public.trabalhos_para_avaliacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trabalhos_para_avaliacao() FROM anon;
GRANT EXECUTE ON FUNCTION public.trabalhos_para_avaliacao() TO authenticated;

-- ------------------------------------------------------------
-- 4. Dar (ou refazer) a nota
-- ------------------------------------------------------------
-- `_notas` = {"<criterio_id>": 1..5}. Do corpo só sai a NOTA: quais são
-- os critérios e o título de cada um saem de `criterios_evento` (mesma
-- regra de `aplicar_anexos`). Chave a mais é ignorada; critério sem nota
-- válida recusa tudo.
CREATE OR REPLACE FUNCTION public.avaliar_trabalho_evento(_trabalho_id uuid, _notas jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_notas     jsonb := coalesce(_notas, '{}'::jsonb);
  v_categoria uuid;
  v_conflito  boolean;
  v_total     integer;
  v_validas   integer;
  v_itens     jsonb;
  v_media     numeric;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF jsonb_typeof(v_notas) <> 'object' THEN
    RAISE EXCEPTION 'Notas inválidas.';
  END IF;

  -- Fora da lista (não aprovado, inexistente, ou quem chama não avalia)
  -- responde igual.
  SELECT p.categoria_id, p.em_conflito INTO v_categoria, v_conflito
    FROM public.trabalhos_para_avaliacao() p
   WHERE p.id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;
  IF v_conflito THEN
    RAISE EXCEPTION 'Você é autor, orientador ou coautor deste trabalho e não pode avaliá-lo.';
  END IF;

  -- Nota que não é número inteiro de 1 a 5 vira NULL e não conta como válida.
  WITH c AS (
    SELECT ce.id, ce.titulo, ce.ordem, ce.created_at,
           CASE WHEN jsonb_typeof(v_notas -> ce.id::text) = 'number'
                THEN (v_notas ->> ce.id::text)::numeric END AS nota
      FROM public.criterios_evento ce
     WHERE ce.categoria_id = v_categoria
  )
  SELECT count(*),
         count(*) FILTER (WHERE c.nota BETWEEN 1 AND 5 AND c.nota = trunc(c.nota)),
         jsonb_agg(jsonb_build_object('criterio_id', c.id, 'titulo', c.titulo, 'nota', c.nota)
                   ORDER BY c.ordem, c.created_at),
         round(avg(c.nota), 2)
    INTO v_total, v_validas, v_itens, v_media
    FROM c;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'A categoria deste trabalho ainda não tem critérios de avaliação do evento.';
  END IF;
  IF v_validas < v_total THEN
    RAISE EXCEPTION 'Atribua uma nota de 1 a 5 a todos os critérios.';
  END IF;

  INSERT INTO public.avaliacoes_evento (trabalho_id, avaliador_id, itens, media)
  VALUES (_trabalho_id, v_uid, v_itens, v_media)
  ON CONFLICT (trabalho_id, avaliador_id)
  DO UPDATE SET itens = EXCLUDED.itens, media = EXCLUDED.media, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.avaliar_trabalho_evento(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avaliar_trabalho_evento(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.avaliar_trabalho_evento(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 5. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  IF has_table_privilege('anon', 'public.criterios_evento', 'SELECT')
     OR has_table_privilege('anon', 'public.avaliacoes_evento', 'SELECT') THEN
    RAISE EXCEPTION 'anon ficou com grant de tabela na avaliação ao vivo — o REVOKE não pegou';
  END IF;

  IF has_function_privilege('anon', 'public.trabalhos_para_avaliacao()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.avaliar_trabalho_evento(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar as RPCs da avaliação ao vivo';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'avaliacoes_evento'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'avaliacoes_evento ganhou policy de escrita — só avaliar_trabalho_evento() grava';
  END IF;

  IF has_table_privilege('authenticated', 'public.avaliacoes_evento', 'INSERT')
     OR has_table_privilege('authenticated', 'public.avaliacoes_evento', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.avaliacoes_evento', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated ficou com grant de escrita em avaliacoes_evento';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.criterios_evento'::regclass AND contype = 'c') THEN
    RAISE EXCEPTION 'criterios_evento perdeu o CHECK de título vazio';
  END IF;

  -- A fresta não pode alargar: SECURITY DEFINER, o RLS de `trabalhos` não
  -- socorre ninguém aqui.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.trabalhos_para_avaliacao()'::regprocedure;
  IF v_src NOT LIKE '%t.status IN (''aprovado'', ''aprovado_correcoes'')%'
     OR v_src NOT LIKE '%email_confirmado()%'
     OR v_src NOT LIKE '%conflitos_do_trabalho%'
     OR v_src LIKE '%orientador_email%'
     OR v_src LIKE '%coautores%'
     OR v_src LIKE '%resumo%' THEN
    RAISE EXCEPTION 'trabalhos_para_avaliacao() mudou de recorte — confira status, gate, conflito e colunas';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.avaliar_trabalho_evento(uuid, jsonb)'::regprocedure;
  IF v_src NOT LIKE '%trabalhos_para_avaliacao()%' OR v_src NOT LIKE '%v_conflito%' THEN
    RAISE EXCEPTION 'avaliar_trabalho_evento() deixou de consultar trabalhos_para_avaliacao() ou o conflito';
  END IF;
END $$;
