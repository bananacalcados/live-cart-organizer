ALTER TABLE public.events ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS end_date date;

COMMENT ON COLUMN public.events.start_date IS 'Data de início do evento/live (pode ser futura)';
COMMENT ON COLUMN public.events.end_date IS 'Data de término do evento/live (para eventos de vários dias)';