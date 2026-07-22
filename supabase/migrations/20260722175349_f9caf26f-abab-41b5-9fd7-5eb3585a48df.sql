
-- 1. Rename legacy follow-up table for historical read-only access
ALTER TABLE IF EXISTS public.livete_followups RENAME TO _legacy_livete_followups;

-- 2. New: per-event follow-up configuration (dynamic list)
CREATE TABLE public.event_followup_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','instagram')),
  order_index integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  -- WhatsApp template fields
  template_name text,
  template_language text DEFAULT 'pt_BR',
  template_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  -- Instagram DM fields
  message_text text,
  buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Timing
  delay_minutes integer NOT NULL DEFAULT 60,
  trigger_source text NOT NULL DEFAULT 'auto'
    CHECK (trigger_source IN ('auto','initial_template','last_customer_reply','incomplete_order_created','order_created')),
  -- Stop conditions
  stop_on_reply boolean NOT NULL DEFAULT true,
  stop_on_paid boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_followup_configs TO authenticated;
GRANT ALL ON public.event_followup_configs TO service_role;
ALTER TABLE public.event_followup_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth full access to event_followup_configs"
  ON public.event_followup_configs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX idx_event_followup_configs_event ON public.event_followup_configs(event_id, channel, order_index);

CREATE TRIGGER trg_event_followup_configs_updated_at
  BEFORE UPDATE ON public.event_followup_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Dispatch queue / audit log
CREATE TABLE public.event_followup_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES public.event_followup_configs(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  channel text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','skipped','failed','locked')),
  skip_reason text,
  error_message text,
  meta_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (config_id, order_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_followup_dispatches TO authenticated;
GRANT ALL ON public.event_followup_dispatches TO service_role;
ALTER TABLE public.event_followup_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read event_followup_dispatches"
  ON public.event_followup_dispatches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service manages event_followup_dispatches"
  ON public.event_followup_dispatches FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_event_followup_dispatches_ready
  ON public.event_followup_dispatches(status, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX idx_event_followup_dispatches_order
  ON public.event_followup_dispatches(order_id);

CREATE TRIGGER trg_event_followup_dispatches_updated_at
  BEFORE UPDATE ON public.event_followup_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
