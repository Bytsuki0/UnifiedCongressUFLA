-- ============================================================
-- Conta não confirmada em 4 horas é apagada
-- ============================================================
--
-- Problema: `handle_new_user` grava o papel no ato do signup, então a conta
-- aparece em /admin/papeis e /admin/usuarios COM papel antes de provar a
-- posse do e-mail — e ficava lá para sempre se o link nunca fosse clicado.
-- O RLS já a deixava sem alcance (`email_confirmado()`), mas um admin podia
-- conceder papel a um endereço que ninguém provou ter.
--
-- Regra: quem não confirma em 4 h desde o cadastro perde o cadastro.
-- Voltar é refazer o /cadastro e, desta vez, clicar no link.
--
-- O que sai é o mesmo que `liberar_email_nao_confirmado` já apaga (fichas de
-- estudante/professor pelo user_id + auth.users, que leva profiles,
-- user_roles e tokens_email em cascata), com as mesmas exceções:
--   · conta com trabalho fica — nunca apagamos submissão;
--   · conta SEM linha em profiles fica — estado quebrado, não dá para
--     afirmar que não confirmou (mesmo critério do purge-contas --nao-confirmadas).
-- Toda FK para auth.users é CASCADE ou SET NULL: o DELETE não tem como travar.
--
-- ⚠ O link do e-mail passa a vencer no MESMO prazo (created_at + 4 h, não
--   now() + 24 h). Com 24 h o link sobreviveria à conta e o clique cairia em
--   "link inválido"; assim 'expirado' significa "o prazo do cadastro acabou".
--   Os dois '4 hours' abaixo andam juntos — o bloco DO do fim confere.

SET search_path = public;

-- ------------------------------------------------------------
-- 1. A purga
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purgar_contas_nao_confirmadas()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT coalesce(array_agg(u.id), '{}') INTO v_ids
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
   WHERE p.email_confirmado_em IS NULL
     AND u.created_at < now() - interval '4 hours'
     AND NOT EXISTS (SELECT 1 FROM public.trabalhos t WHERE t.owner_id = u.id);

  DELETE FROM public.estudantes  WHERE user_id = ANY (v_ids);
  DELETE FROM public.professores WHERE user_id = ANY (v_ids);
  DELETE FROM auth.users         WHERE id      = ANY (v_ids);

  RETURN cardinality(v_ids);
END; $$;

COMMENT ON FUNCTION public.purgar_contas_nao_confirmadas() IS
  'Apaga as contas que não confirmaram o e-mail em 4 h desde o cadastro. '
  'Roda pelo pg_cron (job purgar-contas-nao-confirmadas); ninguém da API a alcança.';

-- Só o cron a chama. REVOKE de PUBLIC não tira o grant DIRETO que o
-- ALTER DEFAULT PRIVILEGES do projeto dá a anon/authenticated.
REVOKE ALL ON FUNCTION public.purgar_contas_nao_confirmadas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purgar_contas_nao_confirmadas() FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. O link vence junto com o prazo da conta
-- ------------------------------------------------------------
-- Corpo da 20260814120000; mudam só `v_criada` e o vencimento da
-- verificação. Assinatura e grants intactos.
CREATE OR REPLACE FUNCTION public.criar_token_email(
  p_user_id   uuid,
  p_proposito text DEFAULT 'verificacao_email'
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email      TEXT;
  v_criada     TIMESTAMPTZ;
  v_ultimo     TIMESTAMPTZ;
  v_token      TEXT;
  v_confirmado BOOLEAN;
  v_throttle   INTERVAL;
  v_expira     TIMESTAMPTZ;
BEGIN
  IF p_proposito NOT IN ('verificacao_email', 'redefinir_senha') THEN
    RAISE EXCEPTION 'Propósito de token não suportado: %.', coalesce(p_proposito, 'nulo')
      USING ERRCODE = 'PT400';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_criada
    FROM auth.users u WHERE u.id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Usuário inexistente ou sem e-mail.' USING ERRCODE = 'PT404';
  END IF;

  v_confirmado := EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.email_confirmado_em IS NOT NULL
  );

  IF p_proposito = 'verificacao_email' AND v_confirmado THEN
    RAISE EXCEPTION 'E-mail já confirmado.' USING ERRCODE = 'PT409';
  END IF;

  IF p_proposito = 'redefinir_senha' AND NOT v_confirmado THEN
    RAISE EXCEPTION 'E-mail não confirmado.' USING ERRCODE = 'PT403';
  END IF;

  IF p_proposito = 'redefinir_senha' THEN
    v_throttle := interval '2 hours';
    v_expira   := now() + interval '2 hours';
  ELSE
    v_throttle := interval '60 seconds';
    -- Mesmo prazo de purgar_contas_nao_confirmadas: o link não sobrevive à conta.
    v_expira   := v_criada + interval '4 hours';
  END IF;

  -- Prazo vencido e o cron ainda não passou: para quem pede, a conta já
  -- não existe. Mandar o e-mail seria entregar um link nascido morto.
  IF v_expira <= now() THEN
    RAISE EXCEPTION 'Prazo de confirmação encerrado; refaça o cadastro.' USING ERRCODE = 'PT404';
  END IF;

  -- Throttle imposto no SQL (a UI só espelha). A mensagem PRECISA
  -- começar pelo número de segundos: a Edge Function extrai com /\d+/.
  SELECT max(t.created_at) INTO v_ultimo
  FROM public.tokens_email t
  WHERE t.user_id = p_user_id AND t.proposito = p_proposito;

  IF v_ultimo IS NOT NULL AND v_ultimo > now() - v_throttle THEN
    RAISE EXCEPTION 'Aguarde % segundo(s) para pedir outro e-mail.',
      ceil(extract(epoch FROM (v_ultimo + v_throttle) - now()))::int
      USING ERRCODE = 'PT429';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.tokens_email (token_hash, user_id, proposito, email, expires_at)
  VALUES (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_user_id, p_proposito, v_email, v_expira
  );

  RETURN v_token;
END; $$;
REVOKE ALL ON FUNCTION public.criar_token_email(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_token_email(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_token_email(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 3. Nada no Storage para ficar órfão
-- ------------------------------------------------------------
-- O blob não sai por SQL. `pdfs owner insert` já exige e-mail confirmado
-- (20260808220000); `avatars owner write` era a última escrita de dono sem
-- o gate — uma conta pendente que subisse avatar deixaria o arquivo para
-- trás quando a purga a apagasse.
DROP POLICY IF EXISTS "avatars owner write" ON storage.objects;
CREATE POLICY "avatars owner write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.email_confirmado()
  );

-- ------------------------------------------------------------
-- 4. O agendamento
-- ------------------------------------------------------------
-- A cada 15 min: a conta some entre 4 h e 4 h 15 depois do cadastro.
-- `cron.schedule` com nome é upsert — reaplicar não duplica o job.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule(
  'purgar-contas-nao-confirmadas',
  '*/15 * * * *',
  'SELECT public.purgar_contas_nao_confirmadas()'
);

-- ------------------------------------------------------------
-- 5. Conferência (aborta a migration se algo não bater)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_purga TEXT;
  v_token TEXT;
BEGIN
  IF has_function_privilege('anon', 'public.purgar_contas_nao_confirmadas()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purgar_contas_nao_confirmadas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'purgar_contas_nao_confirmadas ficou executável pela API.';
  END IF;

  SELECT prosrc INTO v_purga FROM pg_proc
   WHERE oid = 'public.purgar_contas_nao_confirmadas()'::regprocedure;
  SELECT prosrc INTO v_token FROM pg_proc
   WHERE oid = 'public.criar_token_email(uuid, text)'::regprocedure;
  IF position('interval ''4 hours''' IN v_purga) = 0
     OR position('v_criada + interval ''4 hours''' IN v_token) = 0 THEN
    RAISE EXCEPTION 'o prazo da purga e o vencimento do link deixaram de ser os mesmos 4 h.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'purgar-contas-nao-confirmadas' AND active) THEN
    RAISE EXCEPTION 'o job purgar-contas-nao-confirmadas não ficou agendado.';
  END IF;

  IF coalesce(position('email_confirmado' IN (
       SELECT with_check FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'avatars owner write')), 0) = 0 THEN
    RAISE EXCEPTION 'avatars owner write ficou sem o gate de e-mail confirmado.';
  END IF;

  RAISE NOTICE 'OK: purga a cada 15 min, link e conta vencem juntos em 4 h.';
END $$;
