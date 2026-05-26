ALTER TABLE public.live_campaign_dispatches
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS ig_user_id text,
  ADD COLUMN IF NOT EXISTS ig_comment_id text;

ALTER TABLE public.live_campaigns
  ADD COLUMN IF NOT EXISTS channel_preference text NOT NULL DEFAULT 'whatsapp';

ALTER TABLE public.live_campaign_messages
  ADD COLUMN IF NOT EXISTS meta_template_name text,
  ADD COLUMN IF NOT EXISTS meta_template_language text DEFAULT 'pt_BR',
  ADD COLUMN IF NOT EXISTS meta_template_variables jsonb;

CREATE INDEX IF NOT EXISTS idx_live_dispatches_channel ON public.live_campaign_dispatches(channel, status);