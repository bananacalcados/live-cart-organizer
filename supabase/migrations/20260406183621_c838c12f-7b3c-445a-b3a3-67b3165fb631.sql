-- Add tags column to zoppy_customers
ALTER TABLE public.zoppy_customers ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- GIN index for fast tag lookups
CREATE INDEX IF NOT EXISTS idx_zoppy_customers_tags ON public.zoppy_customers USING GIN(tags);

-- Add Jess agent mode fields to automation_flows
ALTER TABLE public.automation_flows ADD COLUMN IF NOT EXISTS use_jess_agent BOOLEAN DEFAULT false;
ALTER TABLE public.automation_flows ADD COLUMN IF NOT EXISTS jess_campaign_name TEXT;