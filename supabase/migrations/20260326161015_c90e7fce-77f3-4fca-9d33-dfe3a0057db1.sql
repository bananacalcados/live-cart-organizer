
-- Presenter alerts table for live commerce notifications
CREATE TABLE public.livete_presenter_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  phone text NOT NULL,
  customer_name text,
  alert_type text NOT NULL DEFAULT 'general',
  message text NOT NULL,
  product_title text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.livete_presenter_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read alerts" ON public.livete_presenter_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can update alerts" ON public.livete_presenter_alerts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Service can insert alerts" ON public.livete_presenter_alerts FOR INSERT TO service_role WITH CHECK (true);

-- Enable realtime for presenter alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.livete_presenter_alerts;

-- Add cancellation counter to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS live_cancellation_count integer DEFAULT 0;
