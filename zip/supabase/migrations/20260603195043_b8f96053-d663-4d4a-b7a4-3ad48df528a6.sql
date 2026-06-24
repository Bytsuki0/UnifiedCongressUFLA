
ALTER TABLE public.congress_registrations
  ADD CONSTRAINT congress_registrations_profile_fk
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.minicourse_registrations
  ADD CONSTRAINT minicourse_registrations_profile_fk
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.certificates
  ADD CONSTRAINT certificates_profile_fk
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
