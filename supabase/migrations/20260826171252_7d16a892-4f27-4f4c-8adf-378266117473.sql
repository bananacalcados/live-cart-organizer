REVOKE ALL ON FUNCTION public.check_chargeback_risk(text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_chargeback_risk(text, text, text, text, text, text, uuid) TO authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='check_chargeback_risk'
               AND pg_get_function_identity_arguments(p.oid)='text, text, text, text, text, text') THEN
    EXECUTE 'DROP FUNCTION public.check_chargeback_risk(text, text, text, text, text, text)';
  END IF;
END$$;