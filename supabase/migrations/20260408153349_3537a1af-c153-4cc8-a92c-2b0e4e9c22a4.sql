
-- Table to prevent concurrent livete-respond executions for the same phone
CREATE TABLE IF NOT EXISTS public.livete_processing_locks (
  phone text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  message_hash text
);

-- Auto-expire locks older than 2 minutes
CREATE OR REPLACE FUNCTION public.cleanup_livete_locks() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.livete_processing_locks WHERE locked_at < now() - interval '2 minutes';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_cleanup_livete_locks
  BEFORE INSERT ON public.livete_processing_locks
  FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_livete_locks();

-- RLS: service role only
ALTER TABLE public.livete_processing_locks ENABLE ROW LEVEL SECURITY;
