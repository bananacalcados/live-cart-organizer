-- Fix 1: Update RPC to use pos_customers.whatsapp via customer_id JOIN
CREATE OR REPLACE FUNCTION public.get_customer_store_seller_map()
 RETURNS TABLE(customer_phone text, store_id uuid, store_name text, seller_id uuid, seller_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (right(regexp_replace(pc.whatsapp, '[^0-9]', '', 'g'), 8))
    right(regexp_replace(pc.whatsapp, '[^0-9]', '', 'g'), 8) as customer_phone,
    s.store_id,
    st.name as store_name,
    s.seller_id,
    sel.name as seller_name
  FROM pos_sales s
  JOIN pos_customers pc ON pc.id = s.customer_id
  JOIN pos_stores st ON st.id = s.store_id
  LEFT JOIN pos_sellers sel ON sel.id = s.seller_id
  WHERE s.customer_id IS NOT NULL
    AND pc.whatsapp IS NOT NULL
    AND pc.whatsapp != ''
  ORDER BY right(regexp_replace(pc.whatsapp, '[^0-9]', '', 'g'), 8), s.created_at DESC;
$function$;

-- Fix 2: Add previous_whatsapp_numbers column to pos_customers
ALTER TABLE pos_customers ADD COLUMN IF NOT EXISTS previous_whatsapp_numbers text[] DEFAULT '{}';