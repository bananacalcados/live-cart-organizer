REVOKE EXECUTE ON FUNCTION public.next_event_wa_initial_variant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_event_wa_initial_variant(uuid) TO service_role;