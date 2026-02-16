
-- =============================================
-- 1. MULTI-CHANNEL SUPPORT: Add channel to whatsapp_messages
-- =============================================
ALTER TABLE public.whatsapp_messages 
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

-- Index for channel filtering
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_channel ON public.whatsapp_messages(channel);

-- =============================================
-- 2. WHATSAPP GROUPS VIP MODULE
-- =============================================

-- Store synced WhatsApp groups
CREATE TABLE public.whatsapp_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  participant_count INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  is_vip BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  instance_id TEXT, -- Z-API instance reference
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, instance_id)
);

ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access whatsapp_groups" ON public.whatsapp_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Group campaigns for bulk messaging
CREATE TABLE public.group_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, scheduled, sending, completed, failed
  message_type TEXT NOT NULL DEFAULT 'text', -- text, image, video, audio, document, poll
  message_content TEXT,
  media_url TEXT,
  poll_options JSONB, -- for polls: {title: "", options: ["opt1","opt2"]}
  ai_prompt TEXT, -- if AI-generated content
  ai_generated_content TEXT,
  target_groups UUID[] DEFAULT '{}', -- array of whatsapp_groups ids
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_groups INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access group_campaigns" ON public.group_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Log each message sent to a group
CREATE TABLE public.group_campaign_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.group_campaigns(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, failed
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  message_id TEXT, -- Z-API message id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.group_campaign_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access group_campaign_messages" ON public.group_campaign_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_whatsapp_groups_updated_at
  BEFORE UPDATE ON public.whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_group_campaigns_updated_at
  BEFORE UPDATE ON public.group_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for groups and campaigns
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_campaigns;
