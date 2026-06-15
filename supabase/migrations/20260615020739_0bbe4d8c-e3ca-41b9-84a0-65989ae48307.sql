ALTER TABLE public.instagram_comment_rules
  ADD COLUMN IF NOT EXISTS target_media_id text,
  ADD COLUMN IF NOT EXISTS target_media_caption text;

COMMENT ON COLUMN public.instagram_comment_rules.target_media_id IS 'When set, the rule only applies to comments/replies on this specific Instagram media (post/reel/story). NULL = applies to all media of the selected media_types.';