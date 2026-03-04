
-- Meta Ad Accounts table
CREATE TABLE public.meta_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL UNIQUE,
  account_name text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage meta_ad_accounts"
ON public.meta_ad_accounts
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Meta Ad Spend Daily table
CREATE TABLE public.meta_ad_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL REFERENCES public.meta_ad_accounts(account_id) ON DELETE CASCADE,
  date date NOT NULL,
  spend numeric DEFAULT 0,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  cpm numeric DEFAULT 0,
  cpc numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(account_id, date)
);

ALTER TABLE public.meta_ad_spend_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage meta_ad_spend_daily"
ON public.meta_ad_spend_daily
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Add cost_per_message to dispatch_history
ALTER TABLE public.dispatch_history
ADD COLUMN IF NOT EXISTS cost_per_message numeric DEFAULT NULL;
