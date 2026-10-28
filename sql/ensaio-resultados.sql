-- Ensaio revertido da divulgação dos resultados (migration 20261027120000).
--
-- Exercita a fila DE VERDADE, no banco de produção, e desfaz tudo: o bloco
-- termina em RAISE EXCEPTION, que leva junto as contas, os trabalhos, os
-- pareceres, a data de divulgação e as reservas — inclusive as de autores
-- reais que a drenagem pegar durante o ensaio. Nenhum e-mail sai: quem envia
-- é o Apps Script, e ele nunca vê esta transação.
--
-- Como rodar: cole no SQL Editor do dashboard do Supabase (ou mande pela
-- Management API), DEPOIS de aplicar a migration.
-- Aprovado = o erro final diz "ENSAIO OK". Qualquer outra mensagem é a
-- asserção que falhou, e ela diz qual.
--
-- O mesmo arquivo roda no PGlite, sobre um stub do schema, antes da
-- migration ir para produção (ver a memória pglite-provar-sql).

DO $$
DECLARE
  -- Começa com "0" para cair cedo na ordem da fila; e .invalid não entrega nada.
  c_prefixo CONSTANT text := '0-ensaio-resultados-';
  c_dominio CONSTANT text := '@exemplo.invalid';
  v_a uuid := gen_random_uuid();  -- reenvio + aprovado          → prioridade 1
  v_b uuid := gen_random_uuid();  -- correções + aprovado        → prioridade 2
  v_c uuid := gen_random_uuid();  -- 4 trabalhos aprovados       → prioridade 3
  v_d uuid := gen_random_uuid();  -- reprovado                   → prioridade 4
  v_e uuid := gen_random_uuid();  -- aprovado + um em avaliação  → segurado
  v_trab  uuid;
  v_n     integer;
  v_saida text[];
  v_envio public.envios_resultados%ROWTYPE;
BEGIN
  -- Drena a fila inteira (lotes de 50) e devolve, NA ORDEM DE SAÍDA, os
  -- e-mails do ensaio. Drenar, e não buscar um lote só: com autores reais
  -- devidos, o ensaio poderia não caber no primeiro lote.
  CREATE FUNCTION pg_temp.ensaio_drenar()
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
      FOR r IN SELECT * FROM public.resultados_devidos(50) LOOP
        v_lote := v_lote + 1;
        IF r.autor_email LIKE '0-ensaio-resultados-%' THEN
          v_meus := v_meus || r.autor_email;
        END IF;
      END LOOP;
      EXIT WHEN v_lote = 0;
    END LOOP;
    RETURN v_meus;
  END $f$;

  -- O que o Apps Script faz depois do MailApp: fecha o envio reservado.
  CREATE FUNCTION pg_temp.ensaio_concluir(_autor uuid, _erro text)
  RETURNS integer LANGUAGE sql AS $f$
    SELECT public.concluir_envios(jsonb_build_array(jsonb_build_object(
      'id', (SELECT er.id FROM public.envios_resultados er
              WHERE er.autor_id = _autor AND er.status = 'reservado'),
      'erro', _erro)))
  $f$;

  -- Sem sessão (auth.uid() nulo), o trigger de proteção do trabalho devolve
  -- cedo, como em toda escrita de servidor: status e rodada entram direto.
  CREATE FUNCTION pg_temp.ensaio_trabalho(_dono uuid, _titulo text, _status text)
  RETURNS uuid LANGUAGE sql AS $f$
    INSERT INTO public.trabalhos (titulo, autores, owner_id, status)
    VALUES (_titulo, 'Ensaio', _dono, _status)
    RETURNING id
  $f$;

  -- As contas. O trigger de cadastro cria o profile com o nome dos metadados.
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_a, c_prefixo || 'a' || c_dominio, '{"nome": "Autor A"}'),
    (v_b, c_prefixo || 'b' || c_dominio, '{"nome": "Autor B"}'),
    (v_c, c_prefixo || 'c' || c_dominio, '{"nome": "Autor C"}'),
    (v_d, c_prefixo || 'd' || c_dominio, '{"nome": "Autor D"}'),
    (v_e, c_prefixo || 'e' || c_dominio, '{"nome": "Autor E"}');

  PERFORM pg_temp.ensaio_trabalho(v_a, 'Ensaio A1', 'aprovado');
  PERFORM pg_temp.ensaio_trabalho(v_a, 'Ensaio A2', 'resubmeter');
  PERFORM pg_temp.ensaio_trabalho(v_b, 'Ensaio B1', 'aprovado_correcoes');
  PERFORM pg_temp.ensaio_trabalho(v_b, 'Ensaio B2', 'aprovado');
  PERFORM pg_temp.ensaio_trabalho(v_c, 'Ensaio C2', 'aprovado');
  PERFORM pg_temp.ensaio_trabalho(v_c, 'Ensaio C3', 'aprovado');
  PERFORM pg_temp.ensaio_trabalho(v_c, 'Ensaio C4', 'aprovado');
  PERFORM pg_temp.ensaio_trabalho(v_d, 'Ensaio D1', 'reprovado');
  PERFORM pg_temp.ensaio_trabalho(v_e, 'Ensaio E1', 'aprovado');
  PERFORM pg_temp.ensaio_trabalho(v_e, 'Ensaio E2', 'em_avaliacao');

  -- O trabalho com notas: um parecer da rodada 1 (nota 1, não pode entrar na
  -- média) e dois da rodada 2 — um deles com uma nota que não é número.
  -- Média esperada: (5 + 4 + 4) / 3 = 4.33, de 2 pareceres.
  v_trab := pg_temp.ensaio_trabalho(v_c, 'Ensaio C1', 'pendente');
  INSERT INTO public.pareceres (trabalho_id, revisor_email, resultado, itens, rodada)
  VALUES (v_trab, '0-ensaio-revisor-1' || c_dominio, 'nao_aprovado',
          '[{"nota": 1}, {"nota": 1}]', 1);
  UPDATE public.trabalhos SET rodada = 2 WHERE id = v_trab;
  INSERT INTO public.pareceres (trabalho_id, revisor_email, resultado, itens, rodada)
  VALUES (v_trab, '0-ensaio-revisor-1' || c_dominio, 'aprovado',
          '[{"nota": 5}, {"nota": 4}]', 2),
         (v_trab, '0-ensaio-revisor-2' || c_dominio, 'aprovado',
          '[{"nota": 4}, {"nota": "x"}]', 2);
  -- O parecer recalcula o status (aplicar_decisao); a decisão vem por último.
  UPDATE public.trabalhos SET status = 'aprovado' WHERE id = v_trab;

  -- 1. Sem data: nada sai.
  UPDATE public.configuracoes SET resultados_divulgacao = NULL WHERE id;
  IF cardinality(pg_temp.ensaio_drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: saiu resultado sem data de divulgação.';
  END IF;

  -- 2. Uma hora à frente NA HORA DE BRASÍLIA: nada sai. Se a função lesse o
  --    momento como UTC, ele já teria passado há duas horas e sairia.
  UPDATE public.configuracoes
     SET resultados_divulgacao = (now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 hour'
   WHERE id;
  IF cardinality(pg_temp.ensaio_drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: saiu resultado antes da hora (o momento foi lido fora do fuso de Brasília?).';
  END IF;

  -- 3. Divulgado: um e-mail por autor, na ordem de urgência — e o autor com
  --    trabalho ainda em avaliação fica segurado.
  UPDATE public.configuracoes
     SET resultados_divulgacao = (now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 minute'
   WHERE id;
  v_saida := pg_temp.ensaio_drenar();
  IF v_saida IS DISTINCT FROM ARRAY[
       c_prefixo || 'a' || c_dominio, c_prefixo || 'b' || c_dominio,
       c_prefixo || 'c' || c_dominio, c_prefixo || 'd' || c_dominio] THEN
    RAISE EXCEPTION 'FALHOU: esperava a, b, c, d (reenvio, correções, aprovado, reprovado) e saiu %.', v_saida;
  END IF;

  IF (SELECT array_agg(er.prioridade ORDER BY er.autor_email)
        FROM public.envios_resultados er
       WHERE er.autor_id IN (v_a, v_b, v_c, v_d)) IS DISTINCT FROM ARRAY[1, 2, 3, 4]::smallint[] THEN
    RAISE EXCEPTION 'FALHOU: a prioridade gravada não é a do desfecho mais urgente.';
  END IF;

  SELECT * INTO v_envio FROM public.envios_resultados er WHERE er.autor_id = v_a;
  IF v_envio.trabalhos->0->>'status' IS DISTINCT FROM 'resubmeter' THEN
    RAISE EXCEPTION 'FALHOU: dentro do e-mail o trabalho mais urgente não vem primeiro: %.', v_envio.trabalhos;
  END IF;

  SELECT * INTO v_envio FROM public.envios_resultados er WHERE er.autor_id = v_c;
  IF jsonb_array_length(v_envio.trabalhos) <> 4 THEN
    RAISE EXCEPTION 'FALHOU: o e-mail do autor C não traz os 4 trabalhos: %.', v_envio.trabalhos;
  END IF;
  IF v_envio.autor_nome IS DISTINCT FROM 'Autor C'
     OR v_envio.autor_email IS DISTINCT FROM c_prefixo || 'c' || c_dominio THEN
    RAISE EXCEPTION 'FALHOU: nome ou e-mail do autor errados: % / %.', v_envio.autor_nome, v_envio.autor_email;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_envio.trabalhos) e
     WHERE e->>'titulo' = 'Ensaio C1'
       AND (e->>'media')::numeric = 4.33
       AND (e->>'pareceres')::integer = 2
  ) THEN
    RAISE EXCEPTION 'FALHOU: a média não é a da rodada corrente (esperava 4.33 de 2 pareceres): %.', v_envio.trabalhos;
  END IF;

  -- 4. A busca seguinte não pega ninguém de novo.
  IF cardinality(pg_temp.ensaio_drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: autor reservado de novo — "um e-mail por autor" não segurou.';
  END IF;

  -- 5. Enviado fica; uma confirmação repetida não reescreve nada.
  --    (Gravar e conferir em comandos SEPARADOS: numa expressão só, o SELECT
  --    usa o retrato de antes da função e não vê o que ela gravou.)
  v_n := pg_temp.ensaio_concluir(v_b, NULL);
  IF v_n <> 1
     OR (SELECT er.status FROM public.envios_resultados er WHERE er.autor_id = v_b) <> 'enviado' THEN
    RAISE EXCEPTION 'FALHOU: o envio confirmado não ficou como enviado.';
  END IF;
  IF public.concluir_envios(jsonb_build_array(jsonb_build_object(
       'id', (SELECT er.id FROM public.envios_resultados er WHERE er.autor_id = v_b),
       'erro', 'confirmação repetida'))) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: uma confirmação repetida reescreveu um envio já fechado.';
  END IF;
  IF cardinality(pg_temp.ensaio_drenar()) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: quem já recebeu entrou de novo na fila.';
  END IF;

  -- 6. Recusado pelo Google: volta sozinho para a fila — até a 3ª falha.
  FOR i IN 1..3 LOOP
    IF pg_temp.ensaio_concluir(v_a, 'Service unavailable') <> 1 THEN
      RAISE EXCEPTION 'FALHOU: a falha nº % não ficou registrada.', i;
    END IF;
    v_saida := pg_temp.ensaio_drenar();
    IF i < 3 AND v_saida IS DISTINCT FROM ARRAY[c_prefixo || 'a' || c_dominio] THEN
      RAISE EXCEPTION 'FALHOU: depois da falha nº % o autor não voltou para a fila (saiu %).', i, v_saida;
    END IF;
    IF i = 3 AND cardinality(v_saida) <> 0 THEN
      RAISE EXCEPTION 'FALHOU: depois de 3 falhas o autor continuou sendo tentado.';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.envios_resultados er
       WHERE er.autor_id = v_a AND er.status = 'falha' AND er.erro = 'Service unavailable') <> 3 THEN
    RAISE EXCEPTION 'FALHOU: as 3 falhas não ficaram no registro com a frase do Google.';
  END IF;

  -- 7. O segurado sai quando o último trabalho dele é decidido.
  UPDATE public.trabalhos SET status = 'reprovado'
   WHERE owner_id = v_e AND status = 'em_avaliacao';
  IF pg_temp.ensaio_drenar() IS DISTINCT FROM ARRAY[c_prefixo || 'e' || c_dominio] THEN
    RAISE EXCEPTION 'FALHOU: o autor segurado não saiu depois da última decisão.';
  END IF;
  IF (SELECT er.prioridade FROM public.envios_resultados er WHERE er.autor_id = v_e) <> 3 THEN
    RAISE EXCEPTION 'FALHOU: aprovado + reprovado deveria entrar na faixa do aprovado (3).';
  END IF;

  RAISE EXCEPTION 'ENSAIO OK — tudo desfeito, nenhum e-mail saiu.';
END $$;
