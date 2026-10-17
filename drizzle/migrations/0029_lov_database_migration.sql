-- lovable-cron-fallback-reviewed: fila de ações de grupo precisa de execução contínua (1/min) para respeitar gaps anti-ban entre ações sem atrasar lotes; usuário ciente do custo de 1440 runs/dia

CREATE TABLE public.group_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  whatsapp_number_id uuid NOT NULL,
  group_db_id uuid REFERENCES public.whatsapp_groups(id) ON DELETE SET NULL,
  group_jid text NOT NULL,
  group_name_snapshot text,
  campaign_id uuid REFERENCES public.group_campaigns(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('rename','set_description','set_photo','set_only_admins_send','set_only_admins_add','pin_message','promote_admin','demote_admin','add_participant','remove_participant')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled','skipped')),
  not_before timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  error_message text,
  result jsonb,
  requested_by text NOT NULL DEFAULT 'user',
  batch text,
  notes text,
  locked_until timestamptz,
  seq int
);

CREATE INDEX idx_group_admin_actions_queue ON public.group_admin_actions (status, whatsapp_number_id, not_before);
CREATE INDEX idx_group_admin_actions_batch ON public.group_admin_actions (batch);
CREATE INDEX idx_group_admin_actions_group ON public.group_admin_actions (group_db_id, created_at desc);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_admin_actions TO authenticated;
GRANT ALL ON public.group_admin_actions TO service_role;

ALTER TABLE public.group_admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access group_admin_actions"
  ON public.group_admin_actions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TABLE public.group_admin_throttle (
  whatsapp_number_id uuid PRIMARY KEY,
  min_gap_seconds int NOT NULL DEFAULT 45,
  max_gap_seconds int NOT NULL DEFAULT 120,
  long_pause_every int NOT NULL DEFAULT 5,
  long_pause_min_seconds int NOT NULL DEFAULT 180,
  long_pause_max_seconds int NOT NULL DEFAULT 360,
  max_per_hour int NOT NULL DEFAULT 20,
  max_per_day int NOT NULL DEFAULT 60,
  window_start time NOT NULL DEFAULT '08:00',
  window_end time NOT NULL DEFAULT '22:00',
  paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  consecutive_failures int NOT NULL DEFAULT 0,
  last_action_at timestamptz,
  actions_since_long_pause int NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_admin_throttle TO authenticated;
GRANT ALL ON public.group_admin_throttle TO service_role;

ALTER TABLE public.group_admin_throttle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access group_admin_throttle"
  ON public.group_admin_throttle FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Claim atômico da próxima ação da instância, respeitando o ritmo (throttle).
CREATE OR REPLACE FUNCTION public.claim_next_group_admin_action(p_number_id uuid)
RETURNS public.group_admin_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.group_admin_throttle;
  a public.group_admin_actions;
  v_gap int;
  v_now_sp time;
  v_hour_count int;
  v_day_count int;
BEGIN
  SELECT * INTO t FROM public.group_admin_throttle WHERE whatsapp_number_id = p_number_id;
  IF NOT FOUND THEN
    INSERT INTO public.group_admin_throttle (whatsapp_number_id) VALUES (p_number_id)
    ON CONFLICT (whatsapp_number_id) DO NOTHING
    RETURNING * INTO t;
    SELECT * INTO t FROM public.group_admin_throttle WHERE whatsapp_number_id = p_number_id;
  END IF;

  IF t.paused THEN RETURN NULL; END IF;

  v_now_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::time;
  IF NOT (v_now_sp >= t.window_start AND v_now_sp <= t.window_end) THEN RETURN NULL; END IF;

  -- gap sorteado (pausa longa a cada N ações)
  IF t.actions_since_long_pause >= t.long_pause_every THEN
    v_gap := t.long_pause_min_seconds + floor(random() * greatest(t.long_pause_max_seconds - t.long_pause_min_seconds, 0))::int;
  ELSE
    v_gap := t.min_gap_seconds + floor(random() * greatest(t.max_gap_seconds - t.min_gap_seconds, 0))::int;
  END IF;
  IF t.last_action_at IS NOT NULL AND t.last_action_at + make_interval(secs => v_gap) > now() THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_hour_count FROM public.group_admin_actions
   WHERE whatsapp_number_id = p_number_id AND status IN ('done','failed')
     AND finished_at > now() - interval '1 hour';
  IF v_hour_count >= t.max_per_hour THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_day_count FROM public.group_admin_actions
   WHERE whatsapp_number_id = p_number_id AND status IN ('done','failed')
     AND (finished_at AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  IF v_day_count >= t.max_per_day THEN RETURN NULL; END IF;

  SELECT * INTO a FROM public.group_admin_actions
   WHERE whatsapp_number_id = p_number_id
     AND status = 'queued'
     AND (not_before IS NULL OR not_before <= now())
   ORDER BY seq NULLS LAST, created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.group_admin_actions
     SET status = 'running', started_at = now(), locked_until = now() + interval '3 minutes',
         attempts = attempts + 1, updated_at = now()
   WHERE id = a.id
   RETURNING * INTO a;

  UPDATE public.group_admin_throttle
     SET last_action_at = now(),
         actions_since_long_pause = CASE WHEN actions_since_long_pause >= long_pause_every THEN 0 ELSE actions_since_long_pause + 1 END
   WHERE whatsapp_number_id = p_number_id;

  RETURN a;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_group_admin_action(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_group_admin_action(uuid) TO authenticated;

-- Worker a cada minuto (mesmo padrão dos demais crons do projeto)
DO $$ BEGIN PERFORM cron.unschedule('group-admin-worker'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'group-admin-worker',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/group-admin-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT value FROM public.internal_function_secrets WHERE key='cron_secret' LIMIT 1)),
    body := '{}'::jsonb
  );
  $$
);
