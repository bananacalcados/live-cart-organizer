
CREATE TABLE public.lp_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_tag TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  instagram TEXT,
  source TEXT,
  metadata JSONB,
  converted BOOLEAN DEFAULT false,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lp_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public insert on lp_leads" ON public.lp_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow authenticated read on lp_leads" ON public.lp_leads FOR SELECT USING (true);
CREATE POLICY "Allow authenticated update on lp_leads" ON public.lp_leads FOR UPDATE USING (true);
