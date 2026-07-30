ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS member_area_notify_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS member_area_wa_number_id uuid,
  ADD COLUMN IF NOT EXISTS member_area_template_name text,
  ADD COLUMN IF NOT EXISTS member_area_template_language text DEFAULT 'pt_BR',
  ADD COLUMN IF NOT EXISTS member_area_template_body_variables jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS member_area_template_header_variable text;