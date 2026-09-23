ALTER TABLE public.shipment_simulations
  ADD COLUMN IF NOT EXISTS incident_type text,
  ADD COLUMN IF NOT EXISTS incident_at timestamptz,
  ADD COLUMN IF NOT EXISTS incident_note text;