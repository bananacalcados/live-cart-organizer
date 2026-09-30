ALTER FUNCTION public.participant_score_ranking(text[]) RENAME TO participant_score_ranking_live;

CREATE TABLE IF NOT EXISTS public.participant_score_cache (
  handle text PRIMARY KEY,
  comment_count integer, live_count integer, paid_orders integer, cancelled_orders integer,
  total_spent numeric, avg_ticket numeric, last_participation timestamptz, live_dates text[],
  score integer, category text, refreshed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.participant_score_cache TO service_role;
ALTER TABLE public.participant_score_cache ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.refresh_participant_score_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _psc ON COMMIT DROP AS SELECT * FROM public.participant_score_ranking_live(NULL);
  DELETE FROM public.participant_score_cache c WHERE NOT EXISTS (SELECT 1 FROM _psc s WHERE s.handle = c.handle);
  INSERT INTO public.participant_score_cache (handle, comment_count, live_count, paid_orders, cancelled_orders, total_spent, avg_ticket, last_participation, live_dates, score, category, refreshed_at)
  SELECT handle, comment_count, live_count, paid_orders, cancelled_orders, total_spent, avg_ticket, last_participation, live_dates, score, category, now() FROM _psc
  ON CONFLICT (handle) DO UPDATE SET comment_count=EXCLUDED.comment_count, live_count=EXCLUDED.live_count,
    paid_orders=EXCLUDED.paid_orders, cancelled_orders=EXCLUDED.cancelled_orders, total_spent=EXCLUDED.total_spent,
    avg_ticket=EXCLUDED.avg_ticket, last_participation=EXCLUDED.last_participation, live_dates=EXCLUDED.live_dates,
    score=EXCLUDED.score, category=EXCLUDED.category, refreshed_at=EXCLUDED.refreshed_at;
  DROP TABLE IF EXISTS _psc;
END $$;
REVOKE ALL ON FUNCTION public.refresh_participant_score_cache() FROM PUBLIC, anon, authenticated;

-- Lê a pontuação pronta; refaz o cálculo sob demanda no máximo a cada 5 min (só uma sessão por vez).
CREATE OR REPLACE FUNCTION public.participant_score_ranking(p_handles text[] DEFAULT NULL)
RETURNS TABLE(handle text, comment_count integer, live_count integer, paid_orders integer, cancelled_orders integer, total_spent numeric, avg_ticket numeric, last_participation timestamptz, live_dates text[], score integer, category text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_last timestamptz;
BEGIN
  SELECT max(refreshed_at) INTO v_last FROM public.participant_score_cache;
  IF (v_last IS NULL OR v_last < now() - interval '5 minutes') AND pg_try_advisory_xact_lock(hashtext('participant_score_cache')) THEN
    PERFORM public.refresh_participant_score_cache();
  END IF;
  RETURN QUERY
  SELECT c.handle, c.comment_count, c.live_count, c.paid_orders, c.cancelled_orders, c.total_spent, c.avg_ticket,
         c.last_participation, c.live_dates, c.score, c.category
  FROM public.participant_score_cache c
  WHERE p_handles IS NULL
     OR c.handle = ANY (SELECT DISTINCT lower(regexp_replace(x, '^@', '')) FROM unnest(p_handles) x)
  ORDER BY c.score DESC, c.last_participation DESC NULLS LAST;
END $$;
GRANT EXECUTE ON FUNCTION public.participant_score_ranking(text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.participant_score_ranking_live(text[]) FROM PUBLIC, anon, authenticated;

SELECT public.refresh_participant_score_cache();