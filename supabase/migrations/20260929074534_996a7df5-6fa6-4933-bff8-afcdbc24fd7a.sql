CREATE TABLE public.automation_dispatch_sent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  phone text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sent',
  provider_at_send text,
  unified_id uuid
);
GRANT SELECT ON public.automation_dispatch_sent_log TO authenticated;
GRANT ALL ON public.automation_dispatch_sent_log TO service_role;
ALTER TABLE public.automation_dispatch_sent_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read automation_dispatch_sent_log" ON public.automation_dispatch_sent_log FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_adsl_flow ON public.automation_dispatch_sent_log(flow_id, sent_at);

CREATE OR REPLACE FUNCTION public.log_automation_dispatch_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    INSERT INTO automation_dispatch_sent_log(flow_id, phone, sent_at, status, provider_at_send, unified_id)
    VALUES (NEW.flow_id, NEW.phone, NEW.sent_at, NEW.status, NEW.provider_at_send, NEW.unified_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_log_automation_dispatch_sent AFTER INSERT OR UPDATE ON public.automation_dispatch_sent
FOR EACH ROW EXECUTE FUNCTION public.log_automation_dispatch_sent();

INSERT INTO public.automation_dispatch_sent_log(flow_id, phone, sent_at, status, provider_at_send, unified_id)
SELECT flow_id, phone, sent_at, status, provider_at_send, unified_id FROM public.automation_dispatch_sent;

DO $$
DECLARE f text; def text;
BEGIN
  FOREACH f IN ARRAY ARRAY['automation_sales_buyers','automation_sales_results'] LOOP
    SELECT pg_get_functiondef(('public.'||f)::regproc) INTO def;
    IF position('FROM automation_dispatch_sent d' in def) > 0 THEN
      EXECUTE replace(def, 'FROM automation_dispatch_sent d', 'FROM automation_dispatch_sent_log d');
    END IF;
  END LOOP;
END $$;