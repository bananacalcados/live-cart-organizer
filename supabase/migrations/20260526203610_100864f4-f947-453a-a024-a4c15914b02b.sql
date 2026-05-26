ALTER TABLE public.events ADD COLUMN IF NOT EXISTS channel_preferences text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill from existing singular channel_preference
UPDATE public.events
SET channel_preferences = ARRAY[channel_preference]
WHERE (channel_preferences IS NULL OR cardinality(channel_preferences) = 0)
  AND channel_preference IS NOT NULL
  AND channel_preference <> 'auto';