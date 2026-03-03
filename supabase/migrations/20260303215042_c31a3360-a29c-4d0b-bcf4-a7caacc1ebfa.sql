
CREATE TABLE public.marketing_recurring_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  color TEXT DEFAULT '#3b82f6',
  recurrence_type TEXT NOT NULL, -- 'daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'specific_weekdays'
  recurrence_config JSONB DEFAULT '{}'::jsonb,
  -- recurrence_config examples:
  -- daily: {}
  -- weekly: { "day_of_week": 1 } (0=Sun..6=Sat)
  -- biweekly: { "day_of_week": 1, "start_date": "2026-03-03" }
  -- monthly: { "day_of_month": 15 }
  -- yearly: { "month": 3, "day": 15 }
  -- specific_weekdays: { "days": [1,3,5] } (Mon, Wed, Fri)
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_recurring_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage recurring actions"
ON public.marketing_recurring_actions
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_marketing_recurring_actions_updated_at
BEFORE UPDATE ON public.marketing_recurring_actions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
