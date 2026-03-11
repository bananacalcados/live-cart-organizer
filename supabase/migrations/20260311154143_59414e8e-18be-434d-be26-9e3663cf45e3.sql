
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS pickup_store_id uuid REFERENCES pos_stores(id),
  ADD COLUMN IF NOT EXISTS is_pickup boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_delivery boolean DEFAULT false;
