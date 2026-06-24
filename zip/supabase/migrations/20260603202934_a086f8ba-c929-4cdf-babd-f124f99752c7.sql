
-- certificate-templates (public bucket) write policies for admins
DROP POLICY IF EXISTS "Admins manage templates" ON storage.objects;
CREATE POLICY "Admins manage templates" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_admin())
  WITH CHECK (bucket_id = 'certificate-templates' AND public.is_admin());

-- certificates (private) — admins can write; users can read own (their cert path begins with their user_id)
DROP POLICY IF EXISTS "Admins write certificates" ON storage.objects;
CREATE POLICY "Admins write certificates" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificates' AND public.is_admin());

DROP POLICY IF EXISTS "Admins update certificates" ON storage.objects;
CREATE POLICY "Admins update certificates" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'certificates' AND public.is_admin());

DROP POLICY IF EXISTS "Admins delete certificates" ON storage.objects;
CREATE POLICY "Admins delete certificates" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'certificates' AND public.is_admin());

DROP POLICY IF EXISTS "Read own certificate files" ON storage.objects;
CREATE POLICY "Read own certificate files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'certificates' AND (
      public.is_admin() OR (name LIKE auth.uid()::text || '/%')
    )
  );
