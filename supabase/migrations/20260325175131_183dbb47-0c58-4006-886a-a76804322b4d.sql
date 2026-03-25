
-- Add automation_enabled flag to events table
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS automation_enabled boolean NOT NULL DEFAULT false;

-- Add delivery_method to orders for tracking which fulfillment path was chosen
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_method text;
