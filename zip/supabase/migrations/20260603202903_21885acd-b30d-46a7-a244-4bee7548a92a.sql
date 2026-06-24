
DROP VIEW IF EXISTS public.certificate_verifications;
CREATE VIEW public.certificate_verifications
WITH (security_invoker=on) AS
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

-- Allow anon to read minimal cert + profile fields ONLY through the view path.
-- Add a permissive SELECT policy filtered to verification_code via a SECURITY DEFINER fn.
CREATE OR REPLACE FUNCTION public.verify_certificate(_code text)
RETURNS TABLE(
  verification_code text,
  atividade text,
  carga_horaria int,
  data_liberacao timestamptz,
  participante_nome text,
  participante_instituicao text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.verification_code, c.atividade, c.carga_horaria, c.data_liberacao,
         p.nome, p.instituicao
  FROM public.certificates c
  LEFT JOIN public.profiles p ON p.id = c.user_id
  WHERE c.verification_code = _code AND c.data_liberacao IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;
