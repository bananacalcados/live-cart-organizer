CREATE INDEX IF NOT EXISTS idx_internal_cashback_suffix8_active ON public.internal_cashback (right(regexp_replace(COALESCE(customer_phone,''),'\D','','g'),8)) WHERE is_used = false;

DO $do$
DECLARE s text;
BEGIN
  s := pg_get_functiondef('public.bc_match_audience(crm_customers_v, jsonb, jsonb)'::regprocedure);
  IF position('has_active_cashback' in s) > 0 THEN RETURN; END IF;
  s := replace(s, '  v_in_vip boolean;', '  v_in_vip boolean;
  v_cb boolean;');
  s := replace(s, '  -- ===== Está em grupo VIP =====', '  -- ===== Cashback ativo =====
  IF COALESCE((inc->>''has_active_cashback'')::boolean, false) OR COALESCE((exc->>''has_active_cashback'')::boolean, false) THEN
    v_cb := EXISTS (
      SELECT 1 FROM public.internal_cashback ic
      WHERE right(regexp_replace(COALESCE(ic.customer_phone,''''),''\D'',''''

,''g''),8) = cv.phone_suffix8
        AND ic.is_used = false AND ic.expires_at > now()
    );
    IF COALESCE((inc->>''has_active_cashback'')::boolean, false) AND NOT v_cb THEN RETURN false; END IF;
    IF COALESCE((exc->>''has_active_cashback'')::boolean, false) AND v_cb THEN RETURN false; END IF;
  END IF;

  -- ===== Está em grupo VIP =====');
  EXECUTE s;
END
$do$;