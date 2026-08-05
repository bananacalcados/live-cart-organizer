CREATE TABLE IF NOT EXISTS public.meta_media_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id text NOT NULL,
  media_url text NOT NULL,
  media_id text NOT NULL,
  mime_type text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_number_id, media_url)
);

GRANT ALL ON public.meta_media_cache TO service_role;
ALTER TABLE public.meta_media_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meta_media_cache service only" ON public.meta_media_cache;

ALTER TABLE public.dispatch_recipients
  ADD COLUMN IF NOT EXISTS error_code integer,
  ADD COLUMN IF NOT EXISTS fallback_provider text,
  ADD COLUMN IF NOT EXISTS fallback_at timestamptz;

ALTER TABLE public.campanha_envios
  ADD COLUMN IF NOT EXISTS erro_code integer,
  ADD COLUMN IF NOT EXISTS fallback_provider text,
  ADD COLUMN IF NOT EXISTS fallback_at timestamptz;