-- ============================================================
-- SECURITY HARDENING — SEC-01 .. SEC-09 (SECURITY_ANALYSIS.md)
-- ------------------------------------------------------------
--  * SEC-01/02: substitui todas as políticas RLS abertas
--    (USING (true)) por regras de dono/papel; autorização passa a
--    ser aplicada no banco, não só no React.
--  * SEC-04/06: papéis saem de tabelas abertas/e-mail hardcoded e
--    passam para public.user_roles (gravável só por admin) +
--    funções SECURITY DEFINER. O admin é semeado por script
--    (scripts/seed-admin.js), nunca por e-mail no código.
--  * SEC-05: buckets de Storage ficam privados; objetos com
--    política por dono (pasta = auth.uid()); download via URL
--    assinada.
--  * SEC-07: domínios de e-mail permitidos são validados no
--    servidor (trigger em auth.users); papéis derivados do
--    domínio no cadastro. ("Confirm email" é ativado no painel —
--    ver SECURITY_SETUP.md.)
--  * SEC-08: rate limiting por IP no RPC público
--    verify_certificate (+ match exato do código, sem prefixo).
--  * SEC-09: PII (profiles, estudantes, professores) legível só
--    pelo próprio usuário e pela organização.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Modelo de papéis (SEC-04, SEC-06)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- A coluna role pode ter sido criada como enum app_role — converte p/ texto.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_roles'
      AND column_name = 'role' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE public.user_roles ALTER COLUMN role TYPE TEXT USING role::text;
  END IF;
END $$;

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'avaliador', 'professor', 'estudante', 'participant'));

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO anon, authenticated;

-- Redefinido: admin agora vem de user_roles, não de e-mail hardcoded (SEC-06).
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO anon, authenticated;

-- Organização do evento: admin ou avaliador (co-chairs).
CREATE OR REPLACE FUNCTION public.is_event_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'avaliador');
$$;
REVOKE ALL ON FUNCTION public.is_event_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_staff() TO anon, authenticated;

-- Papéis do usuário logado (usado pelo frontend no lugar das
-- consultas abertas a avaliadores/professores).
CREATE OR REPLACE FUNCTION public.get_my_roles()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(array_agg(role), '{}'::text[])
  FROM public.user_roles WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_roles() TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. Domínios de e-mail permitidos + trigger de cadastro (SEC-07)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.allowed_email_domains (
  domain     TEXT PRIMARY KEY,
  role       TEXT NOT NULL DEFAULT 'estudante'
             CHECK (role IN ('estudante', 'professor', 'participant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.allowed_email_domains (domain, role) VALUES
  ('estudante.ufla.br', 'estudante'),
  ('ufla.br',           'professor')
ON CONFLICT (domain) DO NOTHING;

-- Cadastro: valida o domínio NO SERVIDOR, cria profile/perfil e
-- atribui o papel derivado do domínio (nunca de user_metadata).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email  TEXT := lower(coalesce(NEW.email, ''));
  v_domain TEXT := split_part(v_email, '@', 2);
  v_role   TEXT;
  v_nome   TEXT := coalesce(NEW.raw_user_meta_data->>'nome', split_part(v_email, '@', 1));
BEGIN
  SELECT d.role INTO v_role FROM public.allowed_email_domains d WHERE d.domain = v_domain;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Cadastro permitido apenas para e-mails institucionais autorizados.';
  END IF;

  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, v_nome, v_email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF v_role = 'estudante' THEN
    INSERT INTO public.estudantes (user_id, nome, email, matricula, periodo, curso)
    VALUES (NEW.id, v_nome, v_email,
            NEW.raw_user_meta_data->>'matricula',
            NEW.raw_user_meta_data->>'periodo',
            NEW.raw_user_meta_data->>'curso')
    ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id;
  ELSIF v_role = 'professor' THEN
    INSERT INTO public.professores (user_id, nome, email, departamento)
    VALUES (NEW.id, v_nome, v_email,
            coalesce(NEW.raw_user_meta_data->>'departamento', ''))
    ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id;
  END IF;

  -- E-mail já cadastrado como avaliador pela organização → recebe o papel.
  IF EXISTS (SELECT 1 FROM public.avaliadores a WHERE lower(a.email) = v_email) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'avaliador')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Avaliador cadastrado/removido pela organização → sincroniza papel.
CREATE OR REPLACE FUNCTION public.sync_avaliador_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT u.id, 'avaliador' FROM auth.users u
    WHERE lower(u.email) = lower(NEW.email)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR lower(OLD.email) <> lower(NEW.email)) THEN
    DELETE FROM public.user_roles ur
    USING auth.users u
    WHERE ur.user_id = u.id AND ur.role = 'avaliador'
      AND lower(u.email) = lower(OLD.email)
      AND NOT EXISTS (
        SELECT 1 FROM public.avaliadores a
        WHERE lower(a.email) = lower(OLD.email) AND a.id <> OLD.id
      );
  END IF;
  RETURN coalesce(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_sync_avaliador_role ON public.avaliadores;
CREATE TRIGGER trg_sync_avaliador_role
  AFTER INSERT OR UPDATE OF email OR DELETE ON public.avaliadores
  FOR EACH ROW EXECUTE FUNCTION public.sync_avaliador_role();

-- Backfill: usuários existentes ganham profile + papéis coerentes.
INSERT INTO public.profiles (id, nome, email)
SELECT u.id,
       coalesce(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1)),
       lower(u.email)
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT e.user_id, 'estudante' FROM public.estudantes e WHERE e.user_id IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'professor' FROM public.professores p WHERE p.user_id IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'avaliador'
FROM auth.users u
JOIN public.avaliadores a ON lower(a.email) = lower(u.email)
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, d.role
FROM auth.users u
JOIN public.allowed_email_domains d ON split_part(lower(u.email), '@', 2) = d.domain
ON CONFLICT (user_id, role) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Dono do trabalho + proteção de campos (SEC-01, SEC-16)
-- ------------------------------------------------------------
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_trabalhos_owner ON public.trabalhos(owner_id);

-- Não-organização: não escolhe dono nem status (sempre 'pendente'
-- ao criar; status imutável depois).
CREATE OR REPLACE FUNCTION public.protect_trabalhos_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Contexto de servidor (service_role/migrações) — não interfere.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_event_staff() THEN
      NEW.owner_id := auth.uid();
      NEW.status   := 'pendente';
    ELSIF NEW.owner_id IS NULL THEN
      NEW.owner_id := auth.uid();
    END IF;
  ELSE
    IF NOT public.is_event_staff() THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Somente a organização pode alterar o status do trabalho.';
      END IF;
      NEW.owner_id := OLD.owner_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protect_trabalhos ON public.trabalhos;
CREATE TRIGGER trg_protect_trabalhos
  BEFORE INSERT OR UPDATE ON public.trabalhos
  FOR EACH ROW EXECUTE FUNCTION public.protect_trabalhos_fields();

-- ------------------------------------------------------------
-- 4. Distribuição automática de revisores via RPC (o estudante
--    não precisa mais de leitura/escrita em avaliadores,
--    professores e trabalho_revisores) (SEC-01)
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
    FROM (
      SELECT DISTINCT ON (lower(x.email)) lower(x.email) AS email, x.nome, x.tipo
      FROM (
        SELECT a.email, a.nome, 'avaliador'::text AS tipo, 0 AS prio FROM public.avaliadores a
        UNION ALL
        SELECT p.email, p.nome, 'professor'::text, 1 FROM public.professores p
      ) x
      WHERE x.email IS NOT NULL AND x.email <> ''
      ORDER BY lower(x.email), x.prio
    ) pool
    CROSS JOIN LATERAL (
      SELECT count(*) AS carga FROM public.trabalho_revisores tr
      WHERE lower(tr.revisor_email) = pool.email
    ) c
    WHERE c.carga < v_limite_por_revisor
      AND NOT EXISTS (
        SELECT 1 FROM public.trabalho_revisores tr2
        WHERE tr2.trabalho_id = _trabalho_id AND lower(tr2.revisor_email) = pool.email
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

-- Ocupação dos minicursos sem expor quem se inscreveu (SEC-09).
CREATE OR REPLACE FUNCTION public.minicourse_occupancy()
RETURNS TABLE(minicourse_id uuid, inscritos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT mr.minicourse_id, count(*)
  FROM public.minicourse_registrations mr
  WHERE mr.status <> 'cancelled'
  GROUP BY mr.minicourse_id;
$$;
REVOKE ALL ON FUNCTION public.minicourse_occupancy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.minicourse_occupancy() TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. Rate limiting por IP para endpoints públicos (SEC-08)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  hits         INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- Sem políticas e sem grants: só funções SECURITY DEFINER acessam.

CREATE OR REPLACE FUNCTION public.consume_rate_limit(_key text, _max integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hits integer;
BEGIN
  DELETE FROM public.rate_limits
  WHERE window_start < now() - (_window_seconds * 2) * interval '1 second';

  INSERT INTO public.rate_limits AS rl (key, window_start, hits)
  VALUES (_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE WHEN rl.window_start < now() - _window_seconds * interval '1 second'
                THEN 1 ELSE rl.hits + 1 END,
    window_start = CASE WHEN rl.window_start < now() - _window_seconds * interval '1 second'
                        THEN now() ELSE rl.window_start END
  RETURNING hits INTO v_hits;

  RETURN v_hits <= _max;
END; $$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC;

-- verify_certificate: match EXATO (sem enumeração por prefixo) +
-- limite de 30 consultas / 5 min por IP.
-- (DROP + CREATE porque a linguagem muda de sql para plpgsql.)
DROP FUNCTION IF EXISTS public.verify_certificate(text);
CREATE FUNCTION public.verify_certificate(_code text)
RETURNS TABLE(
  verification_code text, atividade text, carga_horaria integer,
  data_liberacao timestamptz, participante_nome text, participante_instituicao text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ip   text;
  v_code text := lower(regexp_replace(coalesce(_code, ''), '[^a-zA-Z0-9]', '', 'g'));
BEGIN
  v_ip := coalesce(
    nullif(split_part(coalesce(current_setting('request.headers', true), '{}')::json->>'x-forwarded-for', ',', 1), ''),
    'unknown'
  );
  IF NOT public.consume_rate_limit('verify_certificate:' || v_ip, 30, 300) THEN
    RAISE EXCEPTION 'Muitas tentativas de verificação. Tente novamente em alguns minutos.';
  END IF;

  RETURN QUERY
  SELECT c.verification_code, c.atividade, c.carga_horaria, c.data_liberacao,
         p.nome, p.instituicao
    FROM public.certificates c
    LEFT JOIN public.profiles p ON p.id = c.user_id
   WHERE c.data_liberacao IS NOT NULL
     AND c.verification_code = v_code
   LIMIT 1;
END; $$;
REVOKE ALL ON FUNCTION public.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 6. RPCs administrativos: papel no banco, não e-mail (SEC-02/06)
--    (co-chairs = admin OU avaliador, como nas rotas do app)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_and_mark_certificate(_code text)
RETURNS TABLE(
  verification_code text, atividade text, carga_horaria integer,
  data_liberacao timestamptz, verified_at timestamptz, verification_count integer,
  participante_nome text, participante_instituicao text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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

REVOKE ALL ON FUNCTION public.verify_and_mark_certificate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_attendance(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_and_mark_certificate(text) FROM anon;
REVOKE ALL ON FUNCTION public.mark_attendance(text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_and_mark_certificate(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) TO authenticated;

-- ------------------------------------------------------------
-- 7. RLS: remove TODAS as políticas abertas e recria com escopo
--    de dono/papel (SEC-01, SEC-02, SEC-09)
-- ------------------------------------------------------------
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Garante RLS ligado em tudo (inclusive tabelas novas).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categorias','avaliadores','trabalhos','avaliacoes','estudantes','professores',
    'criterios','trabalho_revisores','pareceres','profiles','user_roles',
    'congress_registrations','minicourses','minicourse_registrations','schedule',
    'certificates','notifications','notification_reads','attendances',
    'allowed_email_domains','rate_limits'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- categorias / criterios: leitura autenticada; escrita da organização.
CREATE POLICY "categorias select" ON public.categorias FOR SELECT TO authenticated USING (true);
CREATE POLICY "categorias write"  ON public.categorias FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

CREATE POLICY "criterios select" ON public.criterios FOR SELECT TO authenticated USING (true);
CREATE POLICY "criterios write"  ON public.criterios FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

-- avaliadores: organização gerencia; revisor enxerga a própria linha.
CREATE POLICY "avaliadores select" ON public.avaliadores FOR SELECT TO authenticated
  USING (public.is_event_staff() OR lower(email) = lower(auth.email()));
CREATE POLICY "avaliadores write" ON public.avaliadores FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

-- estudantes / professores: PII — só o próprio usuário e a organização (SEC-09).
CREATE POLICY "estudantes select" ON public.estudantes FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid() OR lower(email) = lower(auth.email()));
CREATE POLICY "estudantes insert" ON public.estudantes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND lower(email) = lower(auth.email()));
CREATE POLICY "estudantes update" ON public.estudantes FOR UPDATE TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid() OR lower(email) = lower(auth.email()))
  WITH CHECK (public.is_event_staff() OR user_id = auth.uid() OR lower(email) = lower(auth.email()));
CREATE POLICY "estudantes delete" ON public.estudantes FOR DELETE TO authenticated
  USING (public.is_event_staff());

CREATE POLICY "professores select" ON public.professores FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid() OR lower(email) = lower(auth.email()));
CREATE POLICY "professores insert" ON public.professores FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND lower(email) = lower(auth.email()));
CREATE POLICY "professores update" ON public.professores FOR UPDATE TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid() OR lower(email) = lower(auth.email()))
  WITH CHECK (public.is_event_staff() OR user_id = auth.uid() OR lower(email) = lower(auth.email()));
CREATE POLICY "professores delete" ON public.professores FOR DELETE TO authenticated
  USING (public.is_event_staff());

-- trabalhos: dono, revisores associados e organização.
CREATE POLICY "trabalhos select" ON public.trabalhos FOR SELECT TO authenticated
  USING (
    public.is_event_staff()
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.trabalho_revisores tr
      WHERE tr.trabalho_id = trabalhos.id AND lower(tr.revisor_email) = lower(auth.email())
    )
  );
CREATE POLICY "trabalhos insert" ON public.trabalhos FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() OR public.is_event_staff());
CREATE POLICY "trabalhos update" ON public.trabalhos FOR UPDATE TO authenticated
  USING (public.is_event_staff() OR (owner_id = auth.uid() AND status = 'pendente'))
  WITH CHECK (public.is_event_staff() OR owner_id = auth.uid());
CREATE POLICY "trabalhos delete" ON public.trabalhos FOR DELETE TO authenticated
  USING (public.is_event_staff() OR (owner_id = auth.uid() AND status = 'pendente'));

-- avaliacoes: organização + o avaliador dono da atribuição.
CREATE POLICY "avaliacoes select" ON public.avaliacoes FOR SELECT TO authenticated
  USING (
    public.is_event_staff()
    OR EXISTS (
      SELECT 1 FROM public.avaliadores a
      WHERE a.id = avaliacoes.avaliador_id AND lower(a.email) = lower(auth.email())
    )
  );
CREATE POLICY "avaliacoes insert" ON public.avaliacoes FOR INSERT TO authenticated
  WITH CHECK (public.is_event_staff());
CREATE POLICY "avaliacoes update" ON public.avaliacoes FOR UPDATE TO authenticated
  USING (
    public.is_event_staff()
    OR EXISTS (
      SELECT 1 FROM public.avaliadores a
      WHERE a.id = avaliacoes.avaliador_id AND lower(a.email) = lower(auth.email())
    )
  )
  WITH CHECK (
    public.is_event_staff()
    OR EXISTS (
      SELECT 1 FROM public.avaliadores a
      WHERE a.id = avaliacoes.avaliador_id AND lower(a.email) = lower(auth.email())
    )
  );
CREATE POLICY "avaliacoes delete" ON public.avaliacoes FOR DELETE TO authenticated
  USING (public.is_event_staff());

-- trabalho_revisores: organização gerencia; revisor vê as próprias.
CREATE POLICY "trabalho_revisores select" ON public.trabalho_revisores FOR SELECT TO authenticated
  USING (public.is_event_staff() OR lower(revisor_email) = lower(auth.email()));
CREATE POLICY "trabalho_revisores write" ON public.trabalho_revisores FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

-- pareceres: revisor associado escreve o próprio; organização lê tudo.
CREATE POLICY "pareceres select" ON public.pareceres FOR SELECT TO authenticated
  USING (public.is_event_staff() OR lower(revisor_email) = lower(auth.email()));
CREATE POLICY "pareceres insert" ON public.pareceres FOR INSERT TO authenticated
  WITH CHECK (
    public.is_event_staff()
    OR (
      lower(revisor_email) = lower(auth.email())
      AND EXISTS (
        SELECT 1 FROM public.trabalho_revisores tr
        WHERE tr.trabalho_id = pareceres.trabalho_id
          AND lower(tr.revisor_email) = lower(auth.email())
      )
    )
  );
CREATE POLICY "pareceres update" ON public.pareceres FOR UPDATE TO authenticated
  USING (public.is_event_staff() OR lower(revisor_email) = lower(auth.email()))
  WITH CHECK (public.is_event_staff() OR lower(revisor_email) = lower(auth.email()));
CREATE POLICY "pareceres delete" ON public.pareceres FOR DELETE TO authenticated
  USING (public.is_event_staff());

-- profiles: PII — próprio usuário + organização (SEC-09).
CREATE POLICY "profiles select" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_event_staff() OR id = auth.uid());
CREATE POLICY "profiles insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles update" ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_event_staff() OR id = auth.uid())
  WITH CHECK (public.is_event_staff() OR id = auth.uid());
CREATE POLICY "profiles delete" ON public.profiles FOR DELETE TO authenticated
  USING (public.is_app_admin());

-- user_roles: leitura do próprio papel; escrita SÓ admin (SEC-04).
CREATE POLICY "user_roles select" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_app_admin() OR user_id = auth.uid());
CREATE POLICY "user_roles write" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

-- allowed_email_domains: leitura autenticada; escrita só admin.
CREATE POLICY "allowed_domains select" ON public.allowed_email_domains FOR SELECT TO authenticated USING (true);
CREATE POLICY "allowed_domains write" ON public.allowed_email_domains FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

-- congress_registrations: inscrição própria; gestão pela organização.
CREATE POLICY "congress_reg select" ON public.congress_registrations FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());
CREATE POLICY "congress_reg insert" ON public.congress_registrations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "congress_reg update" ON public.congress_registrations FOR UPDATE TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());
CREATE POLICY "congress_reg delete" ON public.congress_registrations FOR DELETE TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());

-- minicourses / schedule: programação pública (sem PII); escrita da organização.
CREATE POLICY "minicourses select" ON public.minicourses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "minicourses write" ON public.minicourses FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

CREATE POLICY "schedule select" ON public.schedule FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "schedule write" ON public.schedule FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

-- minicourse_registrations: cada um gerencia a própria inscrição.
CREATE POLICY "mini_reg select" ON public.minicourse_registrations FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());
CREATE POLICY "mini_reg insert" ON public.minicourse_registrations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "mini_reg update" ON public.minicourse_registrations FOR UPDATE TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid())
  WITH CHECK (public.is_event_staff() OR user_id = auth.uid());
CREATE POLICY "mini_reg delete" ON public.minicourse_registrations FOR DELETE TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());

-- certificates: dono lê; organização emite/gerencia.
CREATE POLICY "certificates select" ON public.certificates FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());
CREATE POLICY "certificates write" ON public.certificates FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

-- notifications: destinatário (ou broadcast) lê; organização escreve.
CREATE POLICY "notifications select" ON public.notifications FOR SELECT TO authenticated
  USING (public.is_event_staff() OR audience = 'all' OR user_id = auth.uid());
CREATE POLICY "notifications write" ON public.notifications FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

-- notification_reads: cada um marca as próprias leituras.
CREATE POLICY "notif_reads select" ON public.notification_reads FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());
CREATE POLICY "notif_reads insert" ON public.notification_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif_reads delete" ON public.notification_reads FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- attendances: check-in só pela organização (via RPC); dono lê o próprio.
CREATE POLICY "attendances select" ON public.attendances FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());
CREATE POLICY "attendances write" ON public.attendances FOR ALL TO authenticated
  USING (public.is_event_staff()) WITH CHECK (public.is_event_staff());

-- ------------------------------------------------------------
-- 8. Grants: anon perde escrita em tudo; leitura anônima só do
--    que é realmente público (SEC-01)
-- ------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Programação pública do congresso (sem PII).
GRANT SELECT ON public.minicourses, public.schedule TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.categorias, public.criterios, public.avaliadores, public.trabalhos,
  public.avaliacoes, public.estudantes, public.professores,
  public.trabalho_revisores, public.pareceres, public.profiles, public.user_roles,
  public.congress_registrations, public.minicourses, public.minicourse_registrations,
  public.schedule, public.certificates, public.notifications,
  public.notification_reads, public.attendances, public.allowed_email_domains
TO authenticated;

-- A view de verificação fica sem acesso direto: o caminho público
-- é o RPC verify_certificate (com rate limit).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='certificate_verifications') THEN
    REVOKE ALL ON public.certificate_verifications FROM anon, authenticated;
  END IF;
END $$;

-- Tabela interna do runner de migrações: sem acesso pela API.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_migrations') THEN
    REVOKE ALL ON public._migrations FROM anon, authenticated;
    ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 9. Storage: buckets privados + políticas por dono (SEC-05)
-- ------------------------------------------------------------
UPDATE storage.buckets SET public = false
WHERE id IN ('Pdfs', 'avatars', 'certificates', 'certificate-templates');

-- Remove as políticas abertas antigas.
DO $$
DECLARE n TEXT;
BEGIN
  FOREACH n IN ARRAY ARRAY[
    'pdfs public read','pdfs public insert','pdfs public update','pdfs public delete',
    'public read avatars','public write avatars','public update avatars','public delete avatars',
    'public read certificates','public write certificates','public update certificates','public delete certificates',
    'public read certificate-templates','public write certificate-templates',
    'public update certificate-templates','public delete certificate-templates',
    'pdfs owner read','pdfs owner insert','pdfs owner update','pdfs owner delete',
    'avatars owner read','avatars owner write','avatars owner update','avatars owner delete',
    'certificates owner read','certificates staff write','certificates staff update','certificates staff delete',
    'templates staff read','templates staff write','templates staff update','templates staff delete'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', n);
  END LOOP;
END $$;

-- Pdfs: upload na pasta do próprio usuário; leitura pelo dono,
-- pela organização e pelos revisores (professores/avaliadores).
CREATE POLICY "pdfs owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'Pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "pdfs owner read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'Pdfs' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_event_staff()
      OR public.has_role(auth.uid(), 'professor')
    )
  );
CREATE POLICY "pdfs owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'Pdfs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_event_staff()));
CREATE POLICY "pdfs owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'Pdfs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_event_staff()));

-- avatars: pasta do próprio usuário.
CREATE POLICY "avatars owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_event_staff()));
CREATE POLICY "avatars owner write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- certificates: dono lê (pasta = user_id); organização emite.
CREATE POLICY "certificates owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'certificates' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_event_staff()));
CREATE POLICY "certificates staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificates' AND public.is_event_staff());
CREATE POLICY "certificates staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'certificates' AND public.is_event_staff());
CREATE POLICY "certificates staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'certificates' AND public.is_event_staff());

-- certificate-templates: só a organização.
CREATE POLICY "templates staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_event_staff());
CREATE POLICY "templates staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificate-templates' AND public.is_event_staff());
CREATE POLICY "templates staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_event_staff());
CREATE POLICY "templates staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_event_staff());
