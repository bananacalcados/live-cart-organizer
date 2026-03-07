ALTER TABLE public.group_campaigns ADD COLUMN IF NOT EXISTS group_pin_message_text text;
ALTER TABLE public.group_campaigns DROP COLUMN IF EXISTS group_pin_message_id;