CREATE OR REPLACE FUNCTION public.pos_customer_suffixes_by_filter(p_store_id uuid DEFAULT NULL, p_seller_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT s.customer_id, s.customer_unified_id, s.customer_phone, s.customer_cpf
    FROM pos_sales s
    WHERE (p_store_id IS NULL OR s.store_id = p_store_id)
      AND (p_seller_id IS NULL OR s.seller_id = p_seller_id)
  ), sfx AS (
    SELECT right(regexp_replace(coalesce(v.customer_phone,''),'\D','','g'),8) AS s FROM v
    UNION
    SELECT right(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'),8) FROM v JOIN pos_customers c ON c.id = v.customer_id
    UNION
    SELECT cu.phone_suffix8 FROM v JOIN customers_unified cu ON cu.id = v.customer_unified_id
    UNION
    SELECT cu.phone_suffix8 FROM v JOIN customers_unified cu ON cu.cpf = nullif(regexp_replace(coalesce(v.customer_cpf,''),'\D','','g'),'')
  )
  SELECT coalesce(array_agg(DISTINCT s), '{}')
  FROM sfx WHERE s ~ '^[0-9]{8}$';
$$;

REVOKE ALL ON FUNCTION public.pos_customer_suffixes_by_filter(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_customer_suffixes_by_filter(uuid, uuid) TO authenticated, service_role;