CREATE OR REPLACE FUNCTION public.list_campaign_audience(
  p_filtro jsonb,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
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
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    AND public.bc_match_audience(cv, inc, exc)
  ORDER BY cv.last_purchase_at DESC NULLS LAST
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_campaign_audience(jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_campaign_audience(jsonb, integer, integer) TO service_role;