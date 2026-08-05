-- ============================================================
-- Pool de revisores por papel + conflito de interesse
-- ------------------------------------------------------------
-- Dois problemas resolvidos aqui:
--
-- 1. O pool de revisores era montado a partir das tabelas
--    `avaliadores` e `professores`. Conceder o papel `professor`
--    na tela de Papéis só escreve em `user_roles`, então a conta
--    promovida nunca aparecia nas Atribuições nem era escolhida
--    pela distribuição automática — o trabalho criado depois não
--    ficava associado ao e-mail dela. A fonte de verdade do pool
--    passa a ser `user_roles` (+ os co-chairs cadastrados pela
--    organização que ainda não têm conta).
--
-- 2. Conflito de interesse não era verificado: o orientador ou um
--    coautor podia ser associado como revisor do próprio trabalho.
--    Agora é barrado no banco (trigger), na distribuição automática
--    e na interface.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Pool de revisores
-- ------------------------------------------------------------
-- Interno (sem verificação de acesso): usado pelas funções abaixo,
-- que já fazem a própria autorização. Não é exposto ao PostgREST.
CREATE OR REPLACE FUNCTION public._pool_revisores()
RETURNS TABLE(email text, nome text, tipo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (x.mail) x.mail, x.pessoa, x.papel
  FROM (
    -- Contas com papel de revisor. `user_roles` é a fonte de verdade:
    -- é o que a tela de Papéis edita e o que o cadastro atribui.
    SELECT lower(p.email) AS mail,
           coalesce(nullif(trim(p.nome), ''), split_part(lower(p.email), '@', 1)) AS pessoa,
           ur.role AS papel,
           CASE ur.role WHEN 'avaliador' THEN 0 ELSE 1 END AS prio
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE ur.role IN ('avaliador', 'professor')
      AND coalesce(p.email, '') <> ''

    UNION ALL

    -- Co-chairs cadastrados pela organização que ainda não criaram
    -- conta (quando criarem, o trigger de sync dá o papel e eles
    -- passam a entrar pelo ramo acima).
    SELECT lower(a.email), a.nome, 'avaliador', 0
    FROM public.avaliadores a
    WHERE coalesce(a.email, '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(a.email)
      )
  ) x
  ORDER BY x.mail, x.prio;
$$;
REVOKE ALL ON FUNCTION public._pool_revisores() FROM PUBLIC;

-- Exposto ao frontend (tela de Atribuições) — só para a organização.
CREATE OR REPLACE FUNCTION public.pool_revisores()
RETURNS TABLE(email text, nome text, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  RETURN QUERY SELECT r.email, r.nome, r.tipo FROM public._pool_revisores() r;
END; $$;
REVOKE ALL ON FUNCTION public.pool_revisores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pool_revisores() TO authenticated;

-- ------------------------------------------------------------
-- 2. Conflito de interesse
-- ------------------------------------------------------------
-- Quem não pode revisar um trabalho: o autor que submeteu, o
-- orientador informado e cada coautor com e-mail.
--
-- O dono do trabalho só conta como autor quando NÃO é da organização:
-- um co-chair que cadastra o trabalho de outra pessoa pela tela de
-- Trabalhos vira `owner_id` sem ser autor de nada.
CREATE OR REPLACE FUNCTION public.conflitos_do_trabalho(_trabalho_id uuid)
RETURNS TABLE(email text, motivo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.mail, min(c.razao)
  FROM (
    SELECT lower(u.email) AS mail, 'autor' AS razao
    FROM public.trabalhos t
    JOIN auth.users u ON u.id = t.owner_id
    WHERE t.id = _trabalho_id AND coalesce(u.email, '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = u.id AND ur.role IN ('admin', 'avaliador')
      )

    UNION ALL

    SELECT lower(trim(t.orientador_email)), 'orientador'
    FROM public.trabalhos t
    WHERE t.id = _trabalho_id AND coalesce(trim(t.orientador_email), '') <> ''

    UNION ALL

    SELECT lower(trim(co.value ->> 'email')), 'coautor'
    FROM public.trabalhos t
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(t.coautores) = 'array' THEN t.coautores ELSE '[]'::jsonb END
    ) AS co(value)
    WHERE t.id = _trabalho_id AND coalesce(trim(co.value ->> 'email'), '') <> ''
  ) c
  GROUP BY c.mail;
$$;
REVOKE ALL ON FUNCTION public.conflitos_do_trabalho(uuid) FROM PUBLIC;

-- Mesma regra para todos os trabalhos de uma vez — alimenta a tela
-- de Atribuições e o painel de Conflitos do admin.
CREATE OR REPLACE FUNCTION public._conflitos_por_trabalho()
RETURNS TABLE(trabalho_id uuid, email text, motivo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.tid, c.mail, min(c.razao)
  FROM (
    SELECT t.id AS tid, lower(u.email) AS mail, 'autor' AS razao
    FROM public.trabalhos t
    JOIN auth.users u ON u.id = t.owner_id
    WHERE coalesce(u.email, '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = u.id AND ur.role IN ('admin', 'avaliador')
      )

    UNION ALL

    SELECT t.id, lower(trim(t.orientador_email)), 'orientador'
    FROM public.trabalhos t
    WHERE coalesce(trim(t.orientador_email), '') <> ''

    UNION ALL

    SELECT t.id, lower(trim(co.value ->> 'email')), 'coautor'
    FROM public.trabalhos t
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(t.coautores) = 'array' THEN t.coautores ELSE '[]'::jsonb END
    ) AS co(value)
    WHERE coalesce(trim(co.value ->> 'email'), '') <> ''
  ) c
  GROUP BY c.tid, c.mail;
$$;
REVOKE ALL ON FUNCTION public._conflitos_por_trabalho() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.conflitos_por_trabalho()
RETURNS TABLE(trabalho_id uuid, email text, motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  RETURN QUERY
  SELECT c.trabalho_id, c.email, c.motivo FROM public._conflitos_por_trabalho() c;
END; $$;
REVOKE ALL ON FUNCTION public.conflitos_por_trabalho() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conflitos_por_trabalho() TO authenticated;

-- Barra a associação no banco — vale para a interface, para a RPC de
-- distribuição e para qualquer chamada direta à API.
CREATE OR REPLACE FUNCTION public.bloqueia_revisor_em_conflito()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_motivo text;
BEGIN
  SELECT c.motivo INTO v_motivo
  FROM public.conflitos_do_trabalho(NEW.trabalho_id) c
  WHERE c.email = lower(trim(NEW.revisor_email))
  LIMIT 1;

  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION
      'Conflito de interesse: % consta como % deste trabalho e não pode revisá-lo.',
      NEW.revisor_email, v_motivo
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_conflito_revisor ON public.trabalho_revisores;
CREATE TRIGGER trg_conflito_revisor
  BEFORE INSERT OR UPDATE OF revisor_email, trabalho_id ON public.trabalho_revisores
  FOR EACH ROW EXECUTE FUNCTION public.bloqueia_revisor_em_conflito();

-- ------------------------------------------------------------
-- 3. Distribuição automática: usa o pool novo e pula conflitos
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.distribuir_revisores(_trabalho_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_criados            integer := 0;
  v_max_por_trabalho   CONSTANT integer := 3;
  v_limite_por_revisor CONSTANT integer := 5;
  r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF NOT (
    public.is_event_staff()
    OR EXISTS (SELECT 1 FROM public.trabalhos t WHERE t.id = _trabalho_id AND t.owner_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  LOOP
    EXIT WHEN (SELECT count(*) FROM public.trabalho_revisores WHERE trabalho_id = _trabalho_id)
              >= v_max_por_trabalho;

    SELECT pool.email, pool.nome, pool.tipo INTO r
    FROM public._pool_revisores() pool
    CROSS JOIN LATERAL (
      SELECT count(*) AS carga FROM public.trabalho_revisores tr
      WHERE lower(tr.revisor_email) = pool.email
    ) c
    WHERE c.carga < v_limite_por_revisor
      AND NOT EXISTS (
        SELECT 1 FROM public.trabalho_revisores tr2
        WHERE tr2.trabalho_id = _trabalho_id AND lower(tr2.revisor_email) = pool.email
      )
      -- Conflito de interesse: autor, orientador ou coautor.
      AND NOT EXISTS (
        SELECT 1 FROM public.conflitos_do_trabalho(_trabalho_id) cf
        WHERE cf.email = pool.email
      )
    ORDER BY c.carga ASC, pool.email
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    INSERT INTO public.trabalho_revisores (trabalho_id, revisor_email, revisor_nome, tipo)
    VALUES (_trabalho_id, r.email, r.nome, r.tipo);
    v_criados := v_criados + 1;
  END LOOP;

  RETURN v_criados;
END; $$;
REVOKE ALL ON FUNCTION public.distribuir_revisores(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.distribuir_revisores(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 4. Backfill: ninguém sai do pool por causa da troca de fonte
-- ------------------------------------------------------------
-- Linhas antigas de `professores` sem user_id (criadas quando as
-- políticas eram abertas) não tinham papel; se o e-mail tem conta,
-- o papel é concedido para que continuem no pool.
UPDATE public.professores pr
SET user_id = u.id
FROM auth.users u
WHERE pr.user_id IS NULL AND lower(u.email) = lower(pr.email);

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'professor'
FROM auth.users u
JOIN public.professores pr ON lower(pr.email) = lower(u.email)
ON CONFLICT (user_id, role) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Associações anteriores que já violam a regra
-- ------------------------------------------------------------
-- O trigger só vale para escritas novas, então associações criadas
-- antes desta migração podem estar em conflito. Elas NÃO são apagadas
-- aqui de propósito: remover uma associação leva junto o parecer já
-- emitido, e essa decisão é da organização. Elas aparecem listadas em
-- /admin/conflitos ("Atribuições em violação"), com um botão para
-- desfazer cada uma.
