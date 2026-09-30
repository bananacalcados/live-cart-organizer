CREATE TABLE public.meta_ads_adset_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  campaign_id text,
  campaign_name text,
  adset_id text NOT NULL,
  adset_name text,
  date date NOT NULL,
  spend numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  reach bigint NOT NULL DEFAULT 0,
  link_clicks bigint NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, adset_id, date)
);
GRANT SELECT ON public.meta_ads_adset_spend_daily TO authenticated;
GRANT ALL ON public.meta_ads_adset_spend_daily TO service_role;
ALTER TABLE public.meta_ads_adset_spend_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read adset spend" ON public.meta_ads_adset_spend_daily FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_meta_adset_spend_date ON public.meta_ads_adset_spend_daily(date);