CREATE TABLE IF NOT EXISTS public.live_member_rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.live_member_rate_limits TO service_role;
ALTER TABLE public.live_member_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.live_member_rate_limit(_key TEXT, _limit INTEGER, _window_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hits INTEGER;
BEGIN
  INSERT INTO public.live_member_rate_limits AS r (key, hits, window_start)
  VALUES (_key, 1, now())
  ON CONFLICT (key) DO UPDATE
    SET hits = CASE WHEN r.window_start < now() - make_interval(secs => _window_seconds) THEN 1 ELSE r.hits + 1 END,
        window_start = CASE WHEN r.window_start < now() - make_interval(secs => _window_seconds) THEN now() ELSE r.window_start END
  RETURNING hits INTO _hits;

  RETURN _hits <= _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.live_member_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_member_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;