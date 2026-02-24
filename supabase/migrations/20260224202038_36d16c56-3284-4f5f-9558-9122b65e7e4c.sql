
-- Expand pos_goals with category, brand, custom period, and prize fields
ALTER TABLE public.pos_goals ADD COLUMN IF NOT EXISTS goal_category text;
ALTER TABLE public.pos_goals ADD COLUMN IF NOT EXISTS goal_brand text;
ALTER TABLE public.pos_goals ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE public.pos_goals ADD COLUMN IF NOT EXISTS period_end date;
ALTER TABLE public.pos_goals ADD COLUMN IF NOT EXISTS prize_label text;
ALTER TABLE public.pos_goals ADD COLUMN IF NOT EXISTS prize_value numeric;
ALTER TABLE public.pos_goals ADD COLUMN IF NOT EXISTS prize_type text;

-- Create pos_goal_progress table for tracking seller progress on category/brand goals
CREATE TABLE public.pos_goal_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_id uuid NOT NULL REFERENCES public.pos_goals(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES public.pos_sellers(id) ON DELETE SET NULL,
  current_value numeric NOT NULL DEFAULT 0,
  last_sale_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_goal_progress_goal_id ON public.pos_goal_progress(goal_id);
CREATE INDEX idx_goal_progress_seller_id ON public.pos_goal_progress(seller_id);
CREATE UNIQUE INDEX idx_goal_progress_unique ON public.pos_goal_progress(goal_id, COALESCE(seller_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Enable RLS
ALTER TABLE public.pos_goal_progress ENABLE ROW LEVEL SECURITY;

-- RLS policies (same pattern as pos_goals - allow all for authenticated users)
CREATE POLICY "Allow all access to pos_goal_progress" ON public.pos_goal_progress FOR ALL USING (true) WITH CHECK (true);
