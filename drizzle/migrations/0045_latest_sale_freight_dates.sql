CREATE FUNCTION public.latest_sale_freight_dates(p_sale_ids uuid[]) RETURNS TABLE(sale_id uuid,quoted_at timestamptz) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT requested.id, latest.quoted_at FROM (SELECT DISTINCT id FROM unnest(p_sale_ids) AS input(id) LIMIT 200) requested CROSS JOIN LATERAL (SELECT q.quoted_at FROM public.sale_freight_quotes q WHERE q.sale_id=requested.id ORDER BY q.quoted_at DESC,q.id DESC LIMIT 1) latest;
$$;
REVOKE ALL ON FUNCTION public.latest_sale_freight_dates(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.latest_sale_freight_dates(uuid[]) TO authenticated,service_role;