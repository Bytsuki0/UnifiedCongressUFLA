-- ============================================================
-- Programação do evento
-- ============================================================
-- A organização sobe UM arquivo (PNG, JPEG ou PDF) em
-- /co-chairs/cronograma, e a landing, /cronograma e /estudante/cronograma
-- o exibem como imagem.
--
-- Sem tabela, e é de propósito: o arquivo em vigor é o objeto MAIS
-- RECENTE do bucket (o nome é `<epoch ms>.<ext>`). Trocar = subir o novo
-- e apagar os antigos; tirar do ar = apagar. Uma coluna apontando para o
-- caminho seria uma segunda fonte da mesma verdade, e as duas
-- discordariam no dia em que um upload passasse e o UPDATE falhasse.
--
-- PRIVADO como todos (SEC-05), mas a leitura é aberta a `anon`: a landing
-- é anterior ao login. A imagem sai por URL assinada, que vence — tirar
-- do ar não deixa um endereço eterno circulando.
--
-- `allowed_mime_types` é a trava contra HTML/SVG fazendo-se passar por
-- imagem; o `accept` do <input type="file"> é só sugestão.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('programacao', 'programacao', false, 10485760,
        ARRAY['image/png', 'image/jpeg', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "programacao read"         ON storage.objects;
DROP POLICY IF EXISTS "programacao staff write"  ON storage.objects;
DROP POLICY IF EXISTS "programacao staff delete" ON storage.objects;

-- Leitura: qualquer um, com ou sem sessão (assinar URL exige SELECT).
CREATE POLICY "programacao read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'programacao');

-- Escrita: a organização, como `cronograma_eventos` — a tela é a mesma.
-- Sem policy de UPDATE: o upload nunca sobrescreve (nome novo a cada envio).
CREATE POLICY "programacao staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'programacao' AND public.is_event_staff() AND public.email_confirmado());
CREATE POLICY "programacao staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'programacao' AND public.is_event_staff() AND public.email_confirmado());

-- Canário: bucket privado, e nenhuma escrita sem o gate da organização.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'programacao' AND public = false) THEN
    RAISE EXCEPTION 'o bucket programacao precisa existir e ser PRIVADO';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'programacao%'
      AND cmd <> 'SELECT'
      AND coalesce(with_check, qual) NOT LIKE '%is_event_staff%'
  ) THEN
    RAISE EXCEPTION 'policy de escrita do bucket programacao sem is_event_staff()';
  END IF;
END $$;
