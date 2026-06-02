-- Aplica em massa os vínculos Shopify nos nossos registros.
-- Recebe um array JSON [{variant_id, master_id, shopify_product_id, shopify_variant_id}]
-- e grava shopify_variant_id nas variações e shopify_product_id nos produtos-pai.
CREATE OR REPLACE FUNCTION public.apply_shopify_links(_links jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Atualiza as variações
  UPDATE product_variants pv
  SET shopify_variant_id = x.shopify_variant_id,
      last_sync_source = 'shopify_link',
      updated_at = now()
  FROM jsonb_to_recordset(_links)
    AS x(variant_id uuid, master_id uuid, shopify_product_id text, shopify_variant_id text)
  WHERE pv.id = x.variant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Atualiza os produtos-pai (distintos)
  UPDATE products_master pm
  SET shopify_product_id = d.shopify_product_id,
      updated_at = now()
  FROM (
    SELECT DISTINCT y.master_id, y.shopify_product_id
    FROM jsonb_to_recordset(_links)
      AS y(variant_id uuid, master_id uuid, shopify_product_id text, shopify_variant_id text)
  ) d
  WHERE pm.id = d.master_id;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_shopify_links(jsonb) TO service_role;