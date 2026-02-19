-- Add overlay config to live_sessions
ALTER TABLE public.live_sessions 
ADD COLUMN IF NOT EXISTS overlay_config jsonb DEFAULT '{}';

-- Add checkout tracking to live_viewers
ALTER TABLE public.live_viewers 
ADD COLUMN IF NOT EXISTS checkout_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS checkout_completed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS checkout_url text;