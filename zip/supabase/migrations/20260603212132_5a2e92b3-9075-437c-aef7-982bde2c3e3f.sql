CREATE OR REPLACE FUNCTION public.close_event_and_issue_certificates(_event_type text, _event_id uuid, _carga_horaria integer)
 RETURNS TABLE(user_id uuid, certificate_id uuid, created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title TEXT;
  r RECORD;
  v_existing UUID;
  v_new UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

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
        data_liberacao, verification_code
      )
      VALUES(
        r.user_id, _event_type, _event_id, v_title, _carga_horaria,
        now(), substr(replace(gen_random_uuid()::text,'-',''),1,16)
      )
      RETURNING id INTO v_new;
      user_id := r.user_id; certificate_id := v_new; created := true; RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;