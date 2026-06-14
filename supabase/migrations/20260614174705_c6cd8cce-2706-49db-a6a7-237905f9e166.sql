ALTER TABLE public.whatsapp_groups
  ADD COLUMN IF NOT EXISTS ddd33_count integer,
  ADD COLUMN IF NOT EXISTS ddd33_total_resolved integer,
  ADD COLUMN IF NOT EXISTS ddd33_synced_at timestamp with time zone;