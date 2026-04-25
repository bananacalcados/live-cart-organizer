-- 1. Tabela de campanhas de Live
CREATE TABLE public.live_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  trigger_phrase TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  default_delay_seconds INTEGER NOT NULL DEFAULT 8,
  jess_prompt TEXT,
  jess_enabled BOOLEAN NOT NULL DEFAULT true,
  ask_shoe_size BOOLEAN NOT NULL DEFAULT true,
  whatsapp_number_id UUID,
  total_leads INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_campaigns_active ON public.live_campaigns(is_active) WHERE is_active = true;
CREATE INDEX idx_live_campaigns_phrase ON public.live_campaigns(LOWER(trigger_phrase));

ALTER TABLE public.live_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage live campaigns"
ON public.live_campaigns FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER update_live_campaigns_updated_at
BEFORE UPDATE ON public.live_campaigns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Sequência de mensagens da campanha
CREATE TABLE public.live_campaign_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.live_campaigns(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  message_type TEXT NOT NULL DEFAULT 'text', -- text | audio | video | image | document
  content TEXT,
  media_url TEXT,
  caption TEXT,
  delay_seconds INTEGER NOT NULL DEFAULT 8,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_campaign_messages_campaign ON public.live_campaign_messages(campaign_id, sort_order);

ALTER TABLE public.live_campaign_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage live campaign messages"
ON public.live_campaign_messages FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER update_live_campaign_messages_updated_at
BEFORE UPDATE ON public.live_campaign_messages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Fila de despachos por lead (pra cron processar com segurança)
CREATE TABLE public.live_campaign_dispatches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.live_campaigns(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.live_campaign_messages(id) ON DELETE CASCADE,
  lead_id UUID,
  phone TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_dispatches_pending ON public.live_campaign_dispatches(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_live_dispatches_phone ON public.live_campaign_dispatches(phone);
CREATE UNIQUE INDEX idx_live_dispatches_unique ON public.live_campaign_dispatches(campaign_id, phone, message_id);

ALTER TABLE public.live_campaign_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage live campaign dispatches"
ON public.live_campaign_dispatches FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on live campaign dispatches"
ON public.live_campaign_dispatches FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- 4. ad_leads: numeração e referência à campanha de Live
ALTER TABLE public.ad_leads
  ADD COLUMN IF NOT EXISTS shoe_size TEXT,
  ADD COLUMN IF NOT EXISTS live_campaign_id UUID REFERENCES public.live_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ad_leads_live_campaign ON public.ad_leads(live_campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_leads_shoe_size ON public.ad_leads(shoe_size) WHERE shoe_size IS NOT NULL;