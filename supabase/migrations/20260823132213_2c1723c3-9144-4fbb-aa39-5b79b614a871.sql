ALTER TABLE public.link_page_visits ADD COLUMN IF NOT EXISTS click_id text;
CREATE INDEX IF NOT EXISTS idx_link_page_visits_click_id ON public.link_page_visits(click_id) WHERE click_id IS NOT NULL;