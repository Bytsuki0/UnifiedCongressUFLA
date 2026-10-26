-- ============================================================
-- Registro dos e-mails aos revisores + reenvio pelo botão
-- ------------------------------------------------------------
-- Na 20261014120000, "avisado" queria dizer "o Apps Script RESERVOU": a
-- marca saía no mesmo UPDATE que entregava a fila, ANTES de o MailApp
-- tentar enviar. A tela mostrava tudo como enviado, um lote perdido entre
-- reservar e enviar sumia em silêncio, e o motivo de uma recusa não ficava
-- em lugar nenhum.
--
-- Agora cada e-mail é uma linha de `envios_revisores`: nasce 'reservado'
-- na busca (`emails_devidos`) e o Apps Script a fecha como 'enviado' ou
-- 'falha', com a frase do Google, por `concluir_envios`. É a confirmação
-- em duas fases que o ponytail da 20261014120000 previa. Linha que fica
-- 'reservado' = lote perdido, e agora aparece na tela.
--
-- ⚠ 'enviado' = o Google ACEITOU o envio. Endereço que não existe no
--   destino volta depois como "Delivery Status Notification" na caixa de
--   entrada de congressoparaiso@ufla.br: o MailApp não lê a caixa, de
--   propósito (só tem permissão de enviar).
--
-- E o botão de Atribuições ganha `_reenviar`: manda de novo a quem já
-- recebeu, em vez de só a quem nunca foi avisado.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. O registro
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.envios_revisores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          text NOT NULL CHECK (tipo IN ('atribuicao', 'lembrete', 'atraso')),
  revisor_email text NOT NULL,
  revisor_nome  text,
  -- Sem FK (é array): remover a associação não apaga o histórico do envio.
  associacoes   uuid[] NOT NULL,
  -- Cópia: o que o e-mail DISSE, mesmo que o título mude depois.
  titulos       text[] NOT NULL,
  status        text NOT NULL DEFAULT 'reservado'
                CHECK (status IN ('reservado', 'enviado', 'falha')),
  erro          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  concluido_em  timestamptz
);

CREATE INDEX IF NOT EXISTS envios_revisores_criado_em_idx
  ON public.envios_revisores (criado_em DESC);

-- Leitura: a organização, na tela de Atribuições. Escrita: policy nenhuma —
-- só `emails_devidos` e `concluir_envios` (SECURITY DEFINER) gravam aqui.
ALTER TABLE public.envios_revisores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "envios_revisores select" ON public.envios_revisores;
CREATE POLICY "envios_revisores select" ON public.envios_revisores
  FOR SELECT TO authenticated
  USING (public.is_event_staff() AND public.email_confirmado());
-- O ALTER DEFAULT PRIVILEGES do projeto concede tudo a anon.
REVOKE ALL ON public.envios_revisores FROM anon;

-- ------------------------------------------------------------
-- 2. O botão de Atribuições, agora com reenvio
-- ------------------------------------------------------------
-- `_reenviar = false`: como antes, só quem nunca foi avisado (inclusive
-- quem teve a designação RECUSADA pelo Google — ver concluir_envios).
-- `_reenviar = true`: toda associação que ainda deve parecer volta para a
-- fila, já avisada ou não. Quem já registrou o parecer não recebe.
--
-- Reenviar zera `aviso_enviado_em`, que é a régua do "só cobra quem
-- sabia": reenviado dentro da janela do lembrete, o revisor não recebe o
-- lembrete — acabou de receber a designação, que já traz o prazo.
--
-- A assinatura mudou: sem o DROP, `rpc('solicitar_avisos_atribuicao')`
-- sem argumento ficaria ambíguo entre as duas versões.
DROP FUNCTION IF EXISTS public.solicitar_avisos_atribuicao();
CREATE OR REPLACE FUNCTION public.solicitar_avisos_atribuicao(_reenviar boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revisores integer;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  WITH marcadas AS (
    UPDATE public.trabalho_revisores tr
       SET aviso_solicitado_em = now(),
           aviso_enviado_em    = NULL
     WHERE (tr.aviso_solicitado_em IS NULL OR coalesce(_reenviar, false))
       AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
    RETURNING lower(tr.revisor_email) AS email
  )
  SELECT count(DISTINCT m.email) INTO v_revisores FROM marcadas m;

  -- Revisores, não associações: é quantos e-mails vão sair.
  RETURN v_revisores;
END; $$;
REVOKE ALL ON FUNCTION public.solicitar_avisos_atribuicao(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solicitar_avisos_atribuicao(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.solicitar_avisos_atribuicao(boolean) TO authenticated;

-- ------------------------------------------------------------
-- 3. A fila — agora cada e-mail reservado vira uma linha do registro
-- ------------------------------------------------------------
-- A regra é a mesma da 20261014120000 (designação, lembrete, atraso; "só
-- cobra quem sabia"; a reserva no WHERE do próprio UPDATE). O que muda: cada
-- grupo (tipo, revisor) é INSERIDO em `envios_revisores` como 'reservado', e
-- a função devolve o `envio_id` com que o Apps Script vai fechá-lo.
--
-- O tipo de retorno mudou (coluna nova), e CREATE OR REPLACE não troca isso.
DROP FUNCTION IF EXISTS public.emails_devidos(integer);
CREATE FUNCTION public.emails_devidos(_limite integer DEFAULT 20)
RETURNS TABLE(
  envio_id      uuid,
  tipo          text,
  revisor_email text,
  revisor_nome  text,
  associacoes   uuid[],
  titulos       text[],
  prazo         date
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
-- Os nomes do RETURNS TABLE também são variáveis aqui dentro e colidem com
-- colunas de trabalho_revisores e de envios_revisores: toda coluna abaixo vai
-- qualificada pelo alias.
DECLARE
  v_resta  integer := least(greatest(coalesce(_limite, 20), 1), 50);
  v_prazo  date;
  v_horas  integer;
  v_fim    timestamptz;
  v_janela timestamptz;
  v_emails text[];
  v_ids    uuid[] := '{}';
BEGIN
  SELECT c.revisoes_encerramento, c.alerta_horas
    INTO v_prazo, v_horas
    FROM public.configuracoes c
   WHERE c.id;

  -- Fim do último dia do prazo em Lavras: ponta inclusiva, como o prazo de
  -- submissão. NULL quando não há prazo — e aí só a designação sai.
  v_fim    := (v_prazo + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_janela := v_fim - make_interval(hours => v_horas);

  -- a) Designação: o co-chair liberou e o e-mail ainda não saiu.
  SELECT array_agg(s.email) INTO v_emails FROM (
    SELECT DISTINCT lower(tr.revisor_email) AS email
      FROM public.trabalho_revisores tr
     WHERE tr.aviso_solicitado_em IS NOT NULL
       AND tr.aviso_enviado_em IS NULL
       AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
     ORDER BY 1
     LIMIT v_resta
  ) s;

  IF v_emails IS NOT NULL THEN
    WITH m AS (
      UPDATE public.trabalho_revisores tr
         SET aviso_enviado_em = now()
       WHERE lower(tr.revisor_email) = ANY (v_emails)
         AND tr.aviso_solicitado_em IS NOT NULL
         AND tr.aviso_enviado_em IS NULL
         AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
      RETURNING tr.id, lower(tr.revisor_email) AS email, tr.revisor_nome AS nome, tr.trabalho_id
    ), e AS (
      INSERT INTO public.envios_revisores AS en
             (tipo, revisor_email, revisor_nome, associacoes, titulos)
      SELECT 'atribuicao', m.email, max(m.nome), array_agg(m.id),
             array_agg(t.titulo ORDER BY t.titulo)
        FROM m JOIN public.trabalhos t ON t.id = m.trabalho_id
       GROUP BY m.email
      RETURNING en.id
    )
    SELECT v_ids || array_agg(e.id) INTO v_ids FROM e;
    v_resta := v_resta - cardinality(v_emails);
  END IF;

  IF v_prazo IS NOT NULL AND v_resta > 0 THEN
    -- b) Lembrete: dentro da janela [fim − alerta_horas, fim), uma vez por prazo.
    IF now() >= v_janela AND now() < v_fim THEN
      SELECT array_agg(s.email) INTO v_emails FROM (
        SELECT DISTINCT lower(tr.revisor_email) AS email
          FROM public.trabalho_revisores tr
         WHERE tr.aviso_enviado_em < v_janela
           AND tr.lembrete_prazo IS DISTINCT FROM v_prazo
           AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
         ORDER BY 1
         LIMIT v_resta
      ) s;

      IF v_emails IS NOT NULL THEN
        WITH m AS (
          UPDATE public.trabalho_revisores tr
             SET lembrete_prazo = v_prazo
           WHERE lower(tr.revisor_email) = ANY (v_emails)
             AND tr.aviso_enviado_em < v_janela
             AND tr.lembrete_prazo IS DISTINCT FROM v_prazo
             AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
          RETURNING tr.id, lower(tr.revisor_email) AS email, tr.revisor_nome AS nome, tr.trabalho_id
        ), e AS (
          INSERT INTO public.envios_revisores AS en
                 (tipo, revisor_email, revisor_nome, associacoes, titulos)
          SELECT 'lembrete', m.email, max(m.nome), array_agg(m.id),
                 array_agg(t.titulo ORDER BY t.titulo)
            FROM m JOIN public.trabalhos t ON t.id = m.trabalho_id
           GROUP BY m.email
          RETURNING en.id
        )
        SELECT v_ids || array_agg(e.id) INTO v_ids FROM e;
      END IF;
    END IF;

    -- c) Atraso: o prazo venceu e o parecer não veio. Uma vez por prazo.
    IF now() >= v_fim THEN
      SELECT array_agg(s.email) INTO v_emails FROM (
        SELECT DISTINCT lower(tr.revisor_email) AS email
          FROM public.trabalho_revisores tr
         WHERE tr.aviso_enviado_em < v_fim
           AND tr.atraso_prazo IS DISTINCT FROM v_prazo
           AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
         ORDER BY 1
         LIMIT v_resta
      ) s;

      IF v_emails IS NOT NULL THEN
        WITH m AS (
          UPDATE public.trabalho_revisores tr
             SET atraso_prazo = v_prazo
           WHERE lower(tr.revisor_email) = ANY (v_emails)
             AND tr.aviso_enviado_em < v_fim
             AND tr.atraso_prazo IS DISTINCT FROM v_prazo
             AND public._parecer_pendente(tr.trabalho_id, tr.revisor_email, tr.rodada)
          RETURNING tr.id, lower(tr.revisor_email) AS email, tr.revisor_nome AS nome, tr.trabalho_id
        ), e AS (
          INSERT INTO public.envios_revisores AS en
                 (tipo, revisor_email, revisor_nome, associacoes, titulos)
          SELECT 'atraso', m.email, max(m.nome), array_agg(m.id),
                 array_agg(t.titulo ORDER BY t.titulo)
            FROM m JOIN public.trabalhos t ON t.id = m.trabalho_id
           GROUP BY m.email
          RETURNING en.id
        )
        SELECT v_ids || array_agg(e.id) INTO v_ids FROM e;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
    SELECT en.id, en.tipo, en.revisor_email, en.revisor_nome, en.associacoes, en.titulos, v_prazo
      FROM public.envios_revisores en
     WHERE en.id = ANY (v_ids);
END; $$;
-- Só a Edge Function (service_role) busca a fila: buscar é reservar.
REVOKE ALL ON FUNCTION public.emails_devidos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.emails_devidos(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emails_devidos(integer) TO service_role;

-- ------------------------------------------------------------
-- 4. O Apps Script fecha cada envio — substitui `devolver_emails`
-- ------------------------------------------------------------
-- `_resultados` = [{ "id": envio_id, "erro": null | "frase do Google" }].
-- Só fecha linha ainda 'reservado' (a mesma confirmação chegando duas vezes
-- não reescreve nada) e devolve quantas fechou.
--
-- Falha de designação NÃO volta sozinha para a fila: a associação volta a
-- "nunca avisada", e o próximo clique no botão a pega. Endereço recusado
-- falharia de novo a cada minuto, para sempre — e com `aviso_solicitado_em`
-- antigo ainda acenderia o aviso de "fila parada". Lembrete e atraso não têm
-- botão, e falha deles é instabilidade (o endereço já passou na designação):
-- esses voltam para a fila e saem no minuto seguinte, como antes.
CREATE OR REPLACE FUNCTION public.concluir_envios(_resultados jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  r   record;
BEGIN
  FOR r IN
    UPDATE public.envios_revisores en
       SET status       = CASE WHEN x.erro IS NULL THEN 'enviado' ELSE 'falha' END,
           erro         = x.erro,
           concluido_em = now()
      FROM (SELECT (j->>'id')::uuid AS id,
                   nullif(left(j->>'erro', 500), '') AS erro
              FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) j) x
     WHERE en.id = x.id
       AND en.status = 'reservado'
    RETURNING en.tipo, en.associacoes, en.status
  LOOP
    v_n := v_n + 1;
    CONTINUE WHEN r.status = 'enviado';

    IF r.tipo = 'atribuicao' THEN
      -- `aviso_enviado_em IS NOT NULL`: se o co-chair reenviou enquanto este
      -- envio estava no ar, a associação já está de volta à fila — não a tira.
      UPDATE public.trabalho_revisores tr
         SET aviso_solicitado_em = NULL, aviso_enviado_em = NULL
       WHERE tr.id = ANY (r.associacoes)
         AND tr.aviso_enviado_em IS NOT NULL;
    ELSIF r.tipo = 'lembrete' THEN
      UPDATE public.trabalho_revisores tr SET lembrete_prazo = NULL
       WHERE tr.id = ANY (r.associacoes);
    ELSE
      UPDATE public.trabalho_revisores tr SET atraso_prazo = NULL
       WHERE tr.id = ANY (r.associacoes);
    END IF;
  END LOOP;

  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.concluir_envios(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concluir_envios(jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.devolver_emails(text, uuid[]);

-- ------------------------------------------------------------
-- 5. Confere na própria migration
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sobrou text;
BEGIN
  -- `REVOKE ... FROM PUBLIC` não tira o grant DIRETO que o ALTER DEFAULT
  -- PRIVILEGES do projeto dá a anon/authenticated (20260908120000).
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_sobrou
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('emails_devidos', 'concluir_envios', '_parecer_pendente')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'Ficou executável pela API: %. Buscar a fila é reservá-la.', v_sobrou;
  END IF;

  IF NOT has_function_privilege('service_role', 'public.emails_devidos(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.concluir_envios(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem EXECUTE na fila: a Edge Function não conseguiria buscar nem concluir.';
  END IF;

  IF has_function_privilege('anon', 'public.solicitar_avisos_atribuicao(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa solicitar_avisos_atribuicao.';
  END IF;

  IF has_table_privilege('anon', 'public.envios_revisores', 'SELECT') THEN
    RAISE EXCEPTION 'anon lê envios_revisores: endereço de revisor ficaria público.';
  END IF;

  -- Uma policy de escrita deixaria a organização "corrigir" o registro à mão
  -- — e ele deixaria de dizer o que o Google respondeu.
  SELECT string_agg(pol.policyname, ', ') INTO v_sobrou
    FROM pg_policies pol
   WHERE pol.schemaname = 'public' AND pol.tablename = 'envios_revisores'
     AND pol.cmd <> 'SELECT';
  IF v_sobrou IS NOT NULL THEN
    RAISE EXCEPTION 'envios_revisores ganhou policy de escrita: %.', v_sobrou;
  END IF;

  IF position('America/Sao_Paulo' IN (
       SELECT p.prosrc FROM pg_proc p
        WHERE p.oid = 'public.emails_devidos(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'emails_devidos deixou de fechar o prazo no fuso de Lavras.';
  END IF;

  RAISE NOTICE 'OK: registro de envios só da organização, fila e conclusão só para service_role.';
END $$;
