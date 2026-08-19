DO $mig$
DECLARE
  v_def text;
BEGIN
  -- 1) event_buyer_origin_matrix(uuid)
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'event_buyer_origin_matrix';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'event_buyer_origin_matrix not found';
  END IF;

  IF position('LEAST(z.created_at' in v_def) = 0 THEN
    IF position('WHERE public.event_phone_key(z.phone) IN (SELECT pkey FROM everyone)' in v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected zoppy block in event_buyer_origin_matrix';
    END IF;
    v_def := replace(
      v_def,
      'WHERE public.event_phone_key(z.phone) IN (SELECT pkey FROM everyone)',
      'WHERE public.event_phone_key(z.phone) IN (SELECT pkey FROM everyone)'
      || E'\n      AND LEAST(z.created_at, COALESCE(z.first_purchase_at, z.created_at)) < v_event_start'
    );
    EXECUTE v_def;
  END IF;

  -- 2) events_buyer_origin_matrix_range(timestamptz, timestamptz, text)
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'events_buyer_origin_matrix_range';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'events_buyer_origin_matrix_range not found';
  END IF;

  IF position('LEAST(z.created_at' in v_def) = 0 THEN
    IF position('ON public.event_phone_key(z.phone) = e.pkey' in v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected zoppy block in events_buyer_origin_matrix_range';
    END IF;
    v_def := replace(
      v_def,
      'ON public.event_phone_key(z.phone) = e.pkey',
      'ON public.event_phone_key(z.phone) = e.pkey'
      || E'\n     AND LEAST(z.created_at, COALESCE(z.first_purchase_at, z.created_at)) < e.ev_start'
    );
    EXECUTE v_def;
  END IF;
END
$mig$;