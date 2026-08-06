-- ============================================================
-- Verificação de e-mail — fundação em SQL (Etapa 1)
-- ------------------------------------------------------------
-- Postura adotada: LOGIN PERMITIDO, USO BLOQUEADO.
-- O autoconfirm do GoTrue continua LIGADO (ele não envia nada e
-- entrega sessão no signup); a conta não confirmada loga, mas o
-- RLS recusa os dados protegidos. A fronteira de confiança é o
-- SQL, nunca a interface.
--
-- O sistema de tokens é PRÓPRIO (a confirmação nativa do Supabase
-- não é usada): token de 32 bytes aleatórios, banco guarda só o
-- hash sha256, expiração de 24 h, uso único em `used_at`.
-- A cunhagem é exclusiva do service_role (a Edge Function de envio
-- é sua única chamadora — Etapa 2); o consumo é aberto a `anon`,
-- porque o link do e-mail abre em navegador sem sessão (celular).
--
-- Reenvio NÃO invalida tokens anteriores: vários tokens em aberto
-- são legítimos, qualquer um confirma, e os demais passam a cair em
-- 'ja_confirmado' — evita o ticket "cliquei no e-mail antigo".
--
-- Contas existentes no momento desta migration são confirmadas em
-- bloco: a regra é nova, ninguém é trancado para fora retroativamente.
--
-- ⚠ pgcrypto vive no schema `extensions` (não em `public`), e todas
--   as funções SECURITY DEFINER do projeto fixam `SET search_path =
--   public`. Por isso `extensions.gen_random_bytes` e
--   `extensions.digest` aparecem sempre qualificados: alargar o
--   search_path enfraqueceria o hardening de 20260709120000.
-- ============================================================

-- Deparse e reparse das policies (bloco 6) precisam do mesmo
-- search_path para render/resolver os nomes de forma consistente.
SET search_path = public;

-- ------------------------------------------------------------
-- 1. Tabela de tokens
-- ------------------------------------------------------------
-- `proposito` já prevê 'redefinir_senha' no CHECK, mas esse fluxo
-- NÃO está implementado (a RPC de cunhagem o recusa). A coluna
-- existe para que o reset de senha, quando vier, reaproveite a
-- mesma camada em vez de criar outra tabela.
--
-- `message_id` guarda o id devolvido pelo provedor de envio (Brevo,
-- Etapa 2) — é o que permite rastrear um e-mail que o usuário jura
-- não ter recebido. O token CRU nunca é gravado aqui.
CREATE TABLE IF NOT EXISTS public.tokens_email (
  token_hash TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposito  TEXT NOT NULL
             CHECK (proposito IN ('verificacao_email', 'redefinir_senha')),
  email      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_id TEXT
);

-- Sustenta o throttle (último token do mesmo usuário+propósito).
CREATE INDEX IF NOT EXISTS idx_tokens_email_user
  ON public.tokens_email (user_id, proposito, created_at DESC);

-- RLS ligado e NENHUMA policy: só as RPCs SECURITY DEFINER tocam a
-- tabela. O REVOKE é redundante com a ausência de policy, mas
-- documenta a intenção e neutraliza o GRANT padrão do schema.
ALTER TABLE public.tokens_email ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokens_email FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2. Marca de confirmação no perfil + backfill
-- ------------------------------------------------------------
-- O backfill roda APENAS quando a coluna acabou de ser criada. Se
-- esta migration for reexecutada por engano, contas não confirmadas
-- criadas depois não são promovidas silenciosamente.
DO $$
DECLARE
  v_coluna_nova BOOLEAN;
  v_backfill    INTEGER;
BEGIN
  v_coluna_nova := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'email_confirmado_em'
  );

  ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS email_confirmado_em TIMESTAMPTZ;

  IF v_coluna_nova THEN
    UPDATE public.profiles
       SET email_confirmado_em = coalesce(created_at, now())
     WHERE email_confirmado_em IS NULL;
    GET DIAGNOSTICS v_backfill = ROW_COUNT;
    RAISE NOTICE 'Backfill: % conta(s) existente(s) marcada(s) como confirmada(s).', v_backfill;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Fonte única de verdade do gate
-- ------------------------------------------------------------
-- A MESMA função é usada nas policies de RLS e chamada pelo cliente
-- (AuthContext, Etapa 3). Lê do banco, não de claim do JWT: a
-- confirmação vale na hora, sem esperar o refresh de token (jwt_exp
-- do projeto é 1 h).
CREATE OR REPLACE FUNCTION public.email_confirmado()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.email_confirmado_em IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.email_confirmado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_confirmado() FROM anon;
GRANT EXECUTE ON FUNCTION public.email_confirmado() TO authenticated;

-- Guarda usada NO TOPO das RPCs SECURITY DEFINER (bloco 8). Difere
-- de um `IF NOT email_confirmado()` cru num ponto essencial: quando
-- não há sessão (`auth.uid()` nulo) ela DEIXA PASSAR.
--
-- Motivo: SECURITY DEFINER roda como `postgres`, mas `auth.uid()`
-- reflete o JWT da requisição. Sem essa ressalva, toda escrita de
-- servidor (service_role, trigger disparado por migration, seed)
-- passaria a falhar — é a mesma convenção que
-- `protect_trabalhos_fields` já adota. Nenhuma brecha para `anon`:
-- as 9 funções gateadas já recusam chamada sem sessão por conta
-- própria (`is_event_staff()` ou `auth.uid() IS NULL`).
CREATE OR REPLACE FUNCTION public.exigir_email_confirmado()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.email_confirmado() THEN
    RAISE EXCEPTION 'Confirme seu e-mail para usar esta funcionalidade.'
      USING ERRCODE = 'PT403';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.exigir_email_confirmado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exigir_email_confirmado() FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4. Cunhagem do token — SOMENTE service_role
-- ------------------------------------------------------------
-- Devolve o token CRU. Ele existe apenas neste retorno, no corpo do
-- e-mail e na URL clicada — nunca é persistido nem logado.
--
-- Os SQLSTATEs seguem a convenção 'PTxxx' do PostgREST (vira HTTP
-- xxx na resposta). Mesmo que a versão do PostgREST não a suporte,
-- o código continua no campo `code` do JSON de erro, que é o que a
-- Edge Function da Etapa 2 usa para separar throttle de falha real.
CREATE OR REPLACE FUNCTION public.criar_token_email(
  p_user_id   uuid,
  p_proposito text DEFAULT 'verificacao_email'
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email  TEXT;
  v_ultimo TIMESTAMPTZ;
  v_token  TEXT;
BEGIN
  IF p_proposito IS DISTINCT FROM 'verificacao_email' THEN
    -- 'redefinir_senha' cabe no CHECK da tabela, mas o fluxo não
    -- existe: recusar aqui evita cunhar token que ninguém consome.
    RAISE EXCEPTION 'Propósito de token não suportado: %.', coalesce(p_proposito, 'nulo')
      USING ERRCODE = 'PT400';
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Usuário inexistente ou sem e-mail.' USING ERRCODE = 'PT404';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.email_confirmado_em IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'E-mail já confirmado.' USING ERRCODE = 'PT409';
  END IF;

  -- Throttle de 60 s imposto no SQL (a UI da Etapa 3 só espelha).
  SELECT max(t.created_at) INTO v_ultimo
  FROM public.tokens_email t
  WHERE t.user_id = p_user_id AND t.proposito = p_proposito;

  IF v_ultimo IS NOT NULL AND v_ultimo > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'Aguarde % segundo(s) para pedir outro e-mail.',
      ceil(extract(epoch FROM (v_ultimo + interval '60 seconds') - now()))::int
      USING ERRCODE = 'PT429';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.tokens_email (token_hash, user_id, proposito, email, expires_at)
  VALUES (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_user_id, p_proposito, v_email, now() + interval '24 hours'
  );

  RETURN v_token;
END; $$;
REVOKE ALL ON FUNCTION public.criar_token_email(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_token_email(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.criar_token_email(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 5. Consumo do token — aberto a anon (o link abre sem sessão)
-- ------------------------------------------------------------
-- Devolve exatamente um de:
--   'confirmado'    — marcou used_at e confirmou o perfil (mesma transação)
--   'ja_confirmado' — token já usado OU usuário já confirmado (desfecho calmo)
--   'expirado'      — passou das 24 h
--   'invalido'      — hash desconhecido
--
-- Idempotente por desenho: a segunda chamada com o mesmo token não é
-- erro destrutivo. `used_at` é timestamp, não deleção — preserva a
-- diferença entre "já usado" e "nunca existiu".
--
-- Sem rate limit por IP (ao contrário de verify_certificate, cujo
-- código tem 16 hex): 32 bytes aleatórios não são adivinháveis, e a
-- resposta não distingue token inexistente de token de terceiro.
CREATE OR REPLACE FUNCTION public.confirmar_email(p_token text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
  t      public.tokens_email%ROWTYPE;
BEGIN
  IF coalesce(trim(p_token), '') = '' THEN
    RETURN 'invalido';
  END IF;

  v_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  SELECT * INTO t FROM public.tokens_email
   WHERE token_hash = v_hash AND proposito = 'verificacao_email';
  IF NOT FOUND THEN
    RETURN 'invalido';
  END IF;

  IF t.used_at IS NOT NULL THEN
    RETURN 'ja_confirmado';
  END IF;

  -- Outro token do mesmo usuário já confirmou (reenvio não invalida
  -- os anteriores): o link antigo é sucesso, não erro.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = t.user_id AND p.email_confirmado_em IS NOT NULL
  ) THEN
    RETURN 'ja_confirmado';
  END IF;

  IF t.expires_at <= now() THEN
    RETURN 'expirado';
  END IF;

  -- Uso único sob concorrência: quem perder a corrida não encontra
  -- linha para atualizar e recebe o desfecho calmo.
  UPDATE public.tokens_email
     SET used_at = now()
   WHERE token_hash = v_hash AND used_at IS NULL;
  IF NOT FOUND THEN
    RETURN 'ja_confirmado';
  END IF;

  UPDATE public.profiles
     SET email_confirmado_em = now()
   WHERE id = t.user_id AND email_confirmado_em IS NULL;

  RETURN 'confirmado';
END; $$;
REVOKE ALL ON FUNCTION public.confirmar_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_email(text) TO anon, authenticated;

-- ============================================================
-- 6. Gate nas policies de RLS
-- ============================================================
-- As 53 policies abaixo passam a exigir `public.email_confirmado()`.
-- O predicado atual é LIDO de `pg_policies` e reaproveitado inteiro
-- ((atual) AND email_confirmado()), em vez de reescrito à mão: a
-- regra de autorização de cada tabela fica exatamente como está, e
-- não há risco de a cópia divergir do que está em produção.
--
-- A lista é explícita de propósito — é o contrato do inventário da
-- Etapa 0. Se qualquer policy tiver mudado de nome, a migration
-- ABORTA em vez de gatear parcialmente.
DO $$
DECLARE
  r     RECORD;
  v_sql TEXT;
  v_n   INTEGER := 0;
BEGIN
  FOR r IN
    SELECT alvo.tabela,
           alvo.pol,
           p.policyname,
           p.qual,
           p.with_check
    FROM (VALUES
      ('allowed_email_domains',   'allowed_domains select'),
      ('allowed_email_domains',   'allowed_domains write'),
      ('attendances',             'attendances select'),
      ('attendances',             'attendances write'),
      ('avaliacoes',              'avaliacoes select'),
      ('avaliacoes',              'avaliacoes insert'),
      ('avaliacoes',              'avaliacoes update'),
      ('avaliacoes',              'avaliacoes delete'),
      ('avaliadores',             'avaliadores select'),
      ('avaliadores',             'avaliadores write'),
      ('categorias',              'categorias select'),
      ('categorias',              'categorias write'),
      ('certificates',            'certificates select'),
      ('certificates',            'certificates write'),
      ('congress_registrations',  'congress_reg select'),
      ('congress_registrations',  'congress_reg insert'),
      ('congress_registrations',  'congress_reg update'),
      ('congress_registrations',  'congress_reg delete'),
      ('criterios',               'criterios select'),
      ('criterios',               'criterios write'),
      ('estudantes',              'estudantes select'),
      ('estudantes',              'estudantes insert'),
      ('estudantes',              'estudantes update'),
      ('estudantes',              'estudantes delete'),
      ('minicourse_registrations','mini_reg select'),
      ('minicourse_registrations','mini_reg insert'),
      ('minicourse_registrations','mini_reg update'),
      ('minicourse_registrations','mini_reg delete'),
      ('minicourses',             'minicourses write'),
      ('notification_reads',      'notif_reads select'),
      ('notification_reads',      'notif_reads insert'),
      ('notification_reads',      'notif_reads delete'),
      ('notifications',           'notifications select'),
      ('notifications',           'notifications write'),
      ('pareceres',               'pareceres select'),
      ('pareceres',               'pareceres insert'),
      ('pareceres',               'pareceres update'),
      ('pareceres',               'pareceres delete'),
      ('professores',             'professores select'),
      ('professores',             'professores insert'),
      ('professores',             'professores update'),
      ('professores',             'professores delete'),
      ('profiles',                'profiles insert'),
      ('profiles',                'profiles update'),
      ('profiles',                'profiles delete'),
      ('schedule',                'schedule write'),
      ('trabalho_revisores',      'trabalho_revisores select'),
      ('trabalho_revisores',      'trabalho_revisores write'),
      ('trabalhos',               'trabalhos select'),
      ('trabalhos',               'trabalhos insert'),
      ('trabalhos',               'trabalhos update'),
      ('trabalhos',               'trabalhos delete'),
      ('user_roles',              'user_roles write')
    ) AS alvo(tabela, pol)
    LEFT JOIN pg_policies p
      ON p.schemaname = 'public'
     AND p.tablename  = alvo.tabela
     AND p.policyname = alvo.pol
  LOOP
    IF r.policyname IS NULL THEN
      RAISE EXCEPTION
        'Inventário divergente: a policy "%" da tabela public.% não foi localizada. Refaça a Etapa 0.',
        r.pol, r.tabela;
    END IF;

    -- Reexecução: nada a fazer se o gate já está no predicado.
    IF coalesce(r.qual, '')       LIKE '%email_confirmado%'
    OR coalesce(r.with_check, '') LIKE '%email_confirmado%' THEN
      CONTINUE;
    END IF;

    v_sql := format('ALTER POLICY %I ON public.%I', r.pol, r.tabela);
    IF r.qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING ((%s) AND public.email_confirmado())', r.qual);
    END IF;
    IF r.with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK ((%s) AND public.email_confirmado())', r.with_check);
    END IF;

    EXECUTE v_sql;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Gate integral aplicado a % policy(ies) de public.', v_n;
END $$;

-- ------------------------------------------------------------
-- 6b. Gate PARCIAL — o ramo próprio fica aberto
-- ------------------------------------------------------------
-- Isentar a policy inteira seria demais: um avaliador/admin não
-- confirmado continuaria lendo o perfil e os papéis de todo mundo.
-- Isenta-se só o ramo "meu próprio registro" — que é o mínimo para
-- a tela /verifique-email funcionar — e gateia-se o ramo de staff.
DROP POLICY IF EXISTS "profiles select" ON public.profiles;
CREATE POLICY "profiles select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR (public.is_event_staff() AND public.email_confirmado()));

DROP POLICY IF EXISTS "user_roles select" ON public.user_roles;
CREATE POLICY "user_roles select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (public.is_event_staff() AND public.email_confirmado()));

-- ------------------------------------------------------------
-- 6c. Isentas por motivo estrutural
-- ------------------------------------------------------------
-- `minicourses select` e `schedule select` são `TO anon, authenticated`
-- com predicado `true` — é o catálogo/programação pública do congresso,
-- sem PII. `email_confirmado()` é falso para `anon`, então gateá-las
-- quebraria a página pública. O que o gate precisa barrar (a INSCRIÇÃO
-- em minicurso) mora em `minicourse_registrations`, integralmente
-- gateada acima; a ESCRITA das duas tabelas também (`* write`).

-- ============================================================
-- 7. Gate no Storage (schema `storage`)
-- ============================================================
-- O gate do schema `public` não alcança `storage.objects`, e é por ali
-- que passa o buraco mais concreto: hoje `qualquer@ufla.br` recebe o
-- papel `professor` no ato do cadastro (handle_new_user deriva o papel
-- do DOMÍNIO, sem prova de posse da caixa) e `pdfs owner read` concede
-- leitura de TODOS os PDFs submetidos a quem tem esse papel.
--
-- Mesma regra parcial de 6b: o ramo "minha própria pasta" continua
-- aberto (o app precisa dele para a sessão não confirmada renderizar),
-- e os ramos `is_event_staff()` / `has_role(...)` recebem o gate.
--
-- 12 das 16 policies mudam. As 4 restantes — `pdfs owner insert`,
-- `avatars owner write/update/delete` — são exclusivamente "pasta do
-- próprio usuário", sem ramo de papel, então o gate parcial é um
-- no-op nelas e ficam como estão.
--
-- ⚠ Resíduo conhecido (fora do escopo da decisão aprovada): uma conta
--   não confirmada segue podendo gravar na própria pasta de `Pdfs`.
--   O arquivo fica órfão — `trabalhos insert` está gateado —, mas é
--   consumo de storage. Fechar isso é uma linha (`AND
--   public.email_confirmado()` no WITH CHECK de `pdfs owner insert`);
--   não foi feito aqui porque a decisão registrada na Etapa 0 manda
--   manter o ramo próprio aberto.

-- Pdfs
DROP POLICY IF EXISTS "pdfs owner read" ON storage.objects;
CREATE POLICY "pdfs owner read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'Pdfs' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (public.is_event_staff() AND public.email_confirmado())
      OR (public.has_role(auth.uid(), 'professor') AND public.email_confirmado())
    )
  );

DROP POLICY IF EXISTS "pdfs owner update" ON storage.objects;
CREATE POLICY "pdfs owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'Pdfs' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (public.is_event_staff() AND public.email_confirmado())
    )
  );

DROP POLICY IF EXISTS "pdfs owner delete" ON storage.objects;
CREATE POLICY "pdfs owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'Pdfs' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (public.is_event_staff() AND public.email_confirmado())
    )
  );

-- avatars
DROP POLICY IF EXISTS "avatars owner read" ON storage.objects;
CREATE POLICY "avatars owner read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (public.is_event_staff() AND public.email_confirmado())
    )
  );

-- certificates
DROP POLICY IF EXISTS "certificates owner read" ON storage.objects;
CREATE POLICY "certificates owner read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'certificates' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (public.is_event_staff() AND public.email_confirmado())
    )
  );

DROP POLICY IF EXISTS "certificates staff write" ON storage.objects;
CREATE POLICY "certificates staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificates' AND public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "certificates staff update" ON storage.objects;
CREATE POLICY "certificates staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'certificates' AND public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "certificates staff delete" ON storage.objects;
CREATE POLICY "certificates staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'certificates' AND public.is_event_staff() AND public.email_confirmado());

-- certificate-templates (só a organização, em qualquer verbo)
DROP POLICY IF EXISTS "templates staff read" ON storage.objects;
CREATE POLICY "templates staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "templates staff write" ON storage.objects;
CREATE POLICY "templates staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificate-templates' AND public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "templates staff update" ON storage.objects;
CREATE POLICY "templates staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_event_staff() AND public.email_confirmado());

DROP POLICY IF EXISTS "templates staff delete" ON storage.objects;
CREATE POLICY "templates staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_event_staff() AND public.email_confirmado());

-- ============================================================
-- 8. Gate nas RPCs SECURITY DEFINER
-- ============================================================
-- Estas funções rodam como `postgres` e passam POR CIMA do RLS —
-- gatear as policies não as alcança. Cada uma recebe
-- `PERFORM public.exigir_email_confirmado()` no topo.
--
-- NÃO recebem o gate (gatear quebraria o sistema):
--   · is_event_staff / is_app_admin / has_role — chamadas DENTRO das
--     próprias policies; gatear causaria recursão;
--   · get_my_roles — a UI precisa do papel para rotear (exceção declarada);
--   · email_confirmado / exigir_email_confirmado — são o gate;
--   · verify_certificate — `anon` por desenho (validação pública);
--   · consume_rate_limit — primitiva de infraestrutura, não toca dado de usuário;
--   · triggers (handle_new_user, set_updated_at, protect_trabalhos_fields,
--     bloqueia_revisor_em_conflito, check_max_revisores,
--     pareceres_consolida_decisao, sync_avaliador_role,
--     validate_minicourse_registration) — rodam no contexto de uma escrita
--     que JÁ passou pela policy gateada, e handle_new_user roda antes de
--     existir perfil.

-- ------------------------------------------------------------
-- 8a. Funções internas: saem do alcance do cliente
-- ------------------------------------------------------------
-- Todas têm apenas `REVOKE ALL FROM PUBLIC`, o que NÃO desfaz o
-- GRANT padrão do Supabase a anon/authenticated — ou seja, hoje são
-- chamáveis direto pelo PostgREST, contornando o wrapper autorizado.
-- Nenhuma delas é usada pelo frontend (verificado em src/): revogar é
-- mais forte e mais limpo que gatear. Os wrappers são SECURITY
-- DEFINER (rodam como `postgres`) e seguem podendo chamá-las.
REVOKE EXECUTE ON FUNCTION public._pool_revisores()             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._conflitos_por_trabalho()     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conflitos_do_trabalho(uuid)   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decisao_consolidada(uuid)     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aplicar_decisao(uuid)         FROM anon, authenticated;

-- ------------------------------------------------------------
-- 8b. minicourse_occupancy — LANGUAGE sql, não consegue RAISE
-- ------------------------------------------------------------
-- Predicado no corpo. `auth.uid() IS NULL` mantém o catálogo público
-- (anon) funcionando, igual à isenção de `minicourses select`.
CREATE OR REPLACE FUNCTION public.minicourse_occupancy()
RETURNS TABLE(minicourse_id uuid, inscritos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT mr.minicourse_id, count(*)
  FROM public.minicourse_registrations mr
  WHERE mr.status <> 'cancelled'
    AND (auth.uid() IS NULL OR public.email_confirmado())
  GROUP BY mr.minicourse_id;
$$;
REVOKE ALL ON FUNCTION public.minicourse_occupancy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.minicourse_occupancy() TO anon, authenticated;

-- ------------------------------------------------------------
-- 8c. As 9 RPCs plpgsql
-- ------------------------------------------------------------
-- Corpos idênticos aos das migrations que as definiram; a única
-- mudança é a linha do gate.

-- pool_revisores (20260805120000)
CREATE OR REPLACE FUNCTION public.pool_revisores()
RETURNS TABLE(email text, nome text, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  RETURN QUERY SELECT r.email, r.nome, r.tipo FROM public._pool_revisores() r;
END; $$;
REVOKE ALL ON FUNCTION public.pool_revisores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pool_revisores() TO authenticated;

-- conflitos_por_trabalho (20260805120000)
CREATE OR REPLACE FUNCTION public.conflitos_por_trabalho()
RETURNS TABLE(trabalho_id uuid, email text, motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  RETURN QUERY
  SELECT c.trabalho_id, c.email, c.motivo FROM public._conflitos_por_trabalho() c;
END; $$;
REVOKE ALL ON FUNCTION public.conflitos_por_trabalho() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conflitos_por_trabalho() TO authenticated;

-- distribuir_revisores (20260805120000)
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
  PERFORM public.exigir_email_confirmado();
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

-- aplicar_decisao (20260806120000)
-- Chamada pelo trigger de `pareceres` e por migrations: é justamente
-- o caso em que `exigir_email_confirmado()` precisa deixar passar
-- quando não há sessão.
CREATE OR REPLACE FUNCTION public.aplicar_decisao(_trabalho_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_decisao   text;
  v_pareceres integer;
  v_status    text;
BEGIN
  PERFORM public.exigir_email_confirmado();

  SELECT count(DISTINCT lower(p.revisor_email)) INTO v_pareceres
  FROM public.pareceres p
  WHERE p.trabalho_id = _trabalho_id;

  v_decisao := public.decisao_consolidada(_trabalho_id);

  v_status := CASE
    WHEN v_decisao = 'aprovado'           THEN 'aprovado'
    WHEN v_decisao = 'aprovado_correcoes' THEN 'aprovado_correcoes'
    WHEN v_decisao = 'nao_aprovado'       THEN 'reprovado'
    -- Avaliação em curso: já tem parecer, mas ainda não os 3.
    WHEN v_pareceres > 0                  THEN 'em_avaliacao'
    -- Sem nenhum parecer: não mexe no status (pode ter sido definido
    -- manualmente pela organização).
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- A escrita vem do próprio banco, não de uma pessoa: libera o
  -- trigger de proteção só para esta instrução.
  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos t
     SET status = v_status
   WHERE t.id = _trabalho_id
     AND t.status IS DISTINCT FROM v_status;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  RETURN v_status;
END; $$;
REVOKE ALL ON FUNCTION public.aplicar_decisao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicar_decisao(uuid) FROM anon, authenticated;

-- enviar_correcao (20260806120000)
CREATE OR REPLACE FUNCTION public.enviar_correcao(
  _trabalho_id uuid,
  _titulo      text,
  _resumo      text,
  _pdf_url     text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  t          public.trabalhos%ROWTYPE;
  v_pdf_novo text := nullif(trim(coalesce(_pdf_url, '')), '');
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
    RAISE EXCEPTION 'Somente o autor pode enviar a versão corrigida.';
  END IF;
  IF t.status <> 'aprovado_correcoes' THEN
    RAISE EXCEPTION 'Este trabalho não está aguardando correções.';
  END IF;
  IF coalesce(trim(_titulo), '') = '' OR coalesce(trim(_resumo), '') = '' THEN
    RAISE EXCEPTION 'Título e resumo são obrigatórios.';
  END IF;
  -- O PDF novo tem que estar na pasta do próprio autor, a mesma regra
  -- que a política de Storage aplica no upload.
  IF v_pdf_novo IS NOT NULL AND split_part(v_pdf_novo, '/', 1) <> auth.uid()::text THEN
    RAISE EXCEPTION 'Caminho de PDF inválido.';
  END IF;

  PERFORM set_config('app.decisao_automatica', 'on', true);
  UPDATE public.trabalhos
     SET titulo                = trim(_titulo),
         resumo                = trim(_resumo),
         pdf_url               = coalesce(v_pdf_novo, pdf_url),
         status                = 'aprovado',
         correcoes_enviadas_em = now()
   WHERE id = _trabalho_id;
  PERFORM set_config('app.decisao_automatica', 'off', true);

  -- Caminho do arquivo substituído (NULL quando o PDF não mudou).
  RETURN CASE
    WHEN v_pdf_novo IS NOT NULL AND t.pdf_url IS DISTINCT FROM v_pdf_novo THEN t.pdf_url
    ELSE NULL
  END;
END; $$;
REVOKE ALL ON FUNCTION public.enviar_correcao(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enviar_correcao(uuid, text, text, text) TO authenticated;

-- pareceres_do_meu_trabalho (20260806120000)
CREATE OR REPLACE FUNCTION public.pareceres_do_meu_trabalho(_trabalho_id uuid)
RETURNS TABLE(ordem integer, resultado text, comentario_geral text, itens jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trabalhos t
    WHERE t.id = _trabalho_id
      AND (t.owner_id = auth.uid() OR public.is_event_staff())
  ) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Sem decisão fechada, nada é revelado (avaliação às cegas).
  IF public.decisao_consolidada(_trabalho_id) IS NULL AND NOT public.is_event_staff() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (row_number() OVER (ORDER BY p.created_at, p.id))::integer,
         p.resultado,
         p.comentario_geral,
         p.itens
  FROM public.pareceres p
  WHERE p.trabalho_id = _trabalho_id;
END; $$;
REVOKE ALL ON FUNCTION public.pareceres_do_meu_trabalho(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pareceres_do_meu_trabalho(uuid) TO authenticated;

-- verify_and_mark_certificate (20260709120000)
CREATE OR REPLACE FUNCTION public.verify_and_mark_certificate(_code text)
RETURNS TABLE(
  verification_code text, atividade text, carga_horaria integer,
  data_liberacao timestamptz, verified_at timestamptz, verification_count integer,
  participante_nome text, participante_instituicao text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE public.certificates c
     SET verified_at = now(), verified_by = auth.uid(),
         verification_count = c.verification_count + 1
   WHERE c.verification_code = _code AND c.data_liberacao IS NOT NULL;
  RETURN QUERY
  SELECT c.verification_code, c.atividade, c.carga_horaria, c.data_liberacao,
         c.verified_at, c.verification_count, p.nome, p.instituicao
    FROM public.certificates c
    LEFT JOIN public.profiles p ON p.id = c.user_id
   WHERE c.verification_code = _code LIMIT 1;
END; $$;
REVOKE ALL ON FUNCTION public.verify_and_mark_certificate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_and_mark_certificate(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_and_mark_certificate(text) TO authenticated;

-- mark_attendance (20260709120000)
CREATE OR REPLACE FUNCTION public.mark_attendance(_event_type text, _event_id uuid, _user_id uuid)
RETURNS TABLE(
  participante_nome text, participante_email text, evento_titulo text,
  checked_in_at timestamptz, already boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_already BOOLEAN := false;
  v_evt_title TEXT;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _event_type NOT IN ('minicourse','schedule') THEN RAISE EXCEPTION 'Tipo de evento inválido'; END IF;

  SELECT a.checked_in_at INTO v_existing FROM public.attendances a
   WHERE a.event_type=_event_type AND a.event_id=_event_id AND a.user_id=_user_id;

  IF v_existing IS NOT NULL THEN
    v_already := true;
  ELSE
    INSERT INTO public.attendances(event_type,event_id,user_id,checked_in_by,checked_in_at)
    VALUES(_event_type,_event_id,_user_id,auth.uid(),v_now);
    v_existing := v_now;
  END IF;

  IF _event_type='minicourse' THEN
    SELECT nome INTO v_evt_title FROM public.minicourses WHERE id=_event_id;
  ELSE
    SELECT titulo INTO v_evt_title FROM public.schedule WHERE id=_event_id;
  END IF;

  RETURN QUERY
  SELECT p.nome, p.email, v_evt_title, v_existing, v_already
    FROM public.profiles p WHERE p.id=_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.mark_attendance(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_attendance(text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_attendance(text, uuid, uuid) TO authenticated;

-- close_event_and_issue_certificates (20260709120000)
CREATE OR REPLACE FUNCTION public.close_event_and_issue_certificates(
  _event_type text, _event_id uuid, _carga_horaria integer
)
RETURNS TABLE(user_id uuid, certificate_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title TEXT;
  r RECORD;
  v_existing UUID;
  v_new UUID;
BEGIN
  PERFORM public.exigir_email_confirmado();
  IF NOT public.is_event_staff() THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  IF _event_type='minicourse' THEN
    SELECT nome INTO v_title FROM public.minicourses WHERE id=_event_id;
  ELSIF _event_type='schedule' THEN
    SELECT titulo INTO v_title FROM public.schedule WHERE id=_event_id;
  ELSE
    RAISE EXCEPTION 'Tipo de evento inválido';
  END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Evento não encontrado'; END IF;

  FOR r IN
    SELECT a.user_id FROM public.attendances a
     WHERE a.event_type=_event_type AND a.event_id=_event_id
  LOOP
    SELECT c.id INTO v_existing FROM public.certificates c
      WHERE c.user_id=r.user_id AND c.event_source=_event_type AND c.event_id=_event_id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      user_id := r.user_id; certificate_id := v_existing; created := false; RETURN NEXT;
    ELSE
      INSERT INTO public.certificates(
        user_id, event_source, event_id, atividade, carga_horaria,
        data_liberacao, verification_code)
      VALUES(
        r.user_id, _event_type, _event_id, v_title, _carga_horaria,
        now(), substr(replace(gen_random_uuid()::text,'-',''),1,16))
      RETURNING id INTO v_new;
      user_id := r.user_id; certificate_id := v_new; created := true; RETURN NEXT;
    END IF;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) TO authenticated;

-- ------------------------------------------------------------
-- 9. Conferência final — a migration aborta se o gate ficou incompleto
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sem_gate TEXT;
  v_nao_conf INTEGER;
BEGIN
  -- Policies `authenticated` de public sem o gate: só as 4 exceções.
  SELECT string_agg(p.tablename || '.' || p.policyname, ', ' ORDER BY p.tablename, p.policyname)
    INTO v_sem_gate
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND 'authenticated' = ANY (p.roles)
    AND coalesce(p.qual, '')       NOT LIKE '%email_confirmado%'
    AND coalesce(p.with_check, '') NOT LIKE '%email_confirmado%'
    AND (p.tablename, p.policyname) NOT IN (
      ('minicourses', 'minicourses select'),
      ('schedule',    'schedule select')
    );

  IF v_sem_gate IS NOT NULL THEN
    RAISE EXCEPTION 'Gate incompleto — policies sem email_confirmado(): %', v_sem_gate;
  END IF;

  -- Backfill: nenhuma conta pré-existente pode ter ficado de fora.
  -- A cobrança só vale enquanto nenhum token foi cunhado — depois que
  -- a feature entra em uso, perfis não confirmados são o esperado.
  SELECT count(*) INTO v_nao_conf FROM public.profiles WHERE email_confirmado_em IS NULL;
  IF v_nao_conf > 0 AND NOT EXISTS (SELECT 1 FROM public.tokens_email) THEN
    RAISE EXCEPTION 'Backfill incompleto: % perfil(is) sem email_confirmado_em.', v_nao_conf;
  END IF;

  RAISE NOTICE 'Verificação OK: gate completo e backfill aplicado.';
END $$;
