
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS ig_initial_message_buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ig_automations jsonb NOT NULL DEFAULT '[]'::jsonb;
