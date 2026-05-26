ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS meta_template_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_template_language TEXT DEFAULT 'pt_BR',
  ADD COLUMN IF NOT EXISTS meta_template_body_variables JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS meta_template_header_variable TEXT;