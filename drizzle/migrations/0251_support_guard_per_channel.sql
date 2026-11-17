ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS alert_phone text,
  ADD COLUMN IF NOT EXISTS alert_whatsapp_number_id uuid,
  ADD COLUMN IF NOT EXISTS alert_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_state text,
  ADD COLUMN IF NOT EXISTS shadow_auto boolean NOT NULL DEFAULT false;

-- Mudança de modo sem marcar shadow_auto = decisão manual.
CREATE OR REPLACE FUNCTION public.support_settings_mode_origin()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.auto_reply_mode IS DISTINCT FROM OLD.auto_reply_mode AND NEW.shadow_auto IS NOT DISTINCT FROM OLD.shadow_auto THEN
    NEW.shadow_auto := false;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.support_settings_mode_origin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_support_settings_mode_origin ON public.support_settings;
CREATE TRIGGER trg_support_settings_mode_origin BEFORE UPDATE OF auto_reply_mode ON public.support_settings
  FOR EACH ROW WHEN (OLD.auto_reply_mode IS DISTINCT FROM NEW.auto_reply_mode) EXECUTE FUNCTION public.support_settings_mode_origin();

CREATE TABLE IF NOT EXISTS public.support_channel_pauses (
  whatsapp_number_id uuid PRIMARY KEY,
  paused_at timestamptz NOT NULL DEFAULT now(),
  paused_until timestamptz NOT NULL,
  reason text NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_channel_pauses TO authenticated;
GRANT ALL ON public.support_channel_pauses TO service_role;
ALTER TABLE public.support_channel_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe lê pausas do suporte" ON public.support_channel_pauses FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_support_outbox_failed_instance ON public.support_outbox (whatsapp_number_id, created_at) WHERE status='failed';

-- Trava geral automática (NF/Correios/histórico/duas instâncias): marca shadow_auto.
CREATE OR REPLACE FUNCTION public.support_emergency_pause(p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.support_settings SET auto_reply_mode='shadow', shadow_auto=true,
    shadow_reason=left(coalesce(nullif(p_reason,''),'erro_envio_nf_ou_correios'),500), shadow_at=now(), updated_at=now()
  WHERE auto_reply_mode IS DISTINCT FROM 'shadow';
END $function$;
REVOKE ALL ON FUNCTION public.support_emergency_pause(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_emergency_pause(text) TO service_role;

-- Falha de envio: isola por canal/instância.
CREATE OR REPLACE FUNCTION public.support_outbox_failure_pause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE n int; probation boolean; active int;
BEGIN
  IF NEW.requested_by NOT IN ('assistant_auto','central_auto') THEN RETURN NEW; END IF;
  -- Janela de 24h / instância inativa são bloqueios esperados, não falha do canal.
  IF coalesce(NEW.error,'') LIKE 'Fora da janela%' OR coalesce(NEW.error,'') LIKE 'Instância inativa%' THEN RETURN NEW; END IF;
  PERFORM public._support_move_to_support_line(NEW.phone, NEW.whatsapp_number_id, NULL);
  SELECT count(*) INTO n FROM public.support_outbox
   WHERE whatsapp_number_id=NEW.whatsapp_number_id AND status='failed' AND requested_by IN ('assistant_auto','central_auto')
     AND created_at>=now()-interval '15 minutes'
     AND coalesce(error,'') NOT LIKE 'Fora da janela%' AND coalesce(error,'') NOT LIKE 'Instância inativa%';
  SELECT EXISTS(SELECT 1 FROM public.support_channel_pauses WHERE whatsapp_number_id=NEW.whatsapp_number_id
     AND paused_until<=now() AND paused_until>now()-interval '30 minutes') INTO probation;
  IF n>=3 OR probation THEN
    INSERT INTO public.support_channel_pauses(whatsapp_number_id,paused_at,paused_until,reason,failures,updated_at)
    VALUES (NEW.whatsapp_number_id, now(), now()+interval '15 minutes',
      left(CASE WHEN probation AND n<3 THEN 'Falhou de novo no teste após a pausa: ' ELSE format('%s falhas de envio em 15 min: ', n) END||coalesce(NEW.error,'erro desconhecido'),500), n, now())
    ON CONFLICT (whatsapp_number_id) DO UPDATE SET paused_at=now(), paused_until=EXCLUDED.paused_until, reason=EXCLUDED.reason, failures=EXCLUDED.failures, updated_at=now();
    SELECT count(*) INTO active FROM public.support_channel_pauses WHERE paused_until>now();
    IF active>=2 THEN
      PERFORM public.support_emergency_pause(format('%s canais pausados ao mesmo tempo por falhas de envio', active));
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.support_outbox_failure_pause() FROM PUBLIC, anon, authenticated;

-- Triagem >50%: mesma regra, agora marcada como automática para permitir a volta sozinha.
CREATE OR REPLACE FUNCTION public.support_ai_failure_watchdog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE tot int; bad int; since timestamptz;
BEGIN
  IF NEW.kind<>'triagem' THEN RETURN NEW; END IF;
  SELECT greatest(now()-interval '30 minutes', coalesce(auto_resumed_at,'epoch'::timestamptz)) INTO since FROM public.support_settings WHERE auto_reply_mode='auto';
  IF since IS NULL THEN RETURN NEW; END IF;
  WITH s AS (
    SELECT suggestion_id, bool_or(ok) AS any_ok, max(attempt) AS max_att, min(created_at) AS first_at
    FROM public.support_ai_attempts WHERE kind='triagem' AND created_at>since GROUP BY suggestion_id)
  SELECT count(*) FILTER (WHERE any_ok OR max_att>=2 OR first_at<now()-interval '1 minute'),
         count(*) FILTER (WHERE NOT any_ok AND (max_att>=2 OR first_at<now()-interval '1 minute'))
    INTO tot, bad FROM s;
  IF tot>=4 AND bad*2>tot THEN
    UPDATE public.support_settings SET auto_reply_mode='shadow', shadow_auto=true, shadow_at=now(),
      shadow_reason=left(format('Triagem da IA com %s de %s falhas em 30 min (>50%%)',bad,tot),500),
      ai_pause_reason=left(format('IA do suporte com %s de %s triagens falhando em 30 min (>50%%). Voltou para sombra automaticamente.',bad,tot),500),
      ai_pause_until=NULL, updated_at=now()
    WHERE auto_reply_mode='auto';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.support_ai_failure_watchdog() FROM PUBLIC, anon, authenticated;

-- Claim: Central sai mesmo em sombra; canal pausado espera (no máximo 15 min).
CREATE OR REPLACE FUNCTION public.support_outbox_claim(p_limit integer DEFAULT 30)
RETURNS SETOF support_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_left integer; r public.support_outbox%ROWTYPE; n record; c record; v_auto boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT auto_reply_mode='auto' INTO v_auto FROM public.support_settings WHERE id=true;
  PERFORM pg_advisory_xact_lock(81726351);
  SELECT 30-count(*) INTO v_left FROM public.support_outbox WHERE status='sent' AND sent_at>=now()-interval '1 hour';
  IF v_left<=0 THEN RETURN; END IF;
  FOR r IN SELECT o.* FROM public.support_outbox o
    WHERE o.status='pending' AND o.claimed_at IS NULL AND o.available_at<=now()
      AND (coalesce(v_auto,false) OR o.requested_by='central_auto')
      AND NOT EXISTS (SELECT 1 FROM public.support_channel_pauses p WHERE p.whatsapp_number_id=o.whatsapp_number_id AND p.paused_until>now())
      AND o.whatsapp_number_id IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','ae453235-50e1-4ef6-8a87-8c8a77b2b440','1f715932-e118-4e88-8051-85a5c14f5a4b','c01d2777-df4c-4746-9433-d8c97c57d529','531883b0-b8bc-48b9-a094-edb04a7a0478')
    ORDER BY o.available_at,o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT least(greatest(coalesce(p_limit,30),1),30,v_left)
  LOOP
    SELECT provider INTO n FROM public.whatsapp_numbers WHERE id=r.whatsapp_number_id AND is_active;
    IF NOT FOUND THEN
      UPDATE public.support_outbox SET status='failed',error='Instância inativa ou não permitida' WHERE id=r.id;
    ELSIF n.provider IN ('meta','instagram') AND NOT EXISTS(
      SELECT 1 FROM public.whatsapp_messages m
      WHERE m.phone=r.phone AND m.whatsapp_number_id=r.whatsapp_number_id AND m.direction='incoming' AND m.created_at>=now()-interval '24 hours'
        AND (n.provider<>'instagram' OR (
          m.channel='instagram' AND coalesce(m.message,'') NOT LIKE '💬 Comentário%'
          AND NOT EXISTS(SELECT 1 FROM public.live_comments lc WHERE lc.comment_id=m.message_id)
          AND NOT EXISTS(SELECT 1 FROM public.ig_comment_moderation cm WHERE cm.comment_id=m.message_id)
        ))
    ) THEN
      UPDATE public.support_outbox SET status='failed',error='Fora da janela de 24 horas da Meta: é necessária uma mensagem recente da cliente' WHERE id=r.id;
    ELSE
      IF r.suggestion_id IS NOT NULL THEN
        SELECT * INTO c FROM public.whatsapp_conversations
        WHERE phone=r.phone AND whatsapp_number_id=r.whatsapp_number_id
          AND channel=CASE WHEN n.provider='instagram' THEN 'instagram' ELSE 'whatsapp' END AND NOT is_group LIMIT 1;
        IF (n.provider<>'instagram' AND NOT FOUND) OR (FOUND AND coalesce(c.last_incoming_at,'epoch'::timestamptz)<=coalesce(c.nm_last_outgoing_at,c.last_outgoing_at,'epoch'::timestamptz)) THEN
          UPDATE public.support_outbox SET status='cancelled',error='Cliente já recebeu resposta antes do envio automático' WHERE id=r.id;
          UPDATE public.support_auto_suggestions SET status='ignorada',reason='respondida_antes_do_envio' WHERE id=r.suggestion_id AND status='nova';
          CONTINUE;
        END IF;
      END IF;
      UPDATE public.support_outbox SET claimed_at=now(),error=NULL WHERE id=r.id RETURNING * INTO r;
      RETURN NEXT r;
    END IF;
  END LOOP;
END $function$;
REVOKE ALL ON FUNCTION public.support_outbox_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_outbox_claim(integer) TO service_role;

-- Estado para o aviso fixo (equipe) e para a rotina de saúde (servidor).
CREATE OR REPLACE FUNCTION public.support_guard_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; tri record; paused jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_team_member(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM public.support_settings WHERE id=true;
  WITH x AS (SELECT suggestion_id, bool_or(ok) any_ok FROM public.support_ai_attempts
             WHERE kind='triagem' AND created_at>now()-interval '15 minutes' AND created_at<now()-interval '1 minute' GROUP BY suggestion_id)
  SELECT count(*)::int tot, count(*) FILTER (WHERE NOT any_ok)::int bad INTO tri FROM x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.whatsapp_number_id,'name',coalesce(w.label,w.phone_display,p.whatsapp_number_id::text),
      'provider',w.provider,'until',p.paused_until,'reason',p.reason) ORDER BY p.paused_until),'[]'::jsonb) INTO paused
    FROM public.support_channel_pauses p LEFT JOIN public.whatsapp_numbers w ON w.id=p.whatsapp_number_id WHERE p.paused_until>now();
  RETURN jsonb_build_object('mode',s.auto_reply_mode,'shadow_auto',s.shadow_auto,'shadow_reason',s.shadow_reason,'shadow_at',s.shadow_at,
    'paused',paused,'triage_total',tri.tot,'triage_failed',tri.bad,
    'alert_configured',(nullif(s.alert_phone,'') IS NOT NULL AND s.alert_whatsapp_number_id IS NOT NULL),
    'alert_state',s.alert_state,'alert_last_sent_at',s.alert_last_sent_at)
    || CASE WHEN auth.role()='service_role' THEN jsonb_build_object('alert_phone',s.alert_phone,'alert_whatsapp_number_id',s.alert_whatsapp_number_id) ELSE '{}'::jsonb END;
END $function$;
REVOKE ALL ON FUNCTION public.support_guard_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_guard_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.support_guard_recover(p_expected_shadow_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.support_settings SET auto_reply_mode='auto', shadow_auto=false, auto_resumed_at=now(), updated_at=now()
   WHERE id=true AND auto_reply_mode='shadow' AND shadow_auto AND shadow_at IS NOT DISTINCT FROM p_expected_shadow_at;
  RETURN FOUND;
END $function$;
REVOKE ALL ON FUNCTION public.support_guard_recover(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_guard_recover(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.support_guard_mark_alert(p_state text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.support_settings SET alert_state=p_state, alert_last_sent_at=now() WHERE id=true;
END $function$;
REVOKE ALL ON FUNCTION public.support_guard_mark_alert(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_guard_mark_alert(text) TO service_role;