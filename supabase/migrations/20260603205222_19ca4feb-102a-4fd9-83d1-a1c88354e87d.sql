-- live_phone_verifications: remove anon read/update; only service_role
-- (live-send-verification, live-verify-code) touches this table now.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='live_phone_verifications'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.live_phone_verifications', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.live_phone_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read live_phone_verifications"
ON public.live_phone_verifications FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.live_phone_verifications FROM anon;
GRANT SELECT ON public.live_phone_verifications TO authenticated;
GRANT ALL ON public.live_phone_verifications TO service_role;
