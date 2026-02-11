ALTER TABLE public.pos_product_sync_log
ADD COLUMN IF NOT EXISTS total_products integer DEFAULT 0;