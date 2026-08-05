-- ============================================================
-- Conflito de interesse: o dono do trabalho é SEMPRE autor
-- ------------------------------------------------------------
-- A migração anterior isentava o dono quando ele era admin/avaliador,
-- para não travar o co-chair que cadastra o trabalho de terceiros pela
-- tela /trabalhos/novo (ele vira `owner_id` sem ser autor de nada).
--
-- A regra escolhida é a mais rígida: ninguém revisa o trabalho de que
-- é dono, em nenhuma hipótese. O custo é o caso acima — o co-chair que
-- digitou o trabalho de outra pessoa fica impedido de revisá-LO (só
-- aquele trabalho); os demais revisores do pool seguem disponíveis.
-- ============================================================

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
