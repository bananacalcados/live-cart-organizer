ALTER TABLE public.product_dedup_index DROP CONSTRAINT IF EXISTS product_dedup_index_validation_status_check;
ALTER TABLE public.product_dedup_index ADD CONSTRAINT product_dedup_index_validation_status_check
  CHECK (validation_status = ANY (ARRAY['pending'::text, 'consistent'::text, 'divergent'::text, 'no_tiny_id'::text, 'tiny_error'::text, 'single_store'::text]));

UPDATE public.product_dedup_index
SET imported_at = now(),
    validation_status = 'no_tiny_id'
WHERE imported_at IS NULL
  AND (tiny_ids_per_store IS NULL OR tiny_ids_per_store::text IN ('{}','null') OR tiny_ids_per_store = '{}'::jsonb);