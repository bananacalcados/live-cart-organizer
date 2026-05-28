-- Marca um evento como "Live em curso agora". Apenas 1 evento pode estar
-- ativo por vez. Expira automaticamente 8h após a ativação.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS live_active_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_events_live_active_until
  ON public.events (live_active_until)
  WHERE live_active_until IS NOT NULL;

-- Liga a Live em um evento (desligando qualquer outro). Expira em 8h.
CREATE OR REPLACE FUNCTION public.set_event_live_active(p_event_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz := now() + interval '8 hours';
BEGIN
  UPDATE public.events
    SET live_active_until = NULL
    WHERE live_active_until IS NOT NULL
      AND id <> p_event_id;

  UPDATE public.events
    SET live_active_until = v_until
    WHERE id = p_event_id;

  RETURN v_until;
END;
$$;

-- Desliga manualmente.
CREATE OR REPLACE FUNCTION public.clear_event_live_active(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.events
    SET live_active_until = NULL
    WHERE id = p_event_id;
$$;

GRANT EXECUTE ON FUNCTION public.set_event_live_active(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_event_live_active(uuid) TO authenticated, service_role;