
CREATE OR REPLACE FUNCTION public.verify_certificate(_code text)
RETURNS TABLE(verification_code text, atividade text, carga_horaria integer, data_liberacao timestamp with time zone, participante_nome text, participante_instituicao text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH norm AS (
    SELECT lower(regexp_replace(coalesce(_code,''), '[^a-zA-Z0-9]', '', 'g')) AS c
  ), m AS (
    SELECT c.* FROM public.certificates c, norm
     WHERE c.data_liberacao IS NOT NULL
       AND (
         c.verification_code = norm.c
         OR (length(norm.c) >= 8 AND c.verification_code LIKE norm.c || '%')
       )
     LIMIT 1
  )
  SELECT m.verification_code, m.atividade, m.carga_horaria, m.data_liberacao,
         p.nome, p.instituicao
    FROM m LEFT JOIN public.profiles p ON p.id = m.user_id;
$function$;
