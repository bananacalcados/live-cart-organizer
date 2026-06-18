ALTER TABLE public.instagram_comment_rules
  ADD COLUMN IF NOT EXISTS reply_comment_variations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dm_buttons jsonb NOT NULL DEFAULT '[]'::jsonb;