-- Run in a writable transaction: this routine uses transaction-local temp tables.
BEGIN;
DO $$
DECLARE result jsonb;
BEGIN
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.get_reactivation_candidates(integer)'::regprocedure) <> 'v' THEN
    RAISE EXCEPTION 'Reactivation routine must permit temporary tables';
  END IF;
  result := public.get_reactivation_candidates(1);
  IF jsonb_typeof(result->'customers') <> 'array' OR jsonb_array_length(result->'customers') > 1 THEN
    RAISE EXCEPTION 'Expected at most one candidate with p_limit=1';
  END IF;
END $$;
ROLLBACK;