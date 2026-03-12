
CREATE OR REPLACE FUNCTION public.get_customer_store_seller_map()
RETURNS TABLE(customer_phone text, store_id uuid, store_name text, seller_id uuid, seller_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (right(regexp_replace(s.customer_phone, '[^0-9]', '', 'g'), 8))
    right(regexp_replace(s.customer_phone, '[^0-9]', '', 'g'), 8) as customer_phone,
    s.store_id,
    st.name as store_name,
    s.seller_id,
    sel.name as seller_name
  FROM pos_sales s
  JOIN pos_stores st ON st.id = s.store_id
  LEFT JOIN pos_sellers sel ON sel.id = s.seller_id
  WHERE s.customer_phone IS NOT NULL
    AND s.customer_phone != ''
  ORDER BY right(regexp_replace(s.customer_phone, '[^0-9]', '', 'g'), 8), s.created_at DESC;
$$;
