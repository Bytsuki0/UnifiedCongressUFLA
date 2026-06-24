
ALTER TABLE public.minicourses ADD COLUMN IF NOT EXISTS certificate_template_url text;
ALTER TABLE public.schedule ADD COLUMN IF NOT EXISTS certificate_template_url text;

ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS verification_code text UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS event_source text;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

-- Backfill verification_code for any existing rows that have null
UPDATE public.certificates SET verification_code = replace(gen_random_uuid()::text, '-', '') WHERE verification_code IS NULL;

-- Public verification: allow anon to read minimal cert info by verification_code via a view
CREATE OR REPLACE VIEW public.certificate_verifications
WITH (security_invoker=off) AS
  SELECT
    c.verification_code,
    c.atividade,
    c.carga_horaria,
    c.data_liberacao,
    p.nome AS participante_nome,
    p.instituicao AS participante_instituicao
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.data_liberacao IS NOT NULL;

GRANT SELECT ON public.certificate_verifications TO anon, authenticated;
