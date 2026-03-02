
-- Tabela de modelos de mensagens reutilizáveis
CREATE TABLE public.group_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  message_content TEXT,
  media_url TEXT,
  poll_options JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage templates"
  ON public.group_message_templates FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Tabela de variáveis dinâmicas por campanha
CREATE TABLE public.campaign_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.group_campaigns(id) ON DELETE CASCADE,
  variable_name TEXT NOT NULL,
  variable_value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, variable_name)
);

ALTER TABLE public.campaign_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage campaign variables"
  ON public.campaign_variables FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
