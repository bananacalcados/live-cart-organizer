ALTER TABLE public.shipment_simulations
  ADD COLUMN IF NOT EXISTS sale_id UUID,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS fulfillment TEXT NOT NULL DEFAULT 'carrier',
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'em_separacao',
  ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS stage_history JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stage_days JSONB,
  ADD COLUMN IF NOT EXISTS real_tracking_code TEXT,
  ADD COLUMN IF NOT EXISTS real_carrier TEXT,
  ADD COLUMN IF NOT EXISTS real_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_real_sync TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE public.shipment_simulations ALTER COLUMN origin_city DROP NOT NULL;
ALTER TABLE public.shipment_simulations ALTER COLUMN origin_state DROP NOT NULL;
ALTER TABLE public.shipment_simulations ALTER COLUMN destination_city DROP NOT NULL;
ALTER TABLE public.shipment_simulations ALTER COLUMN destination_state DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_simulations_sale ON public.shipment_simulations (sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipment_simulations_real_code ON public.shipment_simulations (real_tracking_code) WHERE real_tracking_code IS NOT NULL;

INSERT INTO public.app_settings (key, value)
VALUES ('shipment_stage_config', '{"em_separacao_days":1,"separado_days":1,"embalado_days":1,"business_days":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.gen_shipment_public_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate TEXT;
  i INT;
BEGIN
  LOOP
    candidate := 'BC';
    FOR i IN 1..6 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.shipment_simulations WHERE tracking_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_shipment_tracking_for_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fulfillment TEXT;
BEGIN
  IF NEW.status NOT IN ('paid', 'completed') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status_cancelamento::text, 'ativo') <> 'ativo' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_simulations WHERE sale_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_fulfillment := CASE WHEN COALESCE(NEW.is_store_pickup, false) THEN 'pickup' ELSE 'carrier' END;

  INSERT INTO public.shipment_simulations (
    tracking_code, sale_id, kind, fulfillment, stage, stage_started_at,
    customer_name, customer_phone, order_reference,
    destination_city, destination_state, posted_at, status
  ) VALUES (
    public.gen_shipment_public_code(), NEW.id, 'order', v_fulfillment, 'em_separacao', now(),
    NEW.customer_name, NEW.customer_phone, upper(substr(NEW.id::text, 1, 8)),
    NEW.customer_city, NEW.customer_state, now(), 'active'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_shipment_tracking ON public.pos_sales;
CREATE TRIGGER trg_ensure_shipment_tracking
AFTER INSERT OR UPDATE OF status ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.ensure_shipment_tracking_for_sale();