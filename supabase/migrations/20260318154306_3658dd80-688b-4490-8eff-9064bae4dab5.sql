ALTER TABLE public.pos_goals DROP CONSTRAINT IF EXISTS pos_goals_period_check;

ALTER TABLE public.pos_goals
ADD CONSTRAINT pos_goals_period_check
CHECK (
  period = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'custom'::text])
);