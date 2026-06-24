
DROP POLICY IF EXISTS "Admins write templates" ON storage.objects;
CREATE POLICY "Admins write templates" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificate-templates' AND public.is_admin());

DROP POLICY IF EXISTS "Admins update templates" ON storage.objects;
CREATE POLICY "Admins update templates" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_admin());

DROP POLICY IF EXISTS "Admins delete templates" ON storage.objects;
CREATE POLICY "Admins delete templates" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'certificate-templates' AND public.is_admin());

DROP POLICY IF EXISTS "Read templates" ON storage.objects;
CREATE POLICY "Read templates" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'certificate-templates');
