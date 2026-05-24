-- Backfill pos_products.color and pos_products.size from SKU pattern {parent_sku}-{COLOR}-{SIZE}
-- Only updates rows where color/size are NULL and SKU follows the pattern.

UPDATE public.pos_products p
SET
  color = CASE
    WHEN p.color IS NULL OR p.color = '' THEN
      substring(p.sku from ('^' || regexp_replace(p.parent_sku, '([\\.\\$\\^\\*\\+\\?\\(\\)\\[\\]\\|])', '\\\\\\1', 'g') || '-(.+)-[^-]+$'))
    ELSE p.color
  END,
  size = CASE
    WHEN p.size IS NULL OR p.size = '' THEN
      substring(p.sku from '-([^-]+)$')
    ELSE p.size
  END
WHERE p.parent_sku IS NOT NULL
  AND p.parent_sku <> ''
  AND p.sku LIKE p.parent_sku || '-%-%'
  AND (p.color IS NULL OR p.color = '' OR p.size IS NULL OR p.size = '');