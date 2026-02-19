
-- Table to store WhatsApp verification codes for live commerce
CREATE TABLE public.live_phone_verifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX idx_live_phone_verifications_phone ON public.live_phone_verifications(phone, verified);

-- Auto-cleanup old codes (keep table lean)
CREATE INDEX idx_live_phone_verifications_expires ON public.live_phone_verifications(expires_at);

-- RLS: allow anonymous access for live commerce verification
ALTER TABLE public.live_phone_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert for verification"
ON public.live_phone_verifications FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow anonymous select for verification"
ON public.live_phone_verifications FOR SELECT
USING (true);

CREATE POLICY "Allow anonymous update for verification"
ON public.live_phone_verifications FOR UPDATE
USING (true);
