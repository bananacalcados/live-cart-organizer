ALTER TABLE public.tiny_management_sync_log ADD COLUMN IF NOT EXISTS current_date_syncing text;
ALTER TABLE public.tiny_management_sync_log ADD COLUMN IF NOT EXISTS date_from text;
ALTER TABLE public.tiny_management_sync_log ADD COLUMN IF NOT EXISTS date_to text;
ALTER TABLE public.tiny_management_sync_log ADD COLUMN IF NOT EXISTS phase text DEFAULT 'orders';