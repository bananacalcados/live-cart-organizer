
-- Add unique constraint on tiny_category_id for upsert support
CREATE UNIQUE INDEX IF NOT EXISTS financial_categories_tiny_category_id_key ON public.financial_categories (tiny_category_id) WHERE tiny_category_id IS NOT NULL;
