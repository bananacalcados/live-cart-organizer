
-- Ad Campaigns AI: configurable campaigns for the AI agent
CREATE TABLE public.ad_campaigns_ai (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'hibrido' CHECK (objective IN ('venda_direta', 'captacao_live', 'hibrido')),
  activation_keywords TEXT[] NOT NULL DEFAULT '{}',
  prompt TEXT NOT NULL DEFAULT '',
  product_info JSONB DEFAULT NULL,
  payment_conditions TEXT DEFAULT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL DEFAULT NULL,
  data_to_collect TEXT[] NOT NULL DEFAULT ARRAY['nome', 'tamanho'],
  whatsapp_number_id UUID DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  post_sale_action TEXT DEFAULT 'convite_live' CHECK (post_sale_action IN ('convite_live', 'nenhum', 'upsell')),
  post_capture_action TEXT DEFAULT 'oferta_produto' CHECK (post_capture_action IN ('oferta_produto', 'nenhum')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ad Leads: all leads captured by the AI agent
CREATE TABLE public.ad_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT DEFAULT NULL,
  campaign_id UUID REFERENCES public.ad_campaigns_ai(id) ON DELETE SET NULL,
  temperature TEXT NOT NULL DEFAULT 'frio' CHECK (temperature IN ('frio', 'morno', 'quente', 'super_quente', 'convertido')),
  collected_data JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'ad' CHECK (source IN ('ad', 'organic', 'referral', 'live')),
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL DEFAULT NULL,
  whatsapp_number_id UUID DEFAULT NULL,
  channel TEXT DEFAULT 'zapi',
  last_ai_contact_at TIMESTAMPTZ DEFAULT NULL,
  last_human_contact_at TIMESTAMPTZ DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast phone lookup
CREATE INDEX idx_ad_leads_phone ON public.ad_leads (phone);
CREATE INDEX idx_ad_leads_campaign ON public.ad_leads (campaign_id);
CREATE INDEX idx_ad_leads_event ON public.ad_leads (event_id);
CREATE INDEX idx_ad_leads_temperature ON public.ad_leads (temperature);

-- Nurture Steps: scheduled template/message steps before events
CREATE TABLE public.ad_campaign_nurture_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.ad_campaigns_ai(id) ON DELETE CASCADE,
  days_before_event INTEGER NOT NULL DEFAULT 0,
  send_time TIME NOT NULL DEFAULT '10:00',
  meta_template_name TEXT DEFAULT NULL,
  meta_template_vars JSONB DEFAULT NULL,
  zapi_message_text TEXT DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track which nurture messages were already sent
CREATE TABLE public.ad_nurture_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.ad_leads(id) ON DELETE CASCADE,
  nurture_step_id UUID NOT NULL REFERENCES public.ad_campaign_nurture_steps(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lead_id, nurture_step_id)
);

-- Enable RLS
ALTER TABLE public.ad_campaigns_ai ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_campaign_nurture_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_nurture_sent ENABLE ROW LEVEL SECURITY;

-- RLS policies - authenticated users can manage
CREATE POLICY "Authenticated users can manage ad campaigns" ON public.ad_campaigns_ai FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage ad leads" ON public.ad_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage nurture steps" ON public.ad_campaign_nurture_steps FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage nurture sent" ON public.ad_nurture_sent FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Service role needs access for edge functions
CREATE POLICY "Service role full access ad campaigns" ON public.ad_campaigns_ai FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access ad leads" ON public.ad_leads FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access nurture steps" ON public.ad_campaign_nurture_steps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access nurture sent" ON public.ad_nurture_sent FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER update_ad_campaigns_ai_updated_at BEFORE UPDATE ON public.ad_campaigns_ai FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ad_leads_updated_at BEFORE UPDATE ON public.ad_leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
