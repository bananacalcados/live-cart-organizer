CREATE OR REPLACE FUNCTION public.recompute_needs_review()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  WITH calc AS (
    SELECT
      parent_sku,
      NULLIF(
        ARRAY_TO_STRING(ARRAY_REMOVE(ARRAY[
          CASE WHEN ncm IS NULL OR LENGTH(TRIM(ncm)) < 8 THEN 'NCM ausente/inválido' END,
          CASE WHEN cfop IS NULL OR LENGTH(TRIM(cfop)) < 4 THEN 'CFOP ausente' END,
          CASE WHEN cost_price IS NULL OR cost_price <= 0 THEN 'Custo ausente' END,
          CASE WHEN sale_price IS NULL OR sale_price <= 0 THEN 'Preço de venda ausente' END
        ], NULL), '; '),
      '') AS reason
    FROM product_master_data
    WHERE is_active = true
  )
  UPDATE product_master_data pmd
  SET needs_review = (calc.reason IS NOT NULL),
      review_reason = calc.reason,
      updated_at = now()
  FROM calc
  WHERE pmd.parent_sku = calc.parent_sku
    AND ( COALESCE(pmd.needs_review, false) <> (calc.reason IS NOT NULL)
          OR COALESCE(pmd.review_reason,'') <> COALESCE(calc.reason,'') );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_needs_review() TO authenticated, service_role;