ALTER TABLE public.group_campaign_scheduled_messages
ADD COLUMN IF NOT EXISTS disable_link_preview boolean NOT NULL DEFAULT false;