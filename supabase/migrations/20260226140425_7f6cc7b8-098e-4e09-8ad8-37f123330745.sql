
-- Add expedition tracking columns to pos_sales for online shipments
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS expedition_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS tracking_code text;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS shipping_address jsonb;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS shipping_notes text;

-- Add index for expedition queries
CREATE INDEX IF NOT EXISTS idx_pos_sales_expedition ON pos_sales(store_id, sale_type, expedition_status) WHERE sale_type IN ('online', 'pickup');
