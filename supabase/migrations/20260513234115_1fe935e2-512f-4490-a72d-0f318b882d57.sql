-- Backup table
CREATE TABLE IF NOT EXISTS public.pos_products_phantom_backup_20260513 AS
SELECT p.*
FROM public.pos_products p
WHERE (p.size IS NULL OR p.size='')
  AND (p.color IS NULL OR p.color='')
  AND p.is_active = true
  AND EXISTS (
    SELECT 1 FROM public.pos_products r
    WHERE r.store_id = p.store_id
      AND r.sku = p.sku
      AND r.id <> p.id
      AND r.is_active = true
      AND (r.size IS NOT NULL AND r.size <> '')
  );

-- Delete the phantom rows
DELETE FROM public.pos_products p
WHERE (p.size IS NULL OR p.size='')
  AND (p.color IS NULL OR p.color='')
  AND p.is_active = true
  AND EXISTS (
    SELECT 1 FROM public.pos_products r
    WHERE r.store_id = p.store_id
      AND r.sku = p.sku
      AND r.id <> p.id
      AND r.is_active = true
      AND (r.size IS NOT NULL AND r.size <> '')
  );