-- Add column to track if order was paid externally (outside Yampi/Shopify)
ALTER TABLE public.orders ADD COLUMN paid_externally boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.orders.paid_externally IS 'Indicates if the order was paid outside of Yampi/Shopify and needs manual fulfillment';