CREATE TABLE public.vip_group_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_year text NOT NULL,
  strategy_prompt text,
  strategy_content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(month_year)
);

ALTER TABLE public.vip_group_strategies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.vip_group_strategies FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Also add strategy columns to group_campaigns if not existing
ALTER TABLE public.group_campaigns ADD COLUMN IF NOT EXISTS strategy_prompt text;
ALTER TABLE public.group_campaigns ADD COLUMN IF NOT EXISTS strategy_content text;