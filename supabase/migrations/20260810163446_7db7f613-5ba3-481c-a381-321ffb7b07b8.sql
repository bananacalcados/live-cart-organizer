CREATE TABLE public.member_area_magic_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.member_area_magic_links TO service_role;

ALTER TABLE public.member_area_magic_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages magic links"
ON public.member_area_magic_links FOR ALL
USING (false) WITH CHECK (false);

CREATE INDEX idx_member_area_magic_links_phone ON public.member_area_magic_links (phone);
CREATE INDEX idx_member_area_magic_links_expires ON public.member_area_magic_links (expires_at);

CREATE TRIGGER trg_member_area_magic_links_updated_at
BEFORE UPDATE ON public.member_area_magic_links
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();