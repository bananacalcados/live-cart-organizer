ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_store_id uuid,
  ADD COLUMN IF NOT EXISTS pickup_date date,
  ADD COLUMN IF NOT EXISTS pickup_pay_at_store boolean NOT NULL DEFAULT false;

ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS pickup_date date,
  ADD COLUMN IF NOT EXISTS is_store_pickup boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.pos_pickup_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  sale_id uuid,
  order_id uuid,
  alert_type text NOT NULL CHECK (alert_type IN ('created','due_date')),
  target_date date,
  customer_name text,
  total numeric,
  dismissed_at timestamptz,
  dismissed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_pickup_alerts TO authenticated;
GRANT ALL ON public.pos_pickup_alerts TO service_role;

ALTER TABLE public.pos_pickup_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage pickup alerts"
  ON public.pos_pickup_alerts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_pickup_alerts_sale_type
  ON public.pos_pickup_alerts (sale_id, alert_type) WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_pickup_alerts_store_date
  ON public.pos_pickup_alerts (store_id, target_date);

CREATE TRIGGER trg_pos_pickup_alerts_updated_at
  BEFORE UPDATE ON public.pos_pickup_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_pickup_alerts;