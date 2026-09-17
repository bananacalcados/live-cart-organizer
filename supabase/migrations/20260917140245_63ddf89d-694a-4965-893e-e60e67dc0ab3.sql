DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'bc_match_audience' LIMIT 1;
  IF d IS NULL OR d LIKE '%bought_live%' THEN RETURN; END IF;

  d := replace(d, 'DECLARE', 'DECLARE
  v_bought_live boolean;
  v_need_live boolean := (inc ? ''bought_live'' AND (inc->>''bought_live'')::boolean IS TRUE)
                      OR (exc ? ''bought_live'' AND (exc->>''bought_live'')::boolean IS TRUE);');

  d := replace(d, '
  RETURN true;', '
  -- Comprou em Live Shopping (modulo Eventos > Live)
  IF v_need_live THEN
    v_bought_live := EXISTS (
      SELECT 1 FROM public.pos_sales ps
      WHERE ps.customer_unified_id = cv.id
        AND ps.sale_type = ''live''
        AND COALESCE(ps.status_cancelamento::text, ''ativo'') <> ''cancelado''
        AND ps.status IN (''paid'',''completed'',''finalized'',''invoiced'',''pending_pickup'',''pending_sync'')
    );
    IF (inc ? ''bought_live'') AND (inc->>''bought_live'')::boolean IS TRUE AND NOT v_bought_live THEN RETURN false; END IF;
    IF (exc ? ''bought_live'') AND (exc->>''bought_live'')::boolean IS TRUE AND v_bought_live THEN RETURN false; END IF;
  END IF;

  RETURN true;');

  EXECUTE d;
END
$mig$;

CREATE INDEX IF NOT EXISTS idx_pos_sales_live_unified
  ON public.pos_sales (customer_unified_id) WHERE sale_type = 'live';