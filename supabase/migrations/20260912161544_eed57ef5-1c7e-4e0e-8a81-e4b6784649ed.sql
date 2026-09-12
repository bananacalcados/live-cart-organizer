DROP FUNCTION IF EXISTS public.live_resolve_contact_identities(text[]);
REVOKE ALL ON FUNCTION public.live_resolve_contact_identities(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_resolve_contact_identities(text[], text[]) TO authenticated, service_role;