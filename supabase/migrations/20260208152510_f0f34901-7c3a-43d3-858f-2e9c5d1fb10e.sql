-- Add discount, free shipping and gift fields to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS discount_type text CHECK (discount_type IN ('fixed', 'percentage')),
ADD COLUMN IF NOT EXISTS discount_value numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS free_shipping boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_gift boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.orders.discount_type IS 'Type of discount: fixed (R$) or percentage (%)';
COMMENT ON COLUMN public.orders.discount_value IS 'Discount value based on discount_type';
COMMENT ON COLUMN public.orders.free_shipping IS 'Whether shipping is free for this order';
COMMENT ON COLUMN public.orders.has_gift IS 'Whether this order contains a gift/brinde';