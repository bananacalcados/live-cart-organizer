-- Pure calculation only: no table reads, writes, identity or private data.
GRANT EXECUTE ON FUNCTION public.resolve_selfservice_event_shipping(jsonb,jsonb) TO PUBLIC;
COMMENT ON FUNCTION public.resolve_selfservice_event_shipping(jsonb,jsonb) IS 'Pure immutable event shipping calculation; accepts caller-provided JSON only, no stored data access.';