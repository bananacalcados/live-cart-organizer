-- 1) Find-or-create unified customer from sale data (CPF -> phone suffix -> email)
CREATE OR REPLACE FUNCTION public.find_or_create_customer_unified(
  p_name text,
  p_phone text,
  p_cpf text,
  p_email text,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_cep text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_address_number text DEFAULT NULL,
  p_complement text DEFAULT NULL,
  p_neighborhood text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'), '');
  v_pd  text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_email text := nullif(lower(trim(coalesce(p_email,''))), '');
  v_e164 text;
  v_suf8 text;
  v_id uuid;
BEGIN
  -- Normalize BR phone to E.164 (inject 9th digit when missing)
  IF v_pd <> '' THEN
    IF left(v_pd, 2) <> '55' THEN v_pd := '55' || v_pd; END IF;
    IF length(v_pd) = 12 THEN
      v_pd := '55' || substr(v_pd, 3, 2) || '9' || substr(v_pd, 5);
    END IF;
    IF length(v_pd) = 13 THEN
      v_e164 := v_pd;
      v_suf8 := right(v_pd, 8);
    END IF;
  END IF;

  -- Match by CPF (strongest)
  IF v_cpf IS NOT NULL AND length(v_cpf) = 11 THEN
    SELECT id INTO v_id FROM public.customers_unified WHERE cpf = v_cpf LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  -- Match by phone suffix (8 digits)
  IF v_suf8 IS NOT NULL THEN
    SELECT id INTO v_id FROM public.customers_unified WHERE phone_suffix8 = v_suf8 LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  -- Match by email
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_id FROM public.customers_unified WHERE lower(email) = v_email LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  -- Need at least one strong identifier to create a new record
  IF (v_cpf IS NULL OR length(v_cpf) <> 11) AND v_suf8 IS NULL AND v_email IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.customers_unified (
    name, cpf, email, phone_e164, ddd,
    city, state, cep, address, address_number, complement, neighborhood,
    source_origins, region_type
  ) VALUES (
    nullif(trim(coalesce(p_name,'')), ''),
    CASE WHEN v_cpf IS NOT NULL AND length(v_cpf) = 11 THEN v_cpf ELSE NULL END,
    v_email,
    v_e164,
    CASE WHEN v_e164 IS NOT NULL THEN substr(v_e164, 3, 2) ELSE NULL END,
    nullif(trim(coalesce(p_city,'')), ''),
    nullif(trim(coalesce(p_state,'')), ''),
    nullif(regexp_replace(coalesce(p_cep,''), '\D', '', 'g'), ''),
    nullif(trim(coalesce(p_address,'')), ''),
    nullif(trim(coalesce(p_address_number,'')), ''),
    nullif(trim(coalesce(p_complement,'')), ''),
    nullif(trim(coalesce(p_neighborhood,'')), ''),
    '["pos-sale"]'::jsonb,
    'local'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- 2) Upgrade the BEFORE trigger: resolve by CPF too, and CREATE when missing
CREATE OR REPLACE FUNCTION public.trg_pos_sales_sync_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.customer_unified_id IS NOT NULL THEN
      PERFORM public.recalc_customer_metrics(OLD.customer_unified_id);
    END IF;
    RETURN OLD;
  END IF;

  -- Resolve/create unified link when missing and we have any identifier
  IF NEW.customer_unified_id IS NULL
     AND (NEW.customer_phone IS NOT NULL OR NEW.customer_cpf IS NOT NULL OR NEW.customer_email IS NOT NULL) THEN
    v_uid := public.find_or_create_customer_unified(
      NEW.customer_name, NEW.customer_phone, NEW.customer_cpf, NEW.customer_email,
      NEW.customer_city, NEW.customer_state, NEW.customer_cep, NULL, NULL, NULL, NULL
    );
    IF v_uid IS NOT NULL THEN
      NEW.customer_unified_id := v_uid;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) RFM scoring directly on customers_unified (same bands as zoppy version)
CREATE OR REPLACE FUNCTION public.calculate_rfm_scores_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_updated int := 0;
  v_segments jsonb;
BEGIN
  WITH scored AS (
    SELECT
      id,
      CASE
        WHEN last_purchase_at IS NULL THEN 0
        WHEN v_now - last_purchase_at <= interval '60 days' THEN 5
        WHEN v_now - last_purchase_at <= interval '120 days' THEN 4
        WHEN v_now - last_purchase_at <= interval '180 days' THEN 3
        WHEN v_now - last_purchase_at <= interval '365 days' THEN 2
        ELSE 1
      END AS r,
      CASE
        WHEN COALESCE(total_orders, 0) = 0 THEN 0
        WHEN total_orders = 1 THEN 1
        WHEN total_orders = 2 THEN 2
        WHEN total_orders = 3 THEN 3
        WHEN total_orders BETWEEN 4 AND 5 THEN 4
        ELSE 5
      END AS f,
      CASE
        WHEN COALESCE(total_spent, 0) = 0 THEN 0
        WHEN total_spent < 200 THEN 1
        WHEN total_spent < 400 THEN 2
        WHEN total_spent < 800 THEN 3
        WHEN total_spent < 1500 THEN 4
        ELSE 5
      END AS m,
      COALESCE(total_orders, 0) AS t_orders
    FROM public.customers_unified
  ),
  segmented AS (
    SELECT
      id, r, f, m,
      (r * 100 + f * 10 + m) AS composite,
      CASE
        WHEN r >= 4 AND f >= 4 AND m >= 4 THEN 'champions'
        WHEN r <= 2 AND f >= 4 AND m >= 4 THEN 'cant_lose'
        WHEN f >= 4 AND m >= 3 THEN 'loyal_customers'
        WHEN r = 3 AND f >= 3 AND m >= 3 THEN 'at_risk'
        WHEN r >= 4 AND f = 2 AND m >= 2 THEN 'promising'
        WHEN r >= 4 AND f = 1 THEN 'new_customers'
        WHEN r = 2 AND f <= 3 AND m <= 3 THEN 'hibernating'
        WHEN r = 1 THEN 'lost'
        WHEN t_orders = 0 THEN 'leads'
        ELSE 'others'
      END AS segment
    FROM scored
  )
  UPDATE public.customers_unified cu SET
    rfm_r = s.r,
    rfm_f = s.f,
    rfm_m = s.m,
    rfm_total = s.composite,
    rfm_segment = s.segment,
    updated_at = now()
  FROM segmented s
  WHERE cu.id = s.id
    AND (cu.rfm_r IS DISTINCT FROM s.r
      OR cu.rfm_f IS DISTINCT FROM s.f
      OR cu.rfm_m IS DISTINCT FROM s.m
      OR cu.rfm_total IS DISTINCT FROM s.composite
      OR cu.rfm_segment IS DISTINCT FROM s.segment);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT jsonb_object_agg(segment, cnt) INTO v_segments
  FROM (
    SELECT rfm_segment AS segment, count(*) AS cnt
    FROM public.customers_unified
    WHERE rfm_segment IS NOT NULL
    GROUP BY rfm_segment
    ORDER BY cnt DESC
  ) sub;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'segments', COALESCE(v_segments, '{}'::jsonb),
    'calculated_at', v_now
  );
END;
$function$;