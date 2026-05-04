
-- Tabela de follow-ups agendados de automações pós-venda física
CREATE TABLE IF NOT EXISTS public.automation_pos_followups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.automation_steps(id) ON DELETE CASCADE,
  step_index int NOT NULL,
  customer_phone text NOT NULL,
  customer_phone_suffix text GENERATED ALWAYS AS (right(regexp_replace(customer_phone, '\D', '', 'g'), 8)) STORED,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apf_due ON public.automation_pos_followups (scheduled_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_apf_phone_suffix ON public.automation_pos_followups (customer_phone_suffix);
CREATE INDEX IF NOT EXISTS idx_apf_flow ON public.automation_pos_followups (flow_id);

ALTER TABLE public.automation_pos_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth access automation_pos_followups"
  ON public.automation_pos_followups
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Trigger: ao concluir venda física, chama edge function para iniciar fluxos
CREATE OR REPLACE FUNCTION public.trg_pos_sale_completed_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/automation-trigger-pos-sale';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
BEGIN
  IF NEW.status = 'completed'
     AND COALESCE(NEW.sale_type,'physical') = 'physical'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status,'') <> 'completed') THEN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','apikey',v_anon,'Authorization','Bearer '||v_anon),
      body := jsonb_build_object('sale_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sale_completed_automation ON public.pos_sales;
CREATE TRIGGER trg_pos_sale_completed_automation
AFTER INSERT OR UPDATE OF status ON public.pos_sales
FOR EACH ROW
EXECUTE FUNCTION public.trg_pos_sale_completed_automation();
