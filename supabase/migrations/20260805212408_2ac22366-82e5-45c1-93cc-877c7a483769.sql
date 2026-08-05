ALTER FUNCTION public.bc_match_audience(public.crm_customers_v, jsonb, jsonb) PARALLEL SAFE;

CREATE OR REPLACE FUNCTION public.count_campaign_audience(p_filtro jsonb)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f jsonb := COALESCE(p_filtro, '{}'::jsonb);
  inc jsonb;
  exc jsonb;
  v_count integer;
BEGIN
  IF f ? 'include' OR f ? 'exclude' THEN
    inc := COALESCE(f->'include', '{}'::jsonb);
    exc := COALESCE(f->'exclude', '{}'::jsonb);
  ELSE
    inc := f;
    exc := '{}'::jsonb;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.crm_customers_v cv
  WHERE cv.phone_suffix8 IS NOT NULL
    AND cv.phone IS NOT NULL
    AND COALESCE(cv.opt_out_mass_dispatch, false) = false
    AND COALESCE(cv.is_archived, false) = false
    -- pré-filtros indexáveis (mesma semântica de bc_match_audience)
    AND (COALESCE(jsonb_array_length(inc->'ddds'),0) = 0
         OR cv.ddd = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'ddds'))))
    AND (COALESCE(jsonb_array_length(inc->'cities'),0) = 0
         OR cv.city = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'cities'))))
    AND (COALESCE(jsonb_array_length(inc->'states'),0) = 0
         OR cv.state = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'states'))))
    AND (COALESCE(jsonb_array_length(inc->'rfm_segments'),0) = 0
         OR cv.rfm_segment = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'rfm_segments'))))
    AND (COALESCE(jsonb_array_length(inc->'sizes'),0) = 0
         OR COALESCE(cv.purchased_sizes,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'sizes')))
    AND (COALESCE(jsonb_array_length(inc->'categories'),0) = 0
         OR COALESCE(cv.purchased_categories,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'categories')))
    AND (COALESCE(jsonb_array_length(inc->'brands'),0) = 0
         OR COALESCE(cv.purchased_brands,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'brands')))
    AND (COALESCE(jsonb_array_length(inc->'stores'),0) = 0
         OR COALESCE(cv.purchased_stores,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'stores')))
    AND (COALESCE(jsonb_array_length(inc->'payment_methods'),0) = 0
         OR COALESCE(cv.payment_methods,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'payment_methods')))
    AND (COALESCE(jsonb_array_length(inc->'tags'),0) = 0
         OR COALESCE(cv.tags,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'tags')))
    AND public.bc_match_audience(cv, inc, exc);

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_campaign_audience(p_filtro jsonb, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE (
  cliente_id uuid,
  nome text,
  phone text,
  city text,
  state text,
  tamanhos text[],
  avg_ticket numeric,
  total_orders integer,
  last_purchase_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  f jsonb := COALESCE(p_filtro, '{}'::jsonb);
  inc jsonb;
  exc jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF f ? 'include' OR f ? 'exclude' THEN
    inc := COALESCE(f->'include', '{}'::jsonb);
    exc := COALESCE(f->'exclude', '{}'::jsonb);
  ELSE
    inc := f;
    exc := '{}'::jsonb;
  END IF;

  RETURN QUERY
  SELECT cv.id, cv.name, cv.phone, cv.city, cv.state,
         cv.purchased_sizes, cv.avg_ticket, cv.total_orders, cv.last_purchase_at
  FROM public.crm_customers_v cv
  WHERE cv.phone_suffix8 IS NOT NULL
    AND cv.phone IS NOT NULL
    AND COALESCE(cv.opt_out_mass_dispatch, false) = false
    AND COALESCE(cv.is_archived, false) = false
    AND (COALESCE(jsonb_array_length(inc->'ddds'),0) = 0
         OR cv.ddd = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'ddds'))))
    AND (COALESCE(jsonb_array_length(inc->'cities'),0) = 0
         OR cv.city = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'cities'))))
    AND (COALESCE(jsonb_array_length(inc->'states'),0) = 0
         OR cv.state = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'states'))))
    AND (COALESCE(jsonb_array_length(inc->'rfm_segments'),0) = 0
         OR cv.rfm_segment = ANY (ARRAY(SELECT jsonb_array_elements_text(inc->'rfm_segments'))))
    AND (COALESCE(jsonb_array_length(inc->'sizes'),0) = 0
         OR COALESCE(cv.purchased_sizes,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'sizes')))
    AND (COALESCE(jsonb_array_length(inc->'categories'),0) = 0
         OR COALESCE(cv.purchased_categories,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'categories')))
    AND (COALESCE(jsonb_array_length(inc->'brands'),0) = 0
         OR COALESCE(cv.purchased_brands,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'brands')))
    AND (COALESCE(jsonb_array_length(inc->'stores'),0) = 0
         OR COALESCE(cv.purchased_stores,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'stores')))
    AND (COALESCE(jsonb_array_length(inc->'payment_methods'),0) = 0
         OR COALESCE(cv.payment_methods,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'payment_methods')))
    AND (COALESCE(jsonb_array_length(inc->'tags'),0) = 0
         OR COALESCE(cv.tags,'{}') && ARRAY(SELECT jsonb_array_elements_text(inc->'tags')))
    AND public.bc_match_audience(cv, inc, exc)
  ORDER BY cv.last_purchase_at DESC NULLS LAST
  LIMIT v_limit OFFSET v_offset;
END;
$$;