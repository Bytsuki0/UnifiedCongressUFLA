-- ============================================================
-- Event-management pages (ported from the "zip" congress site)
-- ------------------------------------------------------------
-- Adapted to THIS project's model:
--   * Open RLS policies (USING (true) / WITH CHECK (true)) like the
--     rest of the app, which operates with the anon key.
--   * Admin is NOT driven by user_roles.role = 'admin'. It is the
--     hardcoded e-mail used everywhere else: bytsuki066@gmail.com.
--   * The conflicting objects from the original zip migration
--     (app_role enum, profiles table, user_roles table, has_role)
--     are NOT recreated here. We only EXTEND the existing profiles
--     table with the extra columns the event pages need.
-- ============================================================

-- 0. Admin helper (e-mail based, matches AuthContext) ----------
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND email = 'bytsuki066@gmail.com'
  );
$$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO anon, authenticated;

-- 1. Enum: registration status --------------------------------
DO $$ BEGIN
  CREATE TYPE public.registration_status AS ENUM ('pending', 'approved', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Extend existing profiles (do NOT recreate it) ------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cpf         TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telefone    TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS instituicao TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS curso       TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS foto_perfil TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now();

-- 3. Congress registrations -----------------------------------
CREATE TABLE IF NOT EXISTS public.congress_registrations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status     public.registration_status NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Minicourses ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.minicourses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                     TEXT NOT NULL,
  descricao                TEXT,
  ministrante              TEXT NOT NULL,
  data                     DATE NOT NULL,
  horario_inicio           TIME NOT NULL,
  horario_fim              TIME NOT NULL,
  local                    TEXT NOT NULL,
  vagas                    INTEGER NOT NULL CHECK (vagas > 0),
  carga_horaria            INTEGER NOT NULL DEFAULT 2,
  certificate_template_url TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Minicourse registrations ---------------------------------
CREATE TABLE IF NOT EXISTS public.minicourse_registrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minicourse_id UUID NOT NULL REFERENCES public.minicourses(id) ON DELETE CASCADE,
  status        public.registration_status NOT NULL DEFAULT 'approved',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, minicourse_id)
);

-- Trigger: enforce vagas + time-conflict on enrollment
CREATE OR REPLACE FUNCTION public.validate_minicourse_registration()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_vagas INTEGER;
  v_data DATE;
  v_inicio TIME;
  v_fim TIME;
  v_conflict INTEGER;
BEGIN
  SELECT vagas, data, horario_inicio, horario_fim INTO v_vagas, v_data, v_inicio, v_fim
  FROM public.minicourses WHERE id = NEW.minicourse_id;
  SELECT COUNT(*) INTO v_count FROM public.minicourse_registrations
    WHERE minicourse_id = NEW.minicourse_id AND status <> 'cancelled';
  IF v_count >= v_vagas THEN
    RAISE EXCEPTION 'Sem vagas disponíveis neste minicurso';
  END IF;
  SELECT COUNT(*) INTO v_conflict FROM public.minicourse_registrations mr
    JOIN public.minicourses m ON m.id = mr.minicourse_id
    WHERE mr.user_id = NEW.user_id AND mr.status <> 'cancelled'
      AND m.data = v_data
      AND (m.horario_inicio, m.horario_fim) OVERLAPS (v_inicio, v_fim);
  IF v_conflict > 0 THEN
    RAISE EXCEPTION 'Conflito de horário com outro minicurso já inscrito';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_minicourse_reg ON public.minicourse_registrations;
CREATE TRIGGER trg_validate_minicourse_reg
  BEFORE INSERT ON public.minicourse_registrations
  FOR EACH ROW EXECUTE FUNCTION public.validate_minicourse_registration();

-- 6. Schedule (programação) -----------------------------------
CREATE TABLE IF NOT EXISTS public.schedule (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo                   TEXT NOT NULL,
  descricao                TEXT,
  categoria                TEXT NOT NULL,
  data                     DATE NOT NULL,
  horario_inicio           TIME NOT NULL,
  horario_fim              TIME NOT NULL,
  local                    TEXT NOT NULL,
  palestrante              TEXT,
  certificate_template_url TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Certificates ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.certificates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atividade          TEXT NOT NULL,
  carga_horaria      INTEGER NOT NULL,
  arquivo_url        TEXT,
  data_liberacao     TIMESTAMPTZ,
  verification_code  TEXT UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  event_id           UUID,
  event_source       TEXT,
  email_sent_at      TIMESTAMPTZ,
  verified_at        TIMESTAMPTZ,
  verified_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_count INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Notifications + read receipts ----------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  audience   TEXT NOT NULL DEFAULT 'user' CHECK (audience IN ('user','all')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

-- 9. Attendances (QR check-in) --------------------------------
CREATE TABLE IF NOT EXISTS public.attendances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT NOT NULL CHECK (event_type IN ('minicourse','schedule')),
  event_id      UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (event_type, event_id, user_id)
);
CREATE INDEX IF NOT EXISTS attendances_event_idx ON public.attendances(event_type, event_id);

-- ============================================================
-- RLS + grants — open policies, consistent with the rest of app
-- ============================================================
ALTER TABLE public.congress_registrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minicourses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minicourse_registrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances               ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'congress_registrations','minicourses','minicourse_registrations','schedule',
    'certificates','notifications','notification_reads','attendances'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "public all %1$s" ON public.%1$s;', t);
    EXECUTE format('CREATE POLICY "public all %1$s" ON public.%1$s FOR ALL USING (true) WITH CHECK (true);', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%1$s TO anon, authenticated;', t);
    EXECUTE format('GRANT ALL ON public.%1$s TO service_role;', t);
  END LOOP;
END $$;

-- ============================================================
-- Public certificate verification (anon-readable)
-- ============================================================
DROP VIEW IF EXISTS public.certificate_verifications;
CREATE VIEW public.certificate_verifications
WITH (security_invoker = on) AS
  SELECT
    c.verification_code,
    c.atividade,
    c.carga_horaria,
    c.data_liberacao,
    p.nome        AS participante_nome,
    p.instituicao AS participante_instituicao
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.data_liberacao IS NOT NULL;
GRANT SELECT ON public.certificate_verifications TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_certificate(_code text)
RETURNS TABLE(
  verification_code text, atividade text, carga_horaria integer,
  data_liberacao timestamptz, participante_nome text, participante_instituicao text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH norm AS (
    SELECT lower(regexp_replace(coalesce(_code,''), '[^a-zA-Z0-9]', '', 'g')) AS c
  ), m AS (
    SELECT c.* FROM public.certificates c, norm
     WHERE c.data_liberacao IS NOT NULL
       AND ( c.verification_code = norm.c
          OR (length(norm.c) >= 8 AND c.verification_code LIKE norm.c || '%') )
     LIMIT 1
  )
  SELECT m.verification_code, m.atividade, m.carga_horaria, m.data_liberacao,
         p.nome, p.instituicao
    FROM m LEFT JOIN public.profiles p ON p.id = m.user_id;
$$;
REVOKE ALL ON FUNCTION public.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;

-- ============================================================
-- Admin RPCs (admin = hardcoded e-mail via is_app_admin())
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_and_mark_certificate(_code text)
RETURNS TABLE(
  verification_code text, atividade text, carga_horaria integer,
  data_liberacao timestamptz, verified_at timestamptz, verification_count integer,
  participante_nome text, participante_instituicao text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
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
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
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
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;

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

REVOKE ALL ON FUNCTION public.verify_and_mark_certificate(text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_attendance(text, uuid, uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_and_mark_certificate(text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance(text, uuid, uuid)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_event_and_issue_certificates(text, uuid, integer) TO anon, authenticated;

-- ============================================================
-- updated_at trigger for profiles
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Storage buckets: avatars, certificates, certificate-templates
-- Open policies (consistent with the existing 'Pdfs' bucket).
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars','avatars',false),
       ('certificates','certificates',false),
       ('certificate-templates','certificate-templates',false)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE b TEXT;
BEGIN
  FOREACH b IN ARRAY ARRAY['avatars','certificates','certificate-templates'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "public read %1$s"   ON storage.objects;', b);
    EXECUTE format('DROP POLICY IF EXISTS "public write %1$s"  ON storage.objects;', b);
    EXECUTE format('DROP POLICY IF EXISTS "public update %1$s" ON storage.objects;', b);
    EXECUTE format('DROP POLICY IF EXISTS "public delete %1$s" ON storage.objects;', b);
    EXECUTE format($f$CREATE POLICY "public read %1$s"   ON storage.objects FOR SELECT USING (bucket_id = '%1$s');$f$, b);
    EXECUTE format($f$CREATE POLICY "public write %1$s"  ON storage.objects FOR INSERT WITH CHECK (bucket_id = '%1$s');$f$, b);
    EXECUTE format($f$CREATE POLICY "public update %1$s" ON storage.objects FOR UPDATE USING (bucket_id = '%1$s');$f$, b);
    EXECUTE format($f$CREATE POLICY "public delete %1$s" ON storage.objects FOR DELETE USING (bucket_id = '%1$s');$f$, b);
  END LOOP;
END $$;

-- ============================================================
-- Realtime
-- ============================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.certificates;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendances;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
