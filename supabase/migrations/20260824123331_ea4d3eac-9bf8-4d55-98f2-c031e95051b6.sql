CREATE OR REPLACE FUNCTION public.is_automation_opted_out(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.automation_opt_outs
    WHERE phone_key = public.automation_phone_key(p_phone)
      AND public.automation_phone_key(p_phone) <> ''
  );
$$;

REVOKE ALL ON FUNCTION public.is_automation_opted_out(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_automation_opted_out(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_automation_opted_out(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.automation_phone_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_phone_key(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.automation_phone_key(text) TO authenticated, service_role;