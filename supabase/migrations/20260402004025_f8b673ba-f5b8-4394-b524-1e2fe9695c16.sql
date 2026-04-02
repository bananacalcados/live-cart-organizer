
ALTER TABLE public.ad_leads
ADD COLUMN IF NOT EXISTS conversation_stage text DEFAULT 'info_qualificacao',
ADD COLUMN IF NOT EXISTS followup_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_followup_at timestamptz,
ADD COLUMN IF NOT EXISTS payment_link_sent boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS live_invite_sent boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS interested_product_keywords text[];
