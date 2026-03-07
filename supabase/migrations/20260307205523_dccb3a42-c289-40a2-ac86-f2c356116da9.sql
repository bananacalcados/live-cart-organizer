ALTER TABLE public.group_campaigns 
  ADD COLUMN IF NOT EXISTS group_name_template text,
  ADD COLUMN IF NOT EXISTS group_photo_url text,
  ADD COLUMN IF NOT EXISTS group_description text,
  ADD COLUMN IF NOT EXISTS group_only_admins_send boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_only_admins_add boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_admin_phones text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS group_pin_message_id text,
  ADD COLUMN IF NOT EXISTS group_pin_duration text DEFAULT '7_days';