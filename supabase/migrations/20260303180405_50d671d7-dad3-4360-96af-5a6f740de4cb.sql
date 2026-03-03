-- Add paid_at column to pos_sales
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;