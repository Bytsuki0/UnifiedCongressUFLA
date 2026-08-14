-- ============================================================
-- Esqueci minha senha — fundação em SQL
-- ------------------------------------------------------------
-- Completa o fluxo previsto na migration 20260806140000: o CHECK de
-- `tokens_email.proposito` já aceitava 'redefinir_senha', faltava a
-- cunhagem e o consumo. Mesma camada, mesmas regras de ouro: token de
-- 32 bytes aleatórios, banco guarda só o hash sha256, uso único em
-- `used_at`, cunhagem exclusiva do service_role.
--
-- Diferenças de propósito (decisões aprovadas):
--   · redefinir_senha exige conta CONFIRMADA (inverso da verificação:
--     quem nunca provou a posse da caixa não redefine senha por ela);
--   · throttle de 2 HORAS por conta (verificação mantém 60 s);
--   · validade de 2 HORAS (verificação mantém 24 h) — quando o
--     cooldown libera um novo pedido, o link antigo já está morto.
--
-- Anti-enumeração: `criar_token_redefinicao` devolve motivo em LINHA
-- ('inexistente' / 'nao_confirmado' / 'aguarde'), nunca em exceção —
-- a Edge Function responde `{ok:true}` genérico para os três e o
-- formulário público não vira oráculo de "este e-mail tem conta?".
-- Só dois desfechos são honestos (RAISE): e-mail malformado (PT400)
-- e o limite por IP (PT429), que não revela nada sobre contas.
--
-- O IP chega por PARÂMETRO (p_ip): quem chama esta RPC é a Edge
-- Function com service_role, então o `request.headers` que o PostgREST
-- enxerga é o do fetch do Deno, não o do navegador. O idioma
-- `x-forwarded-for` usado em liberar_email_nao_confirmado não serve aqui.
--
-- A troca da senha em si é do GoTrue (Admin API, Edge Function): SQL
-- não escreve em auth.users. Aqui mora só a autoridade sobre o token.
--
-- ⚠ pgcrypto vive no schema `extensions`; todas as SECURITY DEFINER
--   fixam `SET search_path = public` — por isso os nomes qualificados.
-- ============================================================

SET search_path = public;

-- ------------------------------------------------------------
-- 1. Cunhagem — agora com os dois propósitos
-- ------------------------------------------------------------
-- Mesmo corpo da 20260806140000, com throttle/validade/checagem de
-- confirmação dependentes do propósito. Assinatura e grants intactos.
CREATE OR REPLACE FUNCTION public.criar_token_email(
  p_user_id   uuid,
  p_proposito text DEFAULT 'verificacao_email'
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email      TEXT;
  v_ultimo     TIMESTAMPTZ;
  v_token      TEXT;
  v_confirmado BOOLEAN;
  v_throttle   INTERVAL;
  v_validade   INTERVAL;
BEGIN
  IF p_proposito NOT IN ('verificacao_email', 'redefinir_senha') THEN
    RAISE EXCEPTION 'Propósito de token não suportado: %.', coalesce(p_proposito, 'nulo')
      USING ERRCODE = 'PT400';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = p_user_id;
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
    v_validade := interval '2 hours';
  ELSE
    v_throttle := interval '60 seconds';
    v_validade := interval '24 hours';
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
    p_user_id, p_proposito, v_email, now() + v_validade
  );

  RETURN v_token;
END; $$;
REVOKE ALL ON FUNCTION public.criar_token_email(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_token_email(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_token_email(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 2. Pedido de redefinição — a viagem única do "solicitar"
-- ------------------------------------------------------------
-- Resolve e-mail → usuário DENTRO do SQL (auth.users não é exposto
-- pelo PostgREST; profiles.email é cópia desnormalizada) e devolve o
-- que a Edge Function precisa para montar o e-mail: token cru + nome.
--
-- `motivo` em linha, não exceção — ver cabeçalho (anti-enumeração).
CREATE OR REPLACE FUNCTION public.criar_token_redefinicao(
  p_email text,
  p_ip    text DEFAULT NULL
)
RETURNS TABLE(token text, nome text, motivo text, segundos integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email   TEXT;
  v_user_id UUID;
  v_token   TEXT;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = 'PT400';
  END IF;

  -- 5 pedidos/hora por IP: protege a cota do Brevo e limita sondagem.
  -- consume_rate_limit não tem GRANT nenhum — só é alcançável daqui,
  -- porque esta função roda como owner.
  IF NOT public.consume_rate_limit(
    'redefinir_senha:' || coalesce(nullif(trim(coalesce(p_ip, '')), ''), 'unknown'),
    5, 3600
  ) THEN
    -- O primeiro número da mensagem é o cooldown em segundos (a Edge
    -- Function extrai com /\d+/, mesma convenção do throttle acima).
    RAISE EXCEPTION 'Aguarde 3600 segundo(s): muitas tentativas a partir desta conexão.'
      USING ERRCODE = 'PT429';
  END IF;

  SELECT u.id INTO v_user_id FROM auth.users u WHERE lower(u.email) = v_email;
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'inexistente'::text, NULL::integer;
    RETURN;
  END IF;

  BEGIN
    v_token := public.criar_token_email(v_user_id, 'redefinir_senha');
  EXCEPTION
    WHEN SQLSTATE 'PT403' THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'nao_confirmado'::text, NULL::integer;
      RETURN;
    WHEN SQLSTATE 'PT429' THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'aguarde'::text,
        coalesce((regexp_match(SQLERRM, '\d+'))[1]::integer, 7200);
      RETURN;
  END;

  RETURN QUERY
  SELECT v_token, p.nome, 'ok'::text, NULL::integer
    FROM public.profiles p
   WHERE p.id = v_user_id;
  IF NOT FOUND THEN
    -- Perfil sempre existe (handle_new_user), mas um token cunhado
    -- jamais pode se perder por causa do nome de exibição.
    RETURN QUERY SELECT v_token, NULL::text, 'ok'::text, NULL::integer;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.criar_token_redefinicao(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_token_redefinicao(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_token_redefinicao(text, text) TO service_role;

-- ------------------------------------------------------------
-- 3. Consumo — atômico, uso único, só service_role
-- ------------------------------------------------------------
-- Diferente de `confirmar_email` (aberta a anon), esta NÃO é chamada
-- pelo navegador: quem consome é a Edge Function, que na sequência
-- troca a senha pela Admin API. Devolve status calmo, nunca lança.
--
-- Sem rate limit: 32 bytes aleatórios não são adivinháveis, e a
-- resposta não distingue "nunca existiu" de "é de outra pessoa" —
-- mesma justificativa documentada em confirmar_email.
CREATE OR REPLACE FUNCTION public.consumir_token_redefinicao(p_token text)
RETURNS TABLE(status text, user_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
  t      public.tokens_email%ROWTYPE;
BEGIN
  IF coalesce(trim(p_token), '') = '' THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid;
    RETURN;
  END IF;

  v_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  SELECT * INTO t
    FROM public.tokens_email te
   WHERE te.token_hash = v_hash AND te.proposito = 'redefinir_senha';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalido'::text, NULL::uuid;
    RETURN;
  END IF;

  IF t.used_at IS NOT NULL THEN
    RETURN QUERY SELECT 'usado'::text, NULL::uuid;
    RETURN;
  END IF;

  IF t.expires_at <= now() THEN
    RETURN QUERY SELECT 'expirado'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Uso único sob concorrência: quem perder a corrida não encontra
  -- linha para atualizar e recebe o desfecho calmo.
  UPDATE public.tokens_email te
     SET used_at = now()
   WHERE te.token_hash = v_hash AND te.used_at IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'usado'::text, NULL::uuid;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, t.user_id;
END; $$;
REVOKE ALL ON FUNCTION public.consumir_token_redefinicao(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consumir_token_redefinicao(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumir_token_redefinicao(text) TO service_role;

-- ------------------------------------------------------------
-- 4. Conferência final — aborta se os grants ou o CHECK divergirem
-- ------------------------------------------------------------
DO $$
DECLARE
  v_fn  TEXT;
  v_chk TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.criar_token_email(uuid, text)',
    'public.criar_token_redefinicao(text, text)',
    'public.consumir_token_redefinicao(text)'
  ]
  LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
    OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Função % executável por anon/authenticated — grants divergentes.', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Função % não executável por service_role.', v_fn;
    END IF;
  END LOOP;

  SELECT pg_get_constraintdef(c.oid) INTO v_chk
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'tokens_email'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%proposito%';

  IF v_chk IS NULL OR v_chk NOT LIKE '%redefinir_senha%' THEN
    RAISE EXCEPTION 'CHECK de tokens_email.proposito não contém redefinir_senha: %',
      coalesce(v_chk, '(constraint não encontrada)');
  END IF;

  RAISE NOTICE 'Verificação OK: redefinição de senha instalada.';
END $$;
