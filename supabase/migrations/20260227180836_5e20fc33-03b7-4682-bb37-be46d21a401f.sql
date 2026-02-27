
-- Step 1: Delete duplicates, keeping the row with the latest synced_at for each (store_id, sku, variant)
DELETE FROM pos_products
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY store_id, sku, variant
        ORDER BY synced_at DESC NULLS LAST, created_at DESC NULLS LAST
      ) as rn
    FROM pos_products
    WHERE sku IS NOT NULL AND sku != ''
  ) ranked
  WHERE rn > 1
);

-- Step 2: Drop the old unique constraint that includes tiny_id
ALTER TABLE pos_products DROP CONSTRAINT IF EXISTS pos_products_store_id_tiny_id_sku_variant_key;

-- Step 3: Create new unique constraint without tiny_id (for products with SKU)
-- We use a unique index with a condition to handle empty SKUs gracefully
CREATE UNIQUE INDEX pos_products_store_sku_variant_uniq
  ON pos_products (store_id, sku, variant)
  WHERE sku IS NOT NULL AND sku != '';
