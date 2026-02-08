-- Add coupon_code field to orders table
ALTER TABLE public.orders ADD COLUMN coupon_code TEXT;