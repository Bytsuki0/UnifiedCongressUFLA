
CREATE TABLE IF NOT EXISTS public.attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('minicourse','schedule')),
  event_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (event_type, event_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendances TO authenticated;
GRANT ALL ON public.attendances TO service_role;

ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage attendance" ON public.attendances
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "Users see own attendance" ON public.attendances
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS attendances_event_idx ON public.attendances(event_type, event_id);

-- Mark attendance (admin scans QR with user_id payload)
CREATE OR REPLACE FUNCTION public.mark_attendance(_event_type text, _event_id uuid, _user_id uuid)
RETURNS TABLE(
  participante_nome text,
  participante_email text,
  evento_titulo text,
  checked_in_at timestamptz,
  already boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_already BOOLEAN := false;
  v_evt_title TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  IF _event_type NOT IN ('minicourse','schedule') THEN
    RAISE EXCEPTION 'Tipo de evento inválido';
  END IF;

  SELECT a.checked_in_at INTO v_existing
    FROM public.attendances a
   WHERE a.event_type=_event_type AND a.event_id=_event_id AND a.user_id=_user_id;

  IF v_existing IS NOT NULL THEN
    v_already := true;
  ELSE
    INSERT INTO public.attendances(event_type,event_id,user_id,checked_in_by,checked_in_at)
    VALUES(_event_type,_event_id,_user_id,auth.uid(),v_now);
    v_existing := v_now;
  END IF;

  IF _event_type='minicourse' THEN
    SELECT titulo INTO v_evt_title FROM public.minicourses WHERE id=_event_id;
  ELSE
    SELECT titulo INTO v_evt_title FROM public.schedule WHERE id=_event_id;
  END IF;

  RETURN QUERY
  SELECT p.nome, p.email, v_evt_title, v_existing, v_already
    FROM public.profiles p WHERE p.id=_user_id;
END;
$$;

-- Close event: create certificate rows for everyone with attendance
CREATE OR REPLACE FUNCTION public.close_event_and_issue_certificates(
  _event_type text, _event_id uuid, _carga_horaria integer
)
RETURNS TABLE(user_id uuid, certificate_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_template TEXT;
  r RECORD;
  v_existing UUID;
  v_new UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  IF _event_type='minicourse' THEN
    SELECT titulo, certificate_template_url INTO v_title, v_template FROM public.minicourses WHERE id=_event_id;
  ELSIF _event_type='schedule' THEN
    SELECT titulo, certificate_template_url INTO v_title, v_template FROM public.schedule WHERE id=_event_id;
  ELSE
    RAISE EXCEPTION 'Tipo de evento inválido';
  END IF;

  IF v_title IS NULL THEN RAISE EXCEPTION 'Evento não encontrado'; END IF;

  FOR r IN
    SELECT a.user_id FROM public.attendances a
     WHERE a.event_type=_event_type AND a.event_id=_event_id
  LOOP
    SELECT c.id INTO v_existing FROM public.certificates c
      WHERE c.user_id=r.user_id AND c.event_type=_event_type AND c.event_id=_event_id
      LIMIT 1;

    IF v_existing IS NOT NULL THEN
      user_id := r.user_id; certificate_id := v_existing; created := false; RETURN NEXT;
    ELSE
      INSERT INTO public.certificates(
        user_id, event_type, event_id, atividade, carga_horaria,
        data_liberacao, verification_code
      )
      VALUES(
        r.user_id, _event_type, _event_id, v_title, _carga_horaria,
        now(), encode(gen_random_bytes(8),'hex')
      )
      RETURNING id INTO v_new;
      user_id := r.user_id; certificate_id := v_new; created := true; RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.attendances;
