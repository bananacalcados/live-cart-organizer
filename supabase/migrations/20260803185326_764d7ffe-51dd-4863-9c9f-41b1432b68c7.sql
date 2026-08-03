CREATE TABLE public.order_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  customer_phone text,
  event_type text NOT NULL,
  method text,
  gateway text,
  amount numeric,
  detail text,
  source text NOT NULL DEFAULT 'member_area',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.order_payment_events TO authenticated;
GRANT ALL ON public.order_payment_events TO service_role;

ALTER TABLE public.order_payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read payment events"
ON public.order_payment_events
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX idx_order_payment_events_order ON public.order_payment_events (order_id, created_at DESC);
CREATE INDEX idx_order_payment_events_phone ON public.order_payment_events (customer_phone, created_at DESC);

ALTER TABLE public.order_payment_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_payment_events;