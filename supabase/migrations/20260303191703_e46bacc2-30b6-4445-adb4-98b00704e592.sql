
-- Marketing calendar goals per month
CREATE TABLE public.marketing_calendar_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  goals JSONB DEFAULT '[]'::jsonb,
  actions TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(year, month)
);

ALTER TABLE public.marketing_calendar_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage calendar goals"
ON public.marketing_calendar_goals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Marketing calendar day entries (text, photos, audios, etc.)
CREATE TABLE public.marketing_calendar_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date DATE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT DEFAULT '',
  entry_type TEXT NOT NULL DEFAULT 'text',
  media_url TEXT,
  media_type TEXT,
  color TEXT DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_calendar_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage calendar entries"
ON public.marketing_calendar_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_marketing_calendar_goals_updated_at
BEFORE UPDATE ON public.marketing_calendar_goals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_marketing_calendar_entries_updated_at
BEFORE UPDATE ON public.marketing_calendar_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
