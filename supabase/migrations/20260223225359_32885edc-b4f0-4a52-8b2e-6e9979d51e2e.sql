
-- Add Tiny shipping method IDs to freight quotes
ALTER TABLE public.expedition_freight_quotes
  ADD COLUMN IF NOT EXISTS tiny_forma_envio_id text,
  ADD COLUMN IF NOT EXISTS tiny_forma_frete_id text,
  ADD COLUMN IF NOT EXISTS tiny_service_code text;

-- Add Tiny shipping method IDs to orders
ALTER TABLE public.expedition_orders
  ADD COLUMN IF NOT EXISTS tiny_forma_envio_id text,
  ADD COLUMN IF NOT EXISTS tiny_forma_frete_id text,
  ADD COLUMN IF NOT EXISTS tiny_service_code text;
