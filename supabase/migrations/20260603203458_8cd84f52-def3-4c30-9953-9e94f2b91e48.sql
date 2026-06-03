-- review_tokens & referrals: remove anonymous direct access; all customer
-- interaction now flows through service_role edge functions.
DROP POLICY IF EXISTS "Public can read referrals" ON public.referrals;
DROP POLICY IF EXISTS "Public can insert referrals" ON public.referrals;
DROP POLICY IF EXISTS "Public can update referrals" ON public.referrals;
DROP POLICY IF EXISTS "Public can read review_tokens by token" ON public.review_tokens;
DROP POLICY IF EXISTS "Public can update own review_tokens" ON public.review_tokens;

CREATE POLICY "Authenticated full access referrals"
ON public.referrals FOR ALL TO authenticated USING (true) WITH CHECK (true);

REVOKE ALL ON public.referrals FROM anon;
REVOKE ALL ON public.review_tokens FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_tokens TO authenticated;
GRANT ALL ON public.referrals TO service_role;
GRANT ALL ON public.review_tokens TO service_role;
