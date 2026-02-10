
-- Add default shipping cost to events
ALTER TABLE public.events ADD COLUMN default_shipping_cost numeric DEFAULT NULL;
