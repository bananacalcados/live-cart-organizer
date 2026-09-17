CREATE OR REPLACE FUNCTION public.live_buyer_phone_suffixes()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT sfx), ARRAY[]::text[])
  FROM (
    SELECT right(regexp_replace(COALESCE(cu.phone_e164, s.customer_phone), '\D', '', 'g'), 8) AS sfx
    FROM public.pos_sales s
    LEFT JOIN public.customers_unified cu ON cu.id = s.customer_unified_id
    WHERE s.sale_type = 'live'
      AND COALESCE(s.status, '') <> 'cancelled'
      AND length(regexp_replace(COALESCE(cu.phone_e164, s.customer_phone, ''), '\D', '', 'g')) >= 8
  ) t
  WHERE sfx IS NOT NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.live_buyer_phone_suffixes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_buyer_phone_suffixes() TO authenticated, service_role;