
-- Add spotlight_products for real-time product highlighting during live
ALTER TABLE public.live_sessions ADD COLUMN IF NOT EXISTS spotlight_products JSONB DEFAULT '[]'::jsonb;

-- Add freight config to live sessions
ALTER TABLE public.live_sessions ADD COLUMN IF NOT EXISTS freight_config JSONB DEFAULT '{"free_above": null, "flat_rate": null, "enabled": false}'::jsonb;

-- Enable realtime for live_sessions (so spotlight changes propagate instantly)
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;

-- Add is_banned column for chat moderation
ALTER TABLE public.live_viewers ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.live_viewers ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- Add cart_items to track what viewers have in their carts
ALTER TABLE public.live_viewers ADD COLUMN IF NOT EXISTS cart_items JSONB DEFAULT '[]'::jsonb;
