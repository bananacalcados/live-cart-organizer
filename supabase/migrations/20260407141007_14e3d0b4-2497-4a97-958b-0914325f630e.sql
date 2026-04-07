CREATE TABLE public.ad_keyword_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.ad_campaigns_ai(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'document',
  filename TEXT,
  send_mode TEXT NOT NULL DEFAULT 'media_and_text',
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_keyword_media_campaign ON public.ad_keyword_media(campaign_id);
CREATE INDEX idx_ad_keyword_media_keyword ON public.ad_keyword_media(campaign_id, keyword);

ALTER TABLE public.ad_keyword_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage keyword media"
ON public.ad_keyword_media
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_ad_keyword_media_updated_at
BEFORE UPDATE ON public.ad_keyword_media
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();