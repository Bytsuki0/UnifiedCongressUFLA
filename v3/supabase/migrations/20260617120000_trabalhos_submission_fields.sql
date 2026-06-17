-- ============================================================
-- Submissão de trabalhos científicos pelo Portal do Estudante
-- ------------------------------------------------------------
-- Novos campos em public.trabalhos (status, orientador, coautores,
-- link do PDF) + bucket de Storage para os arquivos PDF.
-- ============================================================

-- 1. Novos campos na tabela trabalhos -------------------------

-- Status da submissão (usado pelo Portal do Estudante e pelo Admin).
-- Valores: pendente | em_avaliacao | aprovado | reprovado.
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente';

-- E-mail do orientador responsável pelo trabalho.
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS orientador_email TEXT;

-- Coautores: array JSON de objetos { "nome": ..., "email": ... }.
-- Permite múltiplos coautores por trabalho.
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS coautores JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Link de acesso ao PDF armazenado no bucket de Storage (S3).
-- A tabela guarda apenas o link; o arquivo vive no Storage.
ALTER TABLE public.trabalhos
  ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- 2. Bucket de Storage para os PDFs ---------------------------
-- O mesmo bucket é exposto pelo endpoint S3-compatível do projeto:
--   https://awkkkxelfhlpxktzzhzk.storage.supabase.co/storage/v1/s3
-- public = true  -> o link salvo em trabalhos.pdf_url é acessível.
-- Limite de 10 MB e apenas application/pdf.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('Pdfs', 'Pdfs', true, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Políticas RLS do bucket ----------------------------------
-- Acesso público (consistente com o restante do app, que ainda
-- opera com políticas abertas usando a chave anon).
DROP POLICY IF EXISTS "pdfs public read"   ON storage.objects;
DROP POLICY IF EXISTS "pdfs public insert" ON storage.objects;
DROP POLICY IF EXISTS "pdfs public update" ON storage.objects;
DROP POLICY IF EXISTS "pdfs public delete" ON storage.objects;

CREATE POLICY "pdfs public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Pdfs');

CREATE POLICY "pdfs public insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'Pdfs');

CREATE POLICY "pdfs public update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'Pdfs');

CREATE POLICY "pdfs public delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'Pdfs');
