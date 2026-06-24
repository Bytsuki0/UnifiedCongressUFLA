
-- ============== ENUMS ==============
CREATE TYPE public.app_role AS ENUM ('admin', 'participant');
CREATE TYPE public.registration_status AS ENUM ('pending', 'approved', 'cancelled');

-- ============== PROFILES ==============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cpf TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  telefone TEXT,
  instituicao TEXT,
  curso TEXT,
  foto_perfil TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============== USER ROLES ==============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(auth.uid(), 'admin') $$;

-- Profiles RLS
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_admin());
CREATE POLICY "Admins insert profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id OR public.is_admin());
CREATE POLICY "Admins delete profile" ON public.profiles FOR DELETE TO authenticated
  USING (public.is_admin());

-- user_roles RLS
CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============== HANDLE NEW USER ==============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, cpf, email, telefone, instituicao, curso)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', ''),
    COALESCE(NEW.raw_user_meta_data->>'cpf', NEW.id::text),
    NEW.email,
    NEW.raw_user_meta_data->>'telefone',
    NEW.raw_user_meta_data->>'instituicao',
    NEW.raw_user_meta_data->>'curso'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'participant');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============== CONGRESS REGISTRATIONS ==============
CREATE TABLE public.congress_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.registration_status NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.congress_registrations TO authenticated;
GRANT ALL ON public.congress_registrations TO service_role;
ALTER TABLE public.congress_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own congress" ON public.congress_registrations FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- ============== MINICOURSES ==============
CREATE TABLE public.minicourses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  descricao TEXT,
  ministrante TEXT NOT NULL,
  data DATE NOT NULL,
  horario_inicio TIME NOT NULL,
  horario_fim TIME NOT NULL,
  local TEXT NOT NULL,
  vagas INTEGER NOT NULL CHECK (vagas > 0),
  carga_horaria INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.minicourses TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.minicourses TO authenticated;
GRANT ALL ON public.minicourses TO service_role;
ALTER TABLE public.minicourses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone view minicourses" ON public.minicourses FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admins manage minicourses" ON public.minicourses FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins update minicourses" ON public.minicourses FOR UPDATE TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins delete minicourses" ON public.minicourses FOR DELETE TO authenticated
  USING (public.is_admin());

-- ============== MINICOURSE REGISTRATIONS ==============
CREATE TABLE public.minicourse_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minicourse_id UUID NOT NULL REFERENCES public.minicourses(id) ON DELETE CASCADE,
  status public.registration_status NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, minicourse_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.minicourse_registrations TO authenticated;
GRANT ALL ON public.minicourse_registrations TO service_role;
ALTER TABLE public.minicourse_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own minicourse regs" ON public.minicourse_registrations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users insert own minicourse regs" ON public.minicourse_registrations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own minicourse regs" ON public.minicourse_registrations FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admins update minicourse regs" ON public.minicourse_registrations FOR UPDATE TO authenticated
  USING (public.is_admin());

-- Trigger: vagas e conflito de horário
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
CREATE TRIGGER trg_validate_minicourse_reg
BEFORE INSERT ON public.minicourse_registrations
FOR EACH ROW EXECUTE FUNCTION public.validate_minicourse_registration();

-- ============== SCHEDULE ==============
CREATE TABLE public.schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  descricao TEXT,
  categoria TEXT NOT NULL,
  data DATE NOT NULL,
  horario_inicio TIME NOT NULL,
  horario_fim TIME NOT NULL,
  local TEXT NOT NULL,
  palestrante TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.schedule TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.schedule TO authenticated;
GRANT ALL ON public.schedule TO service_role;
ALTER TABLE public.schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone view schedule" ON public.schedule FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admins insert schedule" ON public.schedule FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins update schedule" ON public.schedule FOR UPDATE TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins delete schedule" ON public.schedule FOR DELETE TO authenticated
  USING (public.is_admin());

-- ============== CERTIFICATES ==============
CREATE TABLE public.certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  atividade TEXT NOT NULL,
  carga_horaria INTEGER NOT NULL,
  arquivo_url TEXT,
  data_liberacao TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificates TO authenticated;
GRANT ALL ON public.certificates TO service_role;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own certs" ON public.certificates FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admins manage certs" ON public.certificates FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins update certs" ON public.certificates FOR UPDATE TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins delete certs" ON public.certificates FOR DELETE TO authenticated
  USING (public.is_admin());

-- ============== UPDATED_AT TRIGGER ==============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
