-- Add missing columns for NFC-e and sale tracking
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS nfce_number TEXT;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS nfce_key TEXT;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS nfce_pdf_url TEXT;
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS tiny_order_number TEXT;

-- Add config.toml entries handled separately
