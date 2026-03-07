ALTER TABLE public.group_redirect_links ADD COLUMN IF NOT EXISTS cached_invite_url text;
ALTER TABLE public.group_redirect_links ADD COLUMN IF NOT EXISTS cached_at timestamptz;