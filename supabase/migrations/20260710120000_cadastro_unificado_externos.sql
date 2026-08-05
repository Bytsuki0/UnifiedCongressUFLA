-- ============================================================
-- Cadastro unificado + contas externas
-- ------------------------------------------------------------
-- As três telas de cadastro (pré-cadastro, estudante, professor)
-- viraram uma só. O perfil continua sendo DERIVADO DO DOMÍNIO do
-- e-mail no servidor (SEC-07), agora com três resultados:
--
--   @estudante.ufla.br              -> estudante  (matrícula, período, curso)
--   @ufla.br / @ufla-br / @ufla_br  -> professor  (departamento)
--   qualquer outro domínio          -> externo    (só nome/e-mail/senha)
--
-- A conta externa participa apenas da área do congresso; não recebe
-- papel institucional e não entra em estudantes/professores.
-- ============================================================

-- 1. Novo papel 'externo' -------------------------------------
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'avaliador', 'professor', 'estudante', 'participant', 'externo'));

ALTER TABLE public.allowed_email_domains DROP CONSTRAINT IF EXISTS allowed_email_domains_role_check;
ALTER TABLE public.allowed_email_domains ADD CONSTRAINT allowed_email_domains_role_check
  CHECK (role IN ('estudante', 'professor', 'participant', 'externo'));

-- Variações institucionais aceitas pelo formulário antigo.
INSERT INTO public.allowed_email_domains (domain, role) VALUES
  ('ufla-br', 'professor'),
  ('ufla_br', 'professor')
ON CONFLICT (domain) DO NOTHING;

-- 2. Cadastro: domínio desconhecido vira conta externa --------
-- (antes o cadastro era rejeitado; agora só o papel muda) +
-- validação server-side dos campos obrigatórios de cada perfil.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email     TEXT := lower(coalesce(NEW.email, ''));
  v_domain    TEXT := split_part(v_email, '@', 2);
  v_role      TEXT;
  v_meta      jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  v_nome      TEXT := nullif(trim(coalesce(v_meta->>'nome', '')), '');
  v_matricula TEXT := nullif(trim(coalesce(v_meta->>'matricula', '')), '');
  v_periodo   TEXT := nullif(trim(coalesce(v_meta->>'periodo', '')), '');
  v_curso     TEXT := nullif(trim(coalesce(v_meta->>'curso', '')), '');
  v_depto     TEXT := nullif(trim(coalesce(v_meta->>'departamento', '')), '');
BEGIN
  IF v_domain = '' THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;

  -- Domínio institucional define o papel; qualquer outro é externo.
  SELECT d.role INTO v_role FROM public.allowed_email_domains d WHERE d.domain = v_domain;
  v_role := coalesce(v_role, 'externo');

  v_nome := coalesce(v_nome, split_part(v_email, '@', 1));

  IF v_role = 'estudante' AND (v_matricula IS NULL OR v_periodo IS NULL OR v_curso IS NULL) THEN
    RAISE EXCEPTION 'Estudante deve informar matrícula, período e curso.';
  END IF;
  IF v_role = 'professor' AND v_depto IS NULL THEN
    RAISE EXCEPTION 'Professor deve informar o departamento.';
  END IF;

  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, v_nome, v_email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF v_role = 'estudante' THEN
    INSERT INTO public.estudantes (user_id, nome, email, matricula, periodo, curso)
    VALUES (NEW.id, v_nome, v_email, v_matricula, v_periodo, v_curso)
    ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id;
  ELSIF v_role = 'professor' THEN
    INSERT INTO public.professores (user_id, nome, email, departamento)
    VALUES (NEW.id, v_nome, v_email, v_depto)
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

-- 3. Usuários sem papel (cadastrados fora do fluxo) viram externos.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'externo'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id)
ON CONFLICT (user_id, role) DO NOTHING;

-- 4. A tela admin de usuários precisa enxergar os papéis ------
-- (a rota /congresso/admin/usuarios é aberta a admin E avaliador;
--  a ESCRITA continua exclusiva do admin — SEC-04.)
DROP POLICY IF EXISTS "user_roles select" ON public.user_roles;
CREATE POLICY "user_roles select" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_event_staff() OR user_id = auth.uid());
