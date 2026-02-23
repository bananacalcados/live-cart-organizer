-- Add column to pos_sales to link back to the CRM order that originated it
ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS source_order_id uuid REFERENCES public.orders(id);

-- Add column to orders to track if it was sent to POS
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pos_sale_id uuid;
