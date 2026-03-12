
CREATE TABLE public.crm_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage CRM templates"
ON public.crm_message_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER set_crm_message_templates_updated_at
  BEFORE UPDATE ON public.crm_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
