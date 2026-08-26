CREATE TABLE IF NOT EXISTS public.chargeback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id uuid,
  action text NOT NULL,
  from_value text,
  to_value text,
  note text,
  customer_name_snapshot text,
  order_name_snapshot text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.chargeback_events TO authenticated;
GRANT ALL ON public.chargeback_events TO service_role;

ALTER TABLE public.chargeback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chargeback_events_select" ON public.chargeback_events;
CREATE POLICY "chargeback_events_select" ON public.chargeback_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "chargeback_events_insert" ON public.chargeback_events;
CREATE POLICY "chargeback_events_insert" ON public.chargeback_events
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_chargeback_events_cb ON public.chargeback_events(chargeback_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_chargeback_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.chargeback_events (chargeback_id, action, to_value, customer_name_snapshot, order_name_snapshot, actor_id, note)
    VALUES (NEW.id, 'created', NEW.status, NEW.customer_name, NEW.source_order_name, auth.uid(), NEW.reason);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.chargeback_events (chargeback_id, action, from_value, to_value, customer_name_snapshot, order_name_snapshot, actor_id)
      VALUES (NEW.id, 'status_changed', OLD.status, NEW.status, NEW.customer_name, NEW.source_order_name, auth.uid());
    END IF;
    IF NEW.blocked IS DISTINCT FROM OLD.blocked THEN
      NEW.blocked_at := CASE WHEN NEW.blocked THEN now() ELSE NULL END;
      NEW.blocked_by := CASE WHEN NEW.blocked THEN auth.uid() ELSE NULL END;
      INSERT INTO public.chargeback_events (chargeback_id, action, from_value, to_value, customer_name_snapshot, order_name_snapshot, actor_id)
      VALUES (NEW.id, CASE WHEN NEW.blocked THEN 'blocked' ELSE 'unblocked' END, OLD.blocked::text, NEW.blocked::text, NEW.customer_name, NEW.source_order_name, auth.uid());
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO public.chargeback_events (chargeback_id, action, from_value, customer_name_snapshot, order_name_snapshot, actor_id)
    VALUES (OLD.id, 'deleted', OLD.status, OLD.customer_name, OLD.source_order_name, auth.uid());
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_chargeback_event ON public.chargebacks;
CREATE TRIGGER trg_log_chargeback_event
BEFORE INSERT OR UPDATE OR DELETE ON public.chargebacks
FOR EACH ROW EXECUTE FUNCTION public.log_chargeback_event();