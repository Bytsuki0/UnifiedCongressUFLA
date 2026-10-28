-- Ensaio revertido dos pôsteres (migration 20261027180000).
--
-- Exercita a submissão (`aplicar_anexos`), o envio do pôster
-- (`enviar_posteres`), a trava do modo pôster e a policy de leitura DE
-- VERDADE, no banco de produção, e desfaz tudo: o bloco termina em RAISE
-- EXCEPTION, que leva junto as contas, a categoria, o trabalho, as entregas
-- e a data de divulgação. Nenhum arquivo é criado no Storage: os caminhos
-- aqui são só texto, e nenhuma das duas funções confere o bucket.
--
-- Como rodar: cole no SQL Editor do dashboard do Supabase (ou mande pela
-- Management API), DEPOIS de aplicar as migrations 20261027120000 e
-- 20261027180000. Aprovado = o erro final diz "ENSAIO OK". Qualquer outra
-- mensagem é a asserção que falhou, e ela diz qual.
--
-- O mesmo arquivo roda no PGlite, sobre um stub do schema, antes da
-- migration ir para produção (ver a memória pglite-provar-sql).

DO $$
DECLARE
  c_dominio CONSTANT text := '@exemplo.invalid';
  v_dono    uuid := gen_random_uuid();
  v_outro   uuid := gen_random_uuid();
  v_revisor uuid := gen_random_uuid();
  v_cat     uuid;
  v_pdf     uuid;
  v_poster  uuid;
  v_livre   uuid;
  v_trab    uuid;
  v_orfaos  text[];
  v_msg     text;
  v_viu_revisor integer;
  v_viu_dono    integer;
BEGIN
  -- Chama uma das duas escritas COMO um usuário: o JWT é simulado só
  -- durante a chamada. Erro sobe como está.
  CREATE FUNCTION pg_temp.chamar(_uid uuid, _funcao text, _trab uuid, _anexos jsonb)
  RETURNS text[] LANGUAGE plpgsql AS $f$
  DECLARE v text[];
  BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.%I($1, $2)', _funcao) INTO v USING _trab, _anexos;
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN v;
  END $f$;

  -- A mesma chamada, esperando a RECUSA: devolve a frase do erro, ou NULL
  -- se a chamada passou (o que, aqui, é sempre a falha).
  CREATE FUNCTION pg_temp.recusa(_uid uuid, _funcao text, _trab uuid, _anexos jsonb)
  RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN
    PERFORM pg_temp.chamar(_uid, _funcao, _trab, _anexos);
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN SQLERRM;
  END $f$;

  -- Um comando sem sessão, esperando a recusa (trigger, CHECK).
  CREATE FUNCTION pg_temp.recusa_sql(_sql text)
  RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN
    EXECUTE _sql;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END $f$;

  -- As contas. O trigger de cadastro cria o profile; `email_confirmado()`
  -- lê `profiles.email_confirmado_em`.
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_dono,    '0-ensaio-poster-dono'    || c_dominio, '{"nome": "Dono"}'),
    (v_outro,   '0-ensaio-poster-outro'   || c_dominio, '{"nome": "Outro"}'),
    (v_revisor, '0-ensaio-poster-revisor' || c_dominio, '{"nome": "Revisor"}');
  UPDATE public.profiles SET email_confirmado_em = now()
   WHERE id IN (v_dono, v_outro, v_revisor);

  -- A categoria: o trabalho completo (obrigatório) e o pôster.
  INSERT INTO public.categorias (nome)
  VALUES ('0 Ensaio dos pôsteres ' || gen_random_uuid())
  RETURNING id INTO v_cat;
  INSERT INTO public.categoria_anexos (categoria_id, tipo, titulo, ordem)
  VALUES (v_cat, 'pdf', 'Trabalho completo', 1)
  RETURNING id INTO v_pdf;
  INSERT INTO public.categoria_anexos (categoria_id, tipo, titulo, ordem, obrigatorio, poster)
  VALUES (v_cat, 'pdf', 'Pôster', 2, false, true)
  RETURNING id INTO v_poster;

  -- Sem sessão (auth.uid() nulo), o trigger de proteção do trabalho devolve
  -- cedo, como em toda escrita de servidor: o status entra direto.
  INSERT INTO public.trabalhos (titulo, autores, owner_id, categoria_id)
  VALUES ('Ensaio do pôster', 'Ensaio', v_dono, v_cat)
  RETURNING id INTO v_trab;

  -- 1. A submissão não cobra o pôster: passa só com o trabalho completo.
  PERFORM pg_temp.chamar(v_dono, 'aplicar_anexos', v_trab, jsonb_build_array(
    jsonb_build_object('anexo_id', v_pdf, 'valor', v_dono || '/trabalho.pdf')));
  IF (SELECT count(*) FROM public.trabalho_anexos WHERE trabalho_id = v_trab) <> 1 THEN
    RAISE EXCEPTION 'FALHOU: a submissão não gravou só o trabalho completo.';
  END IF;

  -- 2. ... e não aceita o pôster pelo caminho da submissão.
  v_msg := pg_temp.recusa(v_dono, 'aplicar_anexos', v_trab, jsonb_build_array(
    jsonb_build_object('anexo_id', v_poster, 'valor', v_dono || '/poster.pdf')));
  IF v_msg IS NULL OR v_msg NOT LIKE '%pôster%' THEN
    RAISE EXCEPTION 'FALHOU: a submissão aceitou o pôster (%).', coalesce(v_msg, 'passou');
  END IF;
  -- ... mas um item de pôster VAZIO não tranca a submissão: não grava nada.
  v_msg := pg_temp.recusa(v_dono, 'aplicar_anexos', v_trab, jsonb_build_array(
    jsonb_build_object('anexo_id', v_pdf, 'valor', NULL),
    jsonb_build_object('anexo_id', v_poster, 'valor', NULL)));
  IF v_msg IS NOT NULL
     OR (SELECT count(*) FROM public.trabalho_anexos WHERE trabalho_id = v_trab) <> 1 THEN
    RAISE EXCEPTION 'FALHOU: item de pôster vazio trancou a submissão ou gravou algo (%).', v_msg;
  END IF;

  -- 3. Antes da divulgação, nem aprovado manda pôster.
  UPDATE public.configuracoes SET resultados_divulgacao = NULL WHERE id;
  UPDATE public.trabalhos SET status = 'aprovado' WHERE id = v_trab;
  IF pg_temp.recusa(v_dono, 'enviar_posteres', v_trab, jsonb_build_array(
       jsonb_build_object('anexo_id', v_poster, 'valor', v_dono || '/poster-1.pdf'))) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: pôster aceito antes da divulgação dos resultados.';
  END IF;

  -- 4. Divulgado, mas reprovado: recusado.
  UPDATE public.configuracoes
     SET resultados_divulgacao = (now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 minute'
   WHERE id;
  UPDATE public.trabalhos SET status = 'reprovado' WHERE id = v_trab;
  IF pg_temp.recusa(v_dono, 'enviar_posteres', v_trab, jsonb_build_array(
       jsonb_build_object('anexo_id', v_poster, 'valor', v_dono || '/poster-1.pdf'))) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: pôster aceito de trabalho reprovado.';
  END IF;

  -- 5. Aprovado com correções: aceito, e a linha nasce pôster.
  UPDATE public.trabalhos SET status = 'aprovado_correcoes' WHERE id = v_trab;
  v_orfaos := pg_temp.chamar(v_dono, 'enviar_posteres', v_trab, jsonb_build_array(
    jsonb_build_object('anexo_id', v_poster, 'valor', v_dono || '/poster-1.pdf')));
  IF cardinality(v_orfaos) <> 0 OR NOT EXISTS (
    SELECT 1 FROM public.trabalho_anexos ta
     WHERE ta.trabalho_id = v_trab AND ta.anexo_id = v_poster
       AND ta.poster AND ta.tipo = 'pdf' AND ta.titulo = 'Pôster'
       AND ta.valor = v_dono || '/poster-1.pdf'
  ) THEN
    RAISE EXCEPTION 'FALHOU: o pôster do aprovado com correções não foi gravado como pôster.';
  END IF;

  -- 6. Só o dono, só na pasta dele, só exigência de pôster.
  IF pg_temp.recusa(v_outro, 'enviar_posteres', v_trab, jsonb_build_array(
       jsonb_build_object('anexo_id', v_poster, 'valor', v_outro || '/poster.pdf'))) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: outra conta mandou pôster para um trabalho que não é dela.';
  END IF;
  IF pg_temp.recusa(v_dono, 'enviar_posteres', v_trab, jsonb_build_array(
       jsonb_build_object('anexo_id', v_poster, 'valor', v_outro || '/poster.pdf'))) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: pôster aceito na pasta de outra conta.';
  END IF;
  IF pg_temp.recusa(v_dono, 'enviar_posteres', v_trab, jsonb_build_array(
       jsonb_build_object('anexo_id', v_pdf, 'valor', v_dono || '/outro.pdf'))) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: exigência comum aceita pelo caminho do pôster.';
  END IF;

  -- 7. A correção passa por aplicar_anexos e NÃO leva o pôster: trocando o
  --    PDF do trabalho, só ele vira órfão.
  v_orfaos := pg_temp.chamar(v_dono, 'aplicar_anexos', v_trab, jsonb_build_array(
    jsonb_build_object('anexo_id', v_pdf, 'valor', v_dono || '/trabalho-corrigido.pdf')));
  IF v_orfaos IS DISTINCT FROM ARRAY[v_dono || '/trabalho.pdf'] THEN
    RAISE EXCEPTION 'FALHOU: a correção devolveu como órfão %, e não só o PDF trocado.', v_orfaos;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trabalho_anexos ta
                  WHERE ta.trabalho_id = v_trab AND ta.poster) THEN
    RAISE EXCEPTION 'FALHOU: a correção apagou o pôster.';
  END IF;

  -- 8. Trocar o pôster devolve o arquivo antigo; valor nulo mantém.
  v_orfaos := pg_temp.chamar(v_dono, 'enviar_posteres', v_trab, jsonb_build_array(
    jsonb_build_object('anexo_id', v_poster, 'valor', v_dono || '/poster-2.pdf')));
  IF v_orfaos IS DISTINCT FROM ARRAY[v_dono || '/poster-1.pdf'] THEN
    RAISE EXCEPTION 'FALHOU: trocar o pôster não devolveu o arquivo antigo (%).', v_orfaos;
  END IF;
  v_orfaos := pg_temp.chamar(v_dono, 'enviar_posteres', v_trab, jsonb_build_array(
    jsonb_build_object('anexo_id', v_poster, 'valor', NULL)));
  IF cardinality(v_orfaos) <> 0
     OR (SELECT ta.valor FROM public.trabalho_anexos ta
          WHERE ta.trabalho_id = v_trab AND ta.poster) <> v_dono || '/poster-2.pdf' THEN
    RAISE EXCEPTION 'FALHOU: valor nulo não manteve o pôster gravado.';
  END IF;

  -- 9. Leitura pela RLS, como cada um a faria: o revisor associado vê o
  --    trabalho completo e NÃO o pôster (avaliação às cegas); o dono vê os dois.
  INSERT INTO public.trabalho_revisores (trabalho_id, revisor_email, revisor_nome, tipo)
  VALUES (v_trab, '0-ensaio-poster-revisor' || c_dominio, 'Revisor', 'avaliador');

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_revisor, 'email', '0-ensaio-poster-revisor' || c_dominio,
    'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_viu_revisor FROM public.trabalho_anexos WHERE trabalho_id = v_trab;
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_dono, 'email', '0-ensaio-poster-dono' || c_dominio,
    'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_viu_dono FROM public.trabalho_anexos WHERE trabalho_id = v_trab;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);

  IF v_viu_revisor <> 1 THEN
    RAISE EXCEPTION 'FALHOU: o revisor associado enxerga % anexo(s) — esperava só o trabalho completo, sem o pôster.', v_viu_revisor;
  END IF;
  IF v_viu_dono <> 2 THEN
    RAISE EXCEPTION 'FALHOU: o dono enxerga % anexo(s) — esperava o trabalho e o pôster.', v_viu_dono;
  END IF;

  -- 10. A trava: exigência já entregue não troca de modo; sem entrega, troca.
  IF pg_temp.recusa_sql(format(
       'UPDATE public.categoria_anexos SET poster = false WHERE id = %L', v_poster)) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: o pôster já entregue virou exigência comum.';
  END IF;
  IF pg_temp.recusa_sql(format(
       'UPDATE public.categoria_anexos SET poster = true, obrigatorio = false WHERE id = %L', v_pdf)) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: exigência comum já entregue virou pôster.';
  END IF;
  INSERT INTO public.categoria_anexos (categoria_id, tipo, titulo, ordem, obrigatorio)
  VALUES (v_cat, 'pdf', 'Anexo livre', 3, false)
  RETURNING id INTO v_livre;
  v_msg := pg_temp.recusa_sql(format(
    'UPDATE public.categoria_anexos SET poster = true WHERE id = %L', v_livre));
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: exigência sem entrega não virou pôster: %', v_msg;
  END IF;
  IF pg_temp.recusa_sql(format(
       'UPDATE public.categoria_anexos SET obrigatorio = true WHERE id = %L', v_livre)) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: pôster marcado como obrigatório.';
  END IF;
  IF pg_temp.recusa_sql(format(
       'INSERT INTO public.categoria_anexos (categoria_id, tipo, titulo, obrigatorio, poster) '
       'VALUES (%L, ''video'', ''Vídeo-pôster'', false, true)', v_cat)) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: vídeo marcado como pôster.';
  END IF;

  -- 11. Apagar a exigência não leva o pôster entregue — nem na próxima
  --     gravação do autor, que antes descartaria a "entrega órfã".
  DELETE FROM public.categoria_anexos WHERE id = v_poster;
  v_orfaos := pg_temp.chamar(v_dono, 'aplicar_anexos', v_trab, '[]'::jsonb);
  IF NOT EXISTS (
    SELECT 1 FROM public.trabalho_anexos ta
     WHERE ta.trabalho_id = v_trab AND ta.anexo_id IS NULL AND ta.poster
       AND ta.valor = v_dono || '/poster-2.pdf'
  ) OR (v_dono || '/poster-2.pdf') = ANY (v_orfaos) THEN
    RAISE EXCEPTION 'FALHOU: apagar a exigência levou o pôster já entregue.';
  END IF;

  RAISE EXCEPTION 'ENSAIO OK — tudo desfeito, nenhum arquivo tocado.';
END $$;
