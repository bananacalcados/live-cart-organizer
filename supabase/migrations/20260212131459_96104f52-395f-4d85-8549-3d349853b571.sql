CREATE OR REPLACE FUNCTION public.get_inventory_summary()
RETURNS TABLE(
  store_id uuid,
  total_items bigint,
  total_value numeric,
  total_cost numeric,
  zero_stock bigint,
  total_skus bigint
)
LANGUAGE sql
STABLE
SET search_path = 'public'
AS $$
  SELECT 
    p.store_id,
    COALESCE(SUM(CASE WHEN p.stock > 0 THEN p.stock ELSE 0 END)::bigint, 0) as total_items,
    COALESCE(SUM(CASE WHEN p.stock > 0 THEN p.stock * p.price ELSE 0 END), 0) as total_value,
    COALESCE(SUM(CASE WHEN p.stock > 0 THEN p.stock * p.cost_price ELSE 0 END), 0) as total_cost,
    COALESCE(COUNT(CASE WHEN p.stock <= 0 THEN 1 END), 0) as zero_stock,
    COUNT(*)::bigint as total_skus
  FROM pos_products p
  WHERE p.is_active = true
  GROUP BY p.store_id;
$$;