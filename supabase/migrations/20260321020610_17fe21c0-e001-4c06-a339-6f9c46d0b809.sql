CREATE TABLE public.whatsapp_ad_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword TEXT NOT NULL,
    campaign_label TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_whatsapp_ad_keywords_active 
ON public.whatsapp_ad_keywords (is_active) 
WHERE is_active = true;

ALTER TABLE public.whatsapp_ad_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage ad keywords"
ON public.whatsapp_ad_keywords
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);