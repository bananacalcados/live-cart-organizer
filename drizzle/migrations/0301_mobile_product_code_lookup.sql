CREATE INDEX IF NOT EXISTS idx_product_variants_sku_upper
  ON public.product_variants (upper(sku))
  WHERE sku IS NOT NULL AND sku <> '';

CREATE INDEX IF NOT EXISTS idx_products_master_sku_root_upper
  ON public.products_master (upper(sku_root))
  WHERE sku_root IS NOT NULL AND sku_root <> '';

CREATE INDEX IF NOT EXISTS idx_pos_products_barcode_global
  ON public.pos_products (barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

CREATE INDEX IF NOT EXISTS idx_pos_products_sku_upper_global
  ON public.pos_products (upper(sku))
  WHERE sku IS NOT NULL AND sku <> '';

CREATE OR REPLACE FUNCTION public.mobile_resolve_product_code(p_code text)
RETURNS TABLE(
  master_id uuid,
  variant_id uuid,
  code text,
  color text,
  size text,
  master_name text,
  sku_root text,
  matched_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := upper(btrim(coalesce(p_code, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_module_access(auth.uid(), 'inventory')
  ) THEN
    RETURN;
  END IF;

  IF v_code = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v.master_id, v.id, c.code, v.color, v.size, m.name, m.sku_root, 'etiqueta_interna'::text
  FROM public.product_variant_codes c
  JOIN public.product_variants v ON v.id = c.variant_id
  JOIN public.products_master m ON m.id = v.master_id
  WHERE upper(c.code) = v_code
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT v.master_id, v.id, coalesce(nullif(v.gtin, ''), v.sku), v.color, v.size, m.name, m.sku_root,
         CASE WHEN v.gtin = v_code THEN 'gtin'::text ELSE 'sku_variacao'::text END
  FROM public.product_variants v
  JOIN public.products_master m ON m.id = v.master_id
  WHERE v.gtin = v_code OR upper(v.sku) = v_code
  ORDER BY CASE WHEN v.gtin = v_code THEN 0 ELSE 1 END, v.id
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT v.master_id, v.id, pp.barcode, v.color, v.size, m.name, m.sku_root, 'barcode_pdv'::text
  FROM public.pos_products pp
  JOIN public.product_variants v ON v.gtin = pp.barcode
  JOIN public.products_master m ON m.id = v.master_id
  WHERE pp.barcode = v_code
  ORDER BY pp.is_active DESC NULLS LAST, pp.updated_at DESC NULLS LAST, pp.id
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT v.master_id, v.id, pp.sku, v.color, v.size, m.name, m.sku_root, 'sku_pdv'::text
  FROM public.pos_products pp
  JOIN public.product_variants v ON v.sku = pp.sku
  JOIN public.products_master m ON m.id = v.master_id
  WHERE upper(pp.sku) = v_code
  ORDER BY pp.is_active DESC NULLS LAST, pp.updated_at DESC NULLS LAST, pp.id
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT m.id, null::uuid, m.sku_root, null::text, null::text, m.name, m.sku_root, 'sku_pai'::text
  FROM public.products_master m
  WHERE upper(m.sku_root) = v_code
  LIMIT 1;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.mobile_resolve_product_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_resolve_product_code(text) TO authenticated, service_role;