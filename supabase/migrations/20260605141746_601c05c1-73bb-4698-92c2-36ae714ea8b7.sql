-- The "safe" view exposes only non-credential instance columns and is meant to be
-- readable by all authenticated staff (POS/PDV). It was set to security_invoker=on,
-- which made it run with the caller's privileges and hit the admin-only RLS on the
-- base table whatsapp_numbers, returning zero rows to non-admin staff.
-- Revert to a security-definer view so staff can read the safe columns again,
-- while the credential-bearing base table stays admin-only.
ALTER VIEW public.whatsapp_numbers_safe SET (security_invoker = off);

REVOKE ALL ON public.whatsapp_numbers_safe FROM anon;
GRANT SELECT ON public.whatsapp_numbers_safe TO authenticated;
GRANT SELECT ON public.whatsapp_numbers_safe TO service_role;