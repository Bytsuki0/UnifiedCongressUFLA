-- Ensaio revertido do cronograma de apresentações (migration 20261104120000).
--
-- Exercita o Salvar do AdminCA (`salvar_cronograma_apresentacoes`), a janela
-- pública (`apresentacoes_publicas`), a fila (`apresentacoes_devidas`) e a
-- conclusão (`concluir_envios`) DE VERDADE, no banco de produção, e desfaz
-- tudo: o bloco termina em RAISE EXCEPTION, que leva junto as contas, a
-- categoria, os trabalhos, os agendamentos e as reservas — inclusive as de
-- autores reais que a drenagem pegar durante o ensaio. Nenhum e-mail sai:
-- quem envia é o Apps Script, e ele nunca vê esta transação.
--
-- Como rodar: cole no SQL Editor do dashboard do Supabase (ou mande pela
-- Management API), DEPOIS de aplicar a migration.
-- Aprovado = o erro final diz "ENSAIO OK". Qualquer outra mensagem é a
-- asserção que falhou, e ela diz qual.
--
-- ⚠ Tudo aqui roda numa transação só, e nela `now()` não anda: a reserva, o
-- envio e o Salvar seguinte carimbam o MESMO instante. Onde a regra depende
-- de o tempo ter passado (a contagem de falhas recomeça no Salvar seguinte;
-- o envio antigo que falha não devolve à fila o trabalho já reservado pelo
-- novo), o ensaio recua os carimbos à mão um minuto — é o que diz cada passo.

DO $$
DECLARE
  c_prefixo CONSTANT text := '0-ensaio-apresentacoes-';
  c_dominio CONSTANT text := '@exemplo.invalid';
  v_staff uuid := gen_random_uuid();
  v_a     uuid := gen_random_uuid();  -- dois trabalhos aprovados
  v_b     uuid := gen_random_uuid();  -- um aprovado com correções
  v_c     uuid := gen_random_uuid();  -- um pendente
  v_cat   uuid;
  v_a1    uuid;
  v_a2    uuid;
  v_b1    uuid;
  v_c1    uuid;
  v_o1    uuid;  -- aprovado, cadastrado pela organização: sem dono
  v_n     integer;
  v_msg   text;
  v_saida text[];
  v_e1    uuid;
  v_e2    uuid;
  v_viu_autor integer;
  v_viu_staff integer;
  v_envio public.envios_apresentacoes%ROWTYPE;
BEGIN
  -- O Salvar do AdminCA COMO uma conta: o JWT é simulado só durante a
  -- chamada. Erro sobe como está.
  CREATE FUNCTION pg_temp.salvar(_uid uuid, _tipos jsonb, _itens jsonb)
  RETURNS integer LANGUAGE plpgsql AS $f$
  DECLARE v integer;
  BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    v := public.salvar_cronograma_apresentacoes(_tipos, _itens);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN v;
  END $f$;

  -- A mesma chamada, esperando a RECUSA: devolve a frase do erro, ou NULL
  -- se a chamada passou (o que, aqui, é sempre a falha). A exceção desfaz o
  -- que a chamada gravou — é o que deixa conferir que o lote é atômico.
  CREATE FUNCTION pg_temp.recusa(_uid uuid, _tipos jsonb, _itens jsonb)
  RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN
    PERFORM pg_temp.salvar(_uid, _tipos, _itens);
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN SQLERRM;
  END $f$;

  CREATE FUNCTION pg_temp.item(_trab uuid, _data text, _ini text, _fim text, _sala text)
  RETURNS jsonb LANGUAGE sql AS $f$
    SELECT jsonb_build_object('trabalho_id', _trab, 'data', _data,
                              'hora_inicio', _ini, 'hora_fim', _fim, 'sala', _sala)
  $f$;

  -- Linhas do ensaio na janela pública, e quantas delas com `meu`: como o
  -- visitante (NULL = sem sessão) ou como a conta dada.
  CREATE FUNCTION pg_temp.publicas(_uid uuid)
  RETURNS integer[] LANGUAGE plpgsql AS $f$
  DECLARE v integer[];
  BEGIN
    IF _uid IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims',
                         json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    END IF;
    SELECT ARRAY[count(*), count(*) FILTER (WHERE p.meu)]::integer[] INTO v
      FROM public.apresentacoes_publicas() p
     WHERE p.titulo LIKE 'Ensaio CA %';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN v;
  END $f$;

  -- Drena a fila inteira (lotes de 50) e devolve, em ordem alfabética, os
  -- e-mails do ensaio. Drenar, e não buscar um lote só: com autores reais
  -- na fila, o ensaio poderia não caber no primeiro lote.
  CREATE FUNCTION pg_temp.drenar()
  RETURNS text[] LANGUAGE plpgsql AS $f$
  DECLARE
    v_lote   integer;
    v_meus   text[] := '{}';
    v_voltas integer := 0;
    r        record;
  BEGIN
    LOOP
      -- Busca que não esvazia = reserva que não segura: o mesmo autor
      -- voltaria em toda busca e receberia um e-mail por minuto.
      v_voltas := v_voltas + 1;
      IF v_voltas > 1000 THEN
        RAISE EXCEPTION 'FALHOU: a fila não esvazia — a reserva não está segurando.';
      END IF;
      v_lote := 0;
      FOR r IN SELECT * FROM public.apresentacoes_devidas(50) LOOP
        v_lote := v_lote + 1;
        IF r.autor_email LIKE '0-ensaio-apresentacoes-%' THEN
          v_meus := v_meus || r.autor_email;
        END IF;
      END LOOP;
      EXIT WHEN v_lote = 0;
    END LOOP;
    RETURN (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(v_meus) AS x);
  END $f$;

  -- O envio que o Apps Script ainda não fechou (o ensaio fecha cada um antes
  -- de drenar de novo — exceto no passo 12, que trata os dois à mão).
  CREATE FUNCTION pg_temp.reservado(_autor uuid)
  RETURNS uuid LANGUAGE sql AS $f$
    SELECT ea.id FROM public.envios_apresentacoes ea
     WHERE ea.autor_id = _autor AND ea.status = 'reservado'
  $f$;

  -- O que o Apps Script faz depois do MailApp: fecha o envio.
  CREATE FUNCTION pg_temp.concluir(_envio uuid, _erro text)
  RETURNS integer LANGUAGE sql AS $f$
    SELECT public.concluir_envios(jsonb_build_array(jsonb_build_object('id', _envio, 'erro', _erro)))
  $f$;

  -- As contas. O trigger de cadastro cria o profile; `email_confirmado()`
  -- lê `profiles.email_confirmado_em`. `avaliador` faz da conta organização.
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_staff, c_prefixo || 'staff' || c_dominio, '{"nome": "Co-chair"}'),
    (v_a,     c_prefixo || 'a'     || c_dominio, '{"nome": "Autor A"}'),
    (v_b,     c_prefixo || 'b'     || c_dominio, '{"nome": "Autor B"}'),
    (v_c,     c_prefixo || 'c'     || c_dominio, '{"nome": "Autor C"}');
  UPDATE public.profiles SET email_confirmado_em = now()
   WHERE id IN (v_staff, v_a, v_b, v_c);
  INSERT INTO public.user_roles (user_id, role) VALUES (v_staff, 'avaliador');

  INSERT INTO public.categorias (nome)
  VALUES ('0 Ensaio CA ' || gen_random_uuid())
  RETURNING id INTO v_cat;

  -- Sem sessão (auth.uid() nulo), o trigger de proteção do trabalho devolve
  -- cedo, como em toda escrita de servidor: o status entra direto.
  INSERT INTO public.trabalhos (titulo, autores, owner_id, categoria_id, status)
  VALUES ('Ensaio CA A1', 'Ensaio', v_a, v_cat, 'aprovado') RETURNING id INTO v_a1;
  INSERT INTO public.trabalhos (titulo, autores, owner_id, categoria_id, status)
  VALUES ('Ensaio CA A2', 'Ensaio', v_a, v_cat, 'aprovado') RETURNING id INTO v_a2;
  INSERT INTO public.trabalhos (titulo, autores, owner_id, categoria_id, status)
  VALUES ('Ensaio CA B1', 'Ensaio', v_b, v_cat, 'aprovado_correcoes') RETURNING id INTO v_b1;
  INSERT INTO public.trabalhos (titulo, autores, owner_id, categoria_id, status)
  VALUES ('Ensaio CA C1', 'Ensaio', v_c, v_cat, 'pendente') RETURNING id INTO v_c1;
  INSERT INTO public.trabalhos (titulo, autores, owner_id, categoria_id, status)
  VALUES ('Ensaio CA O1', 'Ensaio', NULL, v_cat, 'aprovado') RETURNING id INTO v_o1;

  -- 1. Só a organização salva.
  v_msg := pg_temp.recusa(v_a, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a1, '2026-11-20', '14:00', '14:15', 'Sala 1')));
  IF v_msg IS NULL OR v_msg NOT LIKE '%Acesso negado%' THEN
    RAISE EXCEPTION 'FALHOU: um autor salvou o cronograma de apresentações (%).', coalesce(v_msg, 'passou');
  END IF;

  -- 2. Trabalho não aprovado é recusado — e leva junto o lote inteiro.
  v_msg := pg_temp.recusa(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a1, '2026-11-20', '14:00', '14:15', 'Sala 1'),
    pg_temp.item(v_c1, '2026-11-20', '14:15', '14:30', 'Sala 1')));
  IF v_msg IS NULL OR v_msg NOT LIKE '%não está aprovado%' THEN
    RAISE EXCEPTION 'FALHOU: trabalho pendente entrou no cronograma (%).', coalesce(v_msg, 'passou');
  END IF;
  IF EXISTS (SELECT 1 FROM public.apresentacoes WHERE trabalho_id = v_a1) THEN
    RAISE EXCEPTION 'FALHOU: o lote recusado gravou o item bom — o Salvar deixou de ser atômico.';
  END IF;

  -- 3. Horário invertido, sala vazia e dia que não existe: recusados.
  v_msg := pg_temp.recusa(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a1, '2026-11-20', '14:15', '14:15', 'Sala 1')));
  IF v_msg IS NULL OR v_msg NOT LIKE '%depois do início%' THEN
    RAISE EXCEPTION 'FALHOU: fim igual ao início aceito (%).', coalesce(v_msg, 'passou');
  END IF;
  v_msg := pg_temp.recusa(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a1, '2026-11-20', '14:00', '14:15', '   ')));
  IF v_msg IS NULL OR v_msg NOT LIKE '%Preencha%' THEN
    RAISE EXCEPTION 'FALHOU: sala vazia aceita (%).', coalesce(v_msg, 'passou');
  END IF;
  v_msg := pg_temp.recusa(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a1, '2026-02-30', '14:00', '14:15', 'Sala 1')));
  IF v_msg IS NULL OR v_msg NOT LIKE '%inválido%' THEN
    RAISE EXCEPTION 'FALHOU: dia 30 de fevereiro aceito (%).', coalesce(v_msg, 'passou');
  END IF;

  -- 4. O primeiro Salvar: o tipo da categoria e quatro agendamentos. Todos
  --    são informação nova — inclusive o do trabalho sem dono.
  v_n := pg_temp.salvar(v_staff,
    jsonb_build_array(jsonb_build_object('categoria_id', v_cat, 'tipo', '  Pôster ')),
    jsonb_build_array(
      pg_temp.item(v_a1, '2026-11-20', '14:00', '14:15', 'Sala 1'),
      pg_temp.item(v_a2, '2026-11-20', '14:15', '14:30', 'Sala 1'),
      pg_temp.item(v_b1, '2026-11-21', '09:00', '09:20', 'Auditório'),
      pg_temp.item(v_o1, '2026-11-21', '09:20', '09:40', 'Auditório')));
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'FALHOU: o primeiro Salvar marcou % trabalho(s), e não 4.', v_n;
  END IF;
  IF (SELECT tipo_apresentacao FROM public.categorias WHERE id = v_cat) IS DISTINCT FROM 'Pôster' THEN
    RAISE EXCEPTION 'FALHOU: o tipo da categoria não foi gravado (aparado) como "Pôster".';
  END IF;
  IF (SELECT count(*) FROM public.apresentacoes
       WHERE trabalho_id IN (v_a1, v_a2, v_b1, v_o1)
         AND aviso_solicitado_em IS NOT NULL AND aviso_reservado_em IS NULL) <> 4 THEN
    RAISE EXCEPTION 'FALHOU: os quatro agendamentos não entraram na fila.';
  END IF;

  -- 5. A janela pública: o visitante vê os quatro e nenhum como "meu"; cada
  --    autor vê só os dele marcados. Decisão revista some da vista.
  IF pg_temp.publicas(NULL) IS DISTINCT FROM ARRAY[4, 0] THEN
    RAISE EXCEPTION 'FALHOU: o visitante viu % (esperava 4 linhas, nenhuma "minha").', pg_temp.publicas(NULL);
  END IF;
  IF pg_temp.publicas(v_a) IS DISTINCT FROM ARRAY[4, 2] THEN
    RAISE EXCEPTION 'FALHOU: o autor A viu % (esperava 4 linhas, 2 dele).', pg_temp.publicas(v_a);
  END IF;
  IF pg_temp.publicas(v_b) IS DISTINCT FROM ARRAY[4, 1] THEN
    RAISE EXCEPTION 'FALHOU: o autor B viu % (esperava 4 linhas, 1 dele).', pg_temp.publicas(v_b);
  END IF;
  UPDATE public.trabalhos SET status = 'reprovado' WHERE id = v_b1;
  IF pg_temp.publicas(NULL) IS DISTINCT FROM ARRAY[3, 0] THEN
    RAISE EXCEPTION 'FALHOU: trabalho não aprovado continuou na janela pública.';
  END IF;
  UPDATE public.trabalhos SET status = 'aprovado_correcoes' WHERE id = v_b1;

  -- 6. A tabela, pela RLS: o autor não a lê direto (lê pela janela); a
  --    organização lê tudo.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_viu_autor FROM public.apresentacoes
   WHERE trabalho_id IN (v_a1, v_a2, v_b1, v_o1);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_viu_staff FROM public.apresentacoes
   WHERE trabalho_id IN (v_a1, v_a2, v_b1, v_o1);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_viu_autor <> 0 THEN
    RAISE EXCEPTION 'FALHOU: o autor leu % linha(s) de apresentacoes direto da tabela.', v_viu_autor;
  END IF;
  IF v_viu_staff <> 4 THEN
    RAISE EXCEPTION 'FALHOU: a organização leu % linha(s) de apresentacoes, e não 4.', v_viu_staff;
  END IF;

  -- 7. A fila: um e-mail por autor, com todos os trabalhos dele. O trabalho
  --    sem dono não tem a quem avisar e fica na fila sem sair.
  v_saida := pg_temp.drenar();
  IF v_saida IS DISTINCT FROM ARRAY[c_prefixo || 'a' || c_dominio, c_prefixo || 'b' || c_dominio] THEN
    RAISE EXCEPTION 'FALHOU: esperava um e-mail para A e um para B, e saiu %.', v_saida;
  END IF;
  SELECT * INTO v_envio FROM public.envios_apresentacoes WHERE id = pg_temp.reservado(v_a);
  IF jsonb_array_length(v_envio.trabalhos) <> 2
     OR v_envio.trabalhos->0->>'titulo' IS DISTINCT FROM 'Ensaio CA A1'
     OR v_envio.trabalhos->0->>'tipo' IS DISTINCT FROM 'Pôster'
     OR v_envio.trabalhos->0->>'data' IS DISTINCT FROM '2026-11-20'
     OR v_envio.trabalhos->0->>'hora_inicio' IS DISTINCT FROM '14:00'
     OR v_envio.trabalhos->0->>'hora_fim' IS DISTINCT FROM '14:15'
     OR v_envio.trabalhos->0->>'sala' IS DISTINCT FROM 'Sala 1'
     OR (v_envio.trabalhos->0->>'alteracao')::boolean
     OR v_envio.autor_nome IS DISTINCT FROM 'Autor A' THEN
    RAISE EXCEPTION 'FALHOU: o e-mail do autor A não diz o que devia: % / %.', v_envio.autor_nome, v_envio.trabalhos;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.apresentacoes
                  WHERE trabalho_id = v_o1
                    AND aviso_solicitado_em IS NOT NULL AND aviso_reservado_em IS NULL) THEN
    RAISE EXCEPTION 'FALHOU: o trabalho sem dono saiu da fila sem ter a quem avisar.';
  END IF;

  -- 8. A busca seguinte não pega ninguém de novo; o Apps Script fecha os dois.
  IF cardinality(pg_temp.drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: autor reservado de novo — a reserva não segurou.';
  END IF;
  -- (Gravar e conferir em comandos SEPARADOS: numa expressão só, o SELECT
  -- usa o retrato de antes da função e não vê o que ela gravou.)
  v_n := pg_temp.concluir(pg_temp.reservado(v_a), NULL) + pg_temp.concluir(pg_temp.reservado(v_b), NULL);
  IF v_n <> 2
     OR (SELECT count(*) FROM public.envios_apresentacoes
          WHERE autor_id IN (v_a, v_b) AND status = 'enviado') <> 2 THEN
    RAISE EXCEPTION 'FALHOU: os dois envios confirmados não ficaram como enviados.';
  END IF;

  -- 9. Salvar sem mudar nada — nem o tipo — não manda nada.
  v_n := pg_temp.salvar(v_staff,
    jsonb_build_array(jsonb_build_object('categoria_id', v_cat, 'tipo', 'Pôster')),
    jsonb_build_array(
      pg_temp.item(v_a1, '2026-11-20', '14:00', '14:15', 'Sala 1'),
      pg_temp.item(v_b1, '2026-11-21', '09:00:00', '09:20:00', 'Auditório')));
  IF v_n <> 0 OR cardinality(pg_temp.drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: salvar sem mudança marcou % trabalho(s) ou pôs alguém na fila.', v_n;
  END IF;

  -- 10. Mudou a sala: só aquele trabalho, e o e-mail diz que é alteração.
  v_n := pg_temp.salvar(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a1, '2026-11-20', '14:00', '14:15', 'Sala 2')));
  IF v_n <> 1 OR pg_temp.drenar() IS DISTINCT FROM ARRAY[c_prefixo || 'a' || c_dominio] THEN
    RAISE EXCEPTION 'FALHOU: a troca de sala não pôs só o autor A na fila (marcou %).', v_n;
  END IF;
  SELECT * INTO v_envio FROM public.envios_apresentacoes WHERE id = pg_temp.reservado(v_a);
  IF jsonb_array_length(v_envio.trabalhos) <> 1
     OR v_envio.trabalhos->0->>'sala' IS DISTINCT FROM 'Sala 2'
     OR NOT (v_envio.trabalhos->0->>'alteracao')::boolean THEN
    RAISE EXCEPTION 'FALHOU: o e-mail da troca de sala não traz só o trabalho alterado, como alteração: %.', v_envio.trabalhos;
  END IF;
  PERFORM pg_temp.concluir(v_envio.id, NULL);

  -- 11. Mudou o tipo da categoria: todo trabalho agendado dela é informação
  --     nova. O e-mail já sai com o tipo novo.
  v_n := pg_temp.salvar(v_staff,
    jsonb_build_array(jsonb_build_object('categoria_id', v_cat, 'tipo', 'Apresentação oral')),
    '[]'::jsonb);
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'FALHOU: a troca do tipo marcou % trabalho(s), e não os 4 agendados.', v_n;
  END IF;
  IF pg_temp.drenar() IS DISTINCT FROM ARRAY[c_prefixo || 'a' || c_dominio, c_prefixo || 'b' || c_dominio] THEN
    RAISE EXCEPTION 'FALHOU: a troca do tipo não avisou A e B.';
  END IF;
  SELECT * INTO v_envio FROM public.envios_apresentacoes WHERE id = pg_temp.reservado(v_a);
  IF (SELECT count(*) FROM jsonb_array_elements(v_envio.trabalhos) x
       WHERE x->>'tipo' = 'Apresentação oral') <> 2 THEN
    RAISE EXCEPTION 'FALHOU: o e-mail da troca do tipo não traz o tipo novo: %.', v_envio.trabalhos;
  END IF;
  PERFORM pg_temp.concluir(v_envio.id, NULL);

  -- 12. Recusado pelo Google: volta sozinho para a fila — até a 3ª falha.
  FOR i IN 1..3 LOOP
    IF pg_temp.concluir(pg_temp.reservado(v_b), 'Service unavailable') <> 1 THEN
      RAISE EXCEPTION 'FALHOU: a falha nº % não ficou registrada.', i;
    END IF;
    v_saida := pg_temp.drenar();
    IF i < 3 AND v_saida IS DISTINCT FROM ARRAY[c_prefixo || 'b' || c_dominio] THEN
      RAISE EXCEPTION 'FALHOU: depois da falha nº % o autor B não voltou para a fila (saiu %).', i, v_saida;
    END IF;
    IF i = 3 AND cardinality(v_saida) <> 0 THEN
      RAISE EXCEPTION 'FALHOU: depois de 3 falhas o autor B continuou sendo tentado.';
    END IF;
  END LOOP;

  --     Um Salvar posterior recomeça a contagem. "Posterior" pede tempo: as
  --     falhas recuam um minuto (ver o aviso do topo).
  UPDATE public.envios_apresentacoes SET criado_em = criado_em - interval '1 minute'
   WHERE autor_id = v_b AND status = 'falha';
  v_n := pg_temp.salvar(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_b1, '2026-11-21', '09:00', '09:20', 'Auditório B')));
  IF v_n <> 1 OR pg_temp.drenar() IS DISTINCT FROM ARRAY[c_prefixo || 'b' || c_dominio] THEN
    RAISE EXCEPTION 'FALHOU: o Salvar depois das 3 falhas não devolveu o autor B à fila.';
  END IF;
  PERFORM pg_temp.concluir(pg_temp.reservado(v_b), NULL);

  -- 13. Mudou de novo enquanto o e-mail estava no ar: o envio novo sai com a
  --     informação nova, e a falha do antigo não mexe no trabalho já
  --     reservado pelo novo. O envio antigo recua um minuto, junto com a
  --     reserva dele (ver o aviso do topo).
  PERFORM pg_temp.salvar(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a2, '2026-11-20', '14:15', '14:30', 'Sala X')));
  PERFORM pg_temp.drenar();
  v_e1 := pg_temp.reservado(v_a);
  UPDATE public.envios_apresentacoes SET criado_em = criado_em - interval '1 minute' WHERE id = v_e1;
  UPDATE public.apresentacoes
     SET aviso_solicitado_em = aviso_solicitado_em - interval '1 minute',
         aviso_reservado_em  = aviso_reservado_em  - interval '1 minute'
   WHERE trabalho_id = v_a2;

  PERFORM pg_temp.salvar(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a2, '2026-11-20', '14:15', '14:30', 'Sala Y')));
  IF pg_temp.drenar() IS DISTINCT FROM ARRAY[c_prefixo || 'a' || c_dominio] THEN
    RAISE EXCEPTION 'FALHOU: a mudança feita com o e-mail no ar não pôs o autor A de novo na fila.';
  END IF;
  SELECT ea.id INTO v_e2 FROM public.envios_apresentacoes ea
   WHERE ea.autor_id = v_a AND ea.status = 'reservado' AND ea.id <> v_e1;
  IF v_e2 IS NULL THEN
    RAISE EXCEPTION 'FALHOU: o segundo envio do autor A não foi reservado.';
  END IF;

  PERFORM pg_temp.concluir(v_e1, 'Service unavailable');
  IF (SELECT aviso_reservado_em FROM public.apresentacoes WHERE trabalho_id = v_a2) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: a falha do envio antigo devolveu à fila o trabalho já reservado pelo novo.';
  END IF;
  IF cardinality(pg_temp.drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: o trabalho saiu de novo com o envio novo ainda no ar.';
  END IF;
  IF (SELECT ea.trabalhos->0->>'sala' FROM public.envios_apresentacoes ea WHERE ea.id = v_e2)
     IS DISTINCT FROM 'Sala Y' THEN
    RAISE EXCEPTION 'FALHOU: o envio novo não traz a sala nova.';
  END IF;
  PERFORM pg_temp.concluir(v_e2, NULL);

  -- 14. Tirar do cronograma: some da janela pública e não manda e-mail.
  v_n := pg_temp.salvar(v_staff, '[]'::jsonb, jsonb_build_array(
    jsonb_build_object('trabalho_id', v_a1, 'remover', true)));
  IF v_n <> 0 OR cardinality(pg_temp.drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: tirar do cronograma marcou % trabalho(s) ou mandou e-mail.', v_n;
  END IF;
  IF pg_temp.publicas(NULL) IS DISTINCT FROM ARRAY[3, 0] THEN
    RAISE EXCEPTION 'FALHOU: o trabalho tirado do cronograma continuou na janela pública.';
  END IF;

  -- 15. Decisão revista depois de marcada a mudança: o e-mail não sai, a
  --     janela esconde, e o trabalho não volta a ser agendado.
  v_n := pg_temp.salvar(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a2, '2026-11-20', '14:15', '14:30', 'Sala Z')));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALHOU: a troca de sala do A2 marcou % trabalho(s).', v_n;
  END IF;
  UPDATE public.trabalhos SET status = 'reprovado' WHERE id = v_a2;
  IF cardinality(pg_temp.drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: saiu e-mail de apresentação de trabalho que deixou de ser aprovado.';
  END IF;
  IF pg_temp.publicas(NULL) IS DISTINCT FROM ARRAY[2, 0] THEN
    RAISE EXCEPTION 'FALHOU: o trabalho reprovado continuou na janela pública.';
  END IF;
  v_msg := pg_temp.recusa(v_staff, '[]'::jsonb, jsonb_build_array(
    pg_temp.item(v_a2, '2026-11-20', '14:15', '14:30', 'Sala 1')));
  IF v_msg IS NULL OR v_msg NOT LIKE '%não está aprovado%' THEN
    RAISE EXCEPTION 'FALHOU: trabalho reprovado foi reagendado (%).', coalesce(v_msg, 'passou');
  END IF;

  RAISE EXCEPTION 'ENSAIO OK — tudo desfeito, nenhum e-mail saiu.';
END $$;
