-- ============================================================
-- Dentro do prazo, o autor edita a AUTORIA e pode EXCLUIR o trabalho;
-- e o orientador ganha um NOME ao lado do e-mail.
-- ------------------------------------------------------------
-- 1. `trabalhos.orientador_nome`: um nome só, texto livre, opcional.
--    Não entra no conflito de interesse — quem barra é o e-mail.
--
-- 2. `editar_submissao` passa a gravar autores, orientador (nome e
--    e-mail) e coautores. A CATEGORIA continua travada (define as
--    exigências de anexo e os critérios).
--
--    O motivo de a autoria ter sido travada era a distribuição: um
--    co-chair pode já ter confirmado revisores escolhidos contra os
--    conflitos da autoria ANTIGA. A resposta aqui é refazer a checagem:
--    depois de gravar a autoria nova, as associações da rodada corrente
--    que caírem em conflito com ela são APAGADAS. Em 'pendente' ainda não
--    há parecer (o 1º parecer move para 'em_avaliacao'), então nada se
--    perde; o trabalho aparece com menos revisores em Atribuições e a
--    recomendação o completa. Recusar a edição revelaria ao autor que
--    aquele e-mail é revisor dele — a avaliação é às cegas.
--
--    Dois UPDATEs, de propósito: o primeiro (título, palavras-chave)
--    segue SEM o GUC e passa pelo trigger `protect_trabalhos_fields`,
--    prazo incluso. O segundo liga `app.decisao_automatica` só para a
--    autoria, que o trigger devolveria a OLD para quem não é staff. O
--    UPDATE direto pela API continua sem conseguir trocar autoria — e
--    portanto sem pular a limpeza de conflito.
--
-- 3. `submeter_trabalho` e `reenviar_trabalho` ganham `_orientador_nome`.
--
-- 4. Policy "trabalhos delete": o ramo do dono passa a exigir prazo
--    aberto e trabalho nunca reenviado (apagar um reenviado apagaria a
--    rodada 1 inteira, pareceres e decisão editorial inclusos).
-- ============================================================

ALTER TABLE public.trabalhos ADD COLUMN IF NOT EXISTS orientador_nome text;

-- ------------------------------------------------------------
-- editar_submissao
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.editar_submissao(uuid, text, text[], jsonb);

CREATE FUNCTION public.editar_submissao(
  _trabalho_id      uuid,
  _titulo           text,
  _palavras_chave   text[],
  _autores          text,
  _orientador_email text,
  _orientador_nome  text,
  _coautores        jsonb,
  _anexos           jsonb DEFAULT '[]'::jsonb
)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t       public.trabalhos%ROWTYPE;
  v_kw    text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_coaut jsonb := CASE
    WHEN jsonb_typeof(coalesce(_coautores, '[]'::jsonb)) = 'array'
      THEN coalesce(_coautores, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;
  IF t.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o autor pode editar o trabalho.';
  END IF;
  IF t.status <> 'pendente' THEN
    RAISE EXCEPTION 'Este trabalho já entrou em avaliação e não pode mais ser editado.';
  END IF;
  IF t.reenviado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este trabalho já foi reenviado e não pode mais ser editado.';
  END IF;
  IF NOT public.submissoes_abertas() THEN
    RAISE EXCEPTION 'O prazo de submissão está encerrado — o trabalho não pode mais ser editado.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(trim(_autores), '') = '' THEN
    RAISE EXCEPTION 'Informe os autores.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;

  -- Sem GUC: passa pelo trigger, inclusive pelo prazo.
  UPDATE public.trabalhos
     SET titulo         = trim(_titulo),
         palavras_chave = v_kw
   WHERE id = _trabalho_id;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET autores          = trim(_autores),
         orientador_email = nullif(btrim(coalesce(_orientador_email, '')), ''),
         orientador_nome  = nullif(btrim(coalesce(_orientador_nome, '')), ''),
         coautores        = v_coaut
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  -- A checagem de conflito refeita sobre a autoria NOVA.
  DELETE FROM public.trabalho_revisores tr
   WHERE tr.trabalho_id = _trabalho_id
     AND tr.rodada = t.rodada
     AND lower(trim(tr.revisor_email)) IN (
       SELECT c.email FROM public.conflitos_do_trabalho(_trabalho_id) c
     );

  RETURN public.aplicar_anexos(_trabalho_id, _anexos);
END; $$;

REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.editar_submissao(uuid, text, text[], text, text, text, jsonb, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- submeter_trabalho — corpo da 20260904120000 + orientador_nome
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submeter_trabalho(text, text[], uuid, text, text, jsonb, jsonb);

CREATE FUNCTION public.submeter_trabalho(
  _titulo           text,
  _palavras_chave   text[],
  _categoria_id     uuid,
  _autores          text,
  _orientador_email text,
  _orientador_nome  text,
  _coautores        jsonb,
  _anexos           jsonb
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_kw    text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_coaut jsonb := CASE
    WHEN jsonb_typeof(coalesce(_coautores, '[]'::jsonb)) = 'array'
      THEN coalesce(_coautores, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(trim(_autores), '') = '' THEN
    RAISE EXCEPTION 'Informe os autores.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;
  IF _categoria_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = _categoria_id) THEN
    RAISE EXCEPTION 'Selecione uma categoria válida.';
  END IF;

  INSERT INTO public.trabalhos (
    titulo, palavras_chave, categoria_id, autores,
    orientador_email, orientador_nome, coautores, owner_id, status, data_submissao
  ) VALUES (
    trim(_titulo), v_kw, _categoria_id, trim(_autores),
    nullif(btrim(coalesce(_orientador_email, '')), ''),
    nullif(btrim(coalesce(_orientador_nome, '')), ''),
    v_coaut,
    auth.uid(), 'pendente',
    public.data_local()
  )
  RETURNING id INTO v_id;

  PERFORM public.aplicar_anexos(v_id, _anexos);

  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.submeter_trabalho(text, text[], uuid, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submeter_trabalho(text, text[], uuid, text, text, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.submeter_trabalho(text, text[], uuid, text, text, text, jsonb, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- reenviar_trabalho — corpo da 20260904120000 + orientador_nome
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reenviar_trabalho(uuid, text, text[], text, text, jsonb, uuid, jsonb);

CREATE FUNCTION public.reenviar_trabalho(
  _trabalho_id      uuid,
  _titulo           text,
  _palavras_chave   text[],
  _autores          text,
  _orientador_email text,
  _orientador_nome  text,
  _coautores        jsonb,
  _categoria_id     uuid,
  _anexos           jsonb DEFAULT '[]'::jsonb
)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t       public.trabalhos%ROWTYPE;
  v_kw    text[] := ARRAY(
    SELECT btrim(k)
    FROM unnest(coalesce(_palavras_chave, '{}'::text[])) AS k
    WHERE btrim(k) <> ''
  );
  v_coaut jsonb := CASE
    WHEN jsonb_typeof(coalesce(_coautores, '[]'::jsonb)) = 'array'
      THEN coalesce(_coautores, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT * INTO t FROM public.trabalhos WHERE id = _trabalho_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trabalho não encontrado.';
  END IF;
  IF t.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente o autor pode reenviar o trabalho.';
  END IF;
  IF t.status <> 'resubmeter' THEN
    RAISE EXCEPTION 'Este trabalho não está aguardando reenvio.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' THEN
    RAISE EXCEPTION 'O título é obrigatório.';
  END IF;
  IF coalesce(trim(_autores), '') = '' THEN
    RAISE EXCEPTION 'Informe os autores.';
  END IF;
  IF coalesce(array_length(v_kw, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma palavra-chave.';
  END IF;
  IF _categoria_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.categorias c WHERE c.id = _categoria_id) THEN
    RAISE EXCEPTION 'Selecione uma categoria válida.';
  END IF;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET titulo           = trim(_titulo),
         palavras_chave   = v_kw,
         autores          = trim(_autores),
         orientador_email = nullif(btrim(coalesce(_orientador_email, '')), ''),
         orientador_nome  = nullif(btrim(coalesce(_orientador_nome, '')), ''),
         coautores        = v_coaut,
         categoria_id     = _categoria_id,
         rodada           = t.rodada + 1,
         status           = 'pendente',
         reenviado_em     = now()
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  RETURN public.aplicar_anexos(_trabalho_id, _anexos);
END; $$;

REVOKE ALL ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, text, jsonb, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, text, jsonb, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.reenviar_trabalho(uuid, text, text[], text, text, text, jsonb, uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- Exclusão pelo autor: só dentro do prazo, só antes de reenviar
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "trabalhos delete" ON public.trabalhos;
CREATE POLICY "trabalhos delete" ON public.trabalhos FOR DELETE TO authenticated
  USING (
    (
      public.is_event_staff()
      OR (
        owner_id = auth.uid()
        AND status = 'pendente'
        AND reenviado_em IS NULL
        AND public.submissoes_abertas()
      )
    )
    AND public.email_confirmado()
  );

-- ------------------------------------------------------------
-- Canários
-- ------------------------------------------------------------
DO $$
DECLARE
  f text;
  v_qual text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.editar_submissao(uuid, text, text[], text, text, text, jsonb, jsonb)',
    'public.submeter_trabalho(text, text[], uuid, text, text, text, jsonb, jsonb)',
    'public.reenviar_trabalho(uuid, text, text[], text, text, text, jsonb, uuid, jsonb)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'Canário: % ficou executável por anon.', f;
    END IF;
  END LOOP;

  -- Assinatura velha viva = bundle antigo gravando sem orientador_nome
  -- (e, na edição, sem a limpeza de conflito).
  IF to_regprocedure('public.editar_submissao(uuid, text, text[], jsonb)') IS NOT NULL
     OR to_regprocedure('public.submeter_trabalho(text, text[], uuid, text, text, jsonb, jsonb)') IS NOT NULL
     OR to_regprocedure('public.reenviar_trabalho(uuid, text, text[], text, text, jsonb, uuid, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Canário: sobrou assinatura antiga de uma das RPCs do autor.';
  END IF;

  IF position('conflitos_do_trabalho' IN pg_get_functiondef(
       'public.editar_submissao(uuid, text, text[], text, text, text, jsonb, jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Canário: editar_submissao abre autoria sem refazer o conflito.';
  END IF;

  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'trabalhos' AND policyname = 'trabalhos delete';
  IF v_qual IS NULL
     OR position('submissoes_abertas' IN v_qual) = 0
     OR position('reenviado_em' IN v_qual) = 0
     OR position('email_confirmado' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'Canário: "trabalhos delete" perdeu prazo, reenvio ou e-mail confirmado: %', v_qual;
  END IF;
END $$;
