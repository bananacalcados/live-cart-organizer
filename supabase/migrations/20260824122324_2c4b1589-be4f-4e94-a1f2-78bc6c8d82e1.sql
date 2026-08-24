-- Etapa 2: pacing por contato

CREATE TABLE IF NOT EXISTS public.automation_contact_pacing (
  phone text PRIMARY KEY,
  last_sent_at timestamptz,
  sent_today integer NOT NULL DEFAULT 0,
  sent_7d integer NOT NULL DEFAULT 0,
  day_key date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  week_start date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.automation_contact_pacing TO authenticated;
GRANT ALL ON public.automation_contact_pacing TO service_role;

ALTER TABLE public.automation_contact_pacing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read automation pacing"
  ON public.automation_contact_pacing FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_automation_contact_pacing_updated_at
  BEFORE UPDATE ON public.automation_contact_pacing
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

CREATE INDEX IF NOT EXISTS idx_automation_contact_pacing_last_sent
  ON public.automation_contact_pacing (last_sent_at DESC);

-- colunas de controle na fila
ALTER TABLE public.automation_message_queue
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0;

-- Gate atômico: decide e já reserva a cota quando libera o envio
CREATE OR REPLACE FUNCTION public.automation_pacing_gate(
  p_phone text,
  p_min_gap_seconds integer DEFAULT 45,
  p_daily_cap integer DEFAULT 8,
  p_weekly_cap integer DEFAULT 20
)
RETURNS TABLE (decision text, retry_after_seconds integer, sent_today integer, sent_7d integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_row public.automation_contact_pacing;
  v_wait integer := 0;
BEGIN
  IF p_phone IS NULL OR length(trim(p_phone)) = 0 THEN
    RETURN QUERY SELECT 'allow'::text, 0, 0, 0;
    RETURN;
  END IF;

  INSERT INTO public.automation_contact_pacing (phone, day_key, week_start)
  VALUES (p_phone, v_today, v_today)
  ON CONFLICT (phone) DO NOTHING;

  SELECT * INTO v_row
  FROM public.automation_contact_pacing
  WHERE phone = p_phone
  FOR UPDATE;

  -- reset de janelas
  IF v_row.day_key <> v_today THEN
    v_row.sent_today := 0;
    v_row.day_key := v_today;
  END IF;
  IF v_row.week_start < v_today - 6 THEN
    v_row.sent_7d := 0;
    v_row.week_start := v_today;
  END IF;

  -- tetos duros
  IF p_daily_cap > 0 AND v_row.sent_today >= p_daily_cap THEN
    UPDATE public.automation_contact_pacing
       SET sent_today = v_row.sent_today, day_key = v_row.day_key,
           sent_7d = v_row.sent_7d, week_start = v_row.week_start
     WHERE phone = p_phone;
    RETURN QUERY SELECT 'cap_daily'::text, 0, v_row.sent_today, v_row.sent_7d;
    RETURN;
  END IF;

  IF p_weekly_cap > 0 AND v_row.sent_7d >= p_weekly_cap THEN
    UPDATE public.automation_contact_pacing
       SET sent_today = v_row.sent_today, day_key = v_row.day_key,
           sent_7d = v_row.sent_7d, week_start = v_row.week_start
     WHERE phone = p_phone;
    RETURN QUERY SELECT 'cap_weekly'::text, 0, v_row.sent_today, v_row.sent_7d;
    RETURN;
  END IF;

  -- intervalo mínimo entre mensagens para o mesmo contato
  IF v_row.last_sent_at IS NOT NULL AND p_min_gap_seconds > 0 THEN
    v_wait := p_min_gap_seconds - FLOOR(EXTRACT(EPOCH FROM (now() - v_row.last_sent_at)))::integer;
    IF v_wait > 0 THEN
      UPDATE public.automation_contact_pacing
         SET sent_today = v_row.sent_today, day_key = v_row.day_key,
             sent_7d = v_row.sent_7d, week_start = v_row.week_start
       WHERE phone = p_phone;
      RETURN QUERY SELECT 'wait'::text, v_wait, v_row.sent_today, v_row.sent_7d;
      RETURN;
    END IF;
  END IF;

  UPDATE public.automation_contact_pacing
     SET last_sent_at = now(),
         sent_today = v_row.sent_today + 1,
         sent_7d = v_row.sent_7d + 1,
         day_key = v_row.day_key,
         week_start = v_row.week_start
   WHERE phone = p_phone;

  RETURN QUERY SELECT 'allow'::text, 0, v_row.sent_today + 1, v_row.sent_7d + 1;
END;
$$;

-- Devolve a cota quando o envio falha após a reserva
CREATE OR REPLACE FUNCTION public.automation_pacing_release(p_phone text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.automation_contact_pacing
     SET sent_today = GREATEST(0, sent_today - 1),
         sent_7d = GREATEST(0, sent_7d - 1)
   WHERE phone = p_phone;
$$;

CREATE OR REPLACE FUNCTION public.automation_pacing_reset_stale()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.automation_contact_pacing
    WHERE last_sent_at IS NULL OR last_sent_at < now() - interval '60 days'
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::integer FROM d;
$$;

REVOKE ALL ON FUNCTION public.automation_pacing_gate(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_pacing_release(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_pacing_reset_stale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.automation_pacing_gate(text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_pacing_release(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_pacing_reset_stale() TO service_role;