CREATE OR REPLACE FUNCTION public.security_user_by_email(p_email text)
RETURNS TABLE(id uuid, last_sign_in_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$ SELECT u.id, u.last_sign_in_at FROM auth.users u WHERE lower(u.email) = lower(p_email) LIMIT 1 $$;
REVOKE EXECUTE ON FUNCTION public.security_user_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_user_by_email(text) TO service_role;
CREATE INDEX IF NOT EXISTS security_events_event_created_idx ON public.security_events (event, created_at DESC);