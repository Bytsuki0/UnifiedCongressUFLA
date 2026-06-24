
-- Add verification tracking to certificates
ALTER TABLE public.certificates 
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_count INTEGER NOT NULL DEFAULT 0;

-- Notifications table (in-app)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  audience TEXT NOT NULL DEFAULT 'user' CHECK (audience IN ('user','all')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own or broadcast notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (audience = 'all' OR user_id = auth.uid());

CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete notifications"
  ON public.notifications FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Read receipts (per-user dismissed/read state)
CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

GRANT SELECT, INSERT, DELETE ON public.notification_reads TO authenticated;
GRANT ALL ON public.notification_reads TO service_role;

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own reads"
  ON public.notification_reads FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Verify + mark certificate (admin action via QR scanner)
CREATE OR REPLACE FUNCTION public.verify_and_mark_certificate(_code text)
RETURNS TABLE(
  verification_code text,
  atividade text,
  carga_horaria integer,
  data_liberacao timestamptz,
  verified_at timestamptz,
  verification_count integer,
  participante_nome text,
  participante_instituicao text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.certificates c
    SET verified_at = now(),
        verified_by = auth.uid(),
        verification_count = c.verification_count + 1
   WHERE c.verification_code = _code
     AND c.data_liberacao IS NOT NULL;

  RETURN QUERY
  SELECT c.verification_code, c.atividade, c.carga_horaria, c.data_liberacao,
         c.verified_at, c.verification_count, p.nome, p.instituicao
    FROM public.certificates c
    LEFT JOIN public.profiles p ON p.id = c.user_id
   WHERE c.verification_code = _code
   LIMIT 1;
END;
$$;

-- Realtime for notifications + certificates so participant UI auto-refreshes
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.certificates;
