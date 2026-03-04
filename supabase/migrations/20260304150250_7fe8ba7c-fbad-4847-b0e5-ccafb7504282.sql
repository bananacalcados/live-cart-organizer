ALTER TABLE public.dispatch_history 
  ADD COLUMN IF NOT EXISTS processing_batch boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_components jsonb DEFAULT null,
  ADD COLUMN IF NOT EXISTS has_dynamic_vars boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS header_media_url text DEFAULT null;