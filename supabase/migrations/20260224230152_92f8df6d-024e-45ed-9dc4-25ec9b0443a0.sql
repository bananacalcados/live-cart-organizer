
-- 1. Restructure pos_seller_commission_tiers for goal-based model
ALTER TABLE public.pos_seller_commission_tiers 
  ADD COLUMN IF NOT EXISTS goal_value NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS achievement_percent NUMERIC DEFAULT 0;

-- Migrate existing data: convert min_revenue/max_revenue to achievement-based
-- Keep old columns for backward compat but new UI will use goal_value + achievement_percent

-- 2. Add RFM strategy columns to pos_seller_tasks
ALTER TABLE public.pos_seller_tasks
  ADD COLUMN IF NOT EXISTS contact_strategy TEXT,
  ADD COLUMN IF NOT EXISTS offer_description TEXT,
  ADD COLUMN IF NOT EXISTS avg_ticket NUMERIC;
