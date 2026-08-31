CREATE TABLE public.shipment_simulations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tracking_code TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_phone TEXT,
  order_id UUID,
  order_reference TEXT,
  origin_city TEXT NOT NULL,
  origin_state TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  destination_state TEXT NOT NULL,
  stops JSONB NOT NULL DEFAULT '[]'::jsonb,
  posted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  step_interval_days INTEGER NOT NULL DEFAULT 2,
  manual_offset_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_simulations TO authenticated;
GRANT ALL ON public.shipment_simulations TO service_role;

ALTER TABLE public.shipment_simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage shipment simulations"
ON public.shipment_simulations
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE INDEX idx_shipment_simulations_created_at ON public.shipment_simulations (created_at DESC);

CREATE TRIGGER trg_shipment_simulations_updated_at
BEFORE UPDATE ON public.shipment_simulations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();