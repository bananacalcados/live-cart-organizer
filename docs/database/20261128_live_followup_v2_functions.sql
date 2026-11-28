-- Cópia das funções v2 (migrações 0327/0328) para o teste em banco descartável.
CREATE OR REPLACE FUNCTION public.live_followup_claim_one(p_number_id uuid)
 RETURNS SETOF live_followup_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j live_followup_jobs; cfg jsonb; pacing live_followup_instances; v_hour integer; v_day integer; v_min integer; v_max integer; chosen integer; used integer[];
BEGIN
-- v2 (28/11/2026): reserva UMA mensagem da instancia pedida; 'uncertain' nao segura a instancia (fica para conferencia).
-- NAO REMOVER (25/11/2026): envio preso em 'processing'/'uncertain' travava a fila inteira do numero (21/11 a 25/11).
UPDATE live_followup_jobs SET status='skipped', reason='processing_expirado' WHERE status='processing' AND claimed_at < now() - interval '10 minutes';
UPDATE live_followup_jobs SET status='skipped', reason='uncertain_expirado' WHERE status='uncertain' AND coalesce(claimed_at, created_at) < now() - interval '60 minutes';
UPDATE live_followup_jobs SET reason='toque_expirado' WHERE type='F' AND step=0 AND status='sent' AND reason='aguardando_toque' AND button_expires_at<=now(); SELECT value INTO cfg FROM live_followup_settings WHERE id; IF NOT coalesce((cfg->>'enabled')::boolean,false) THEN UPDATE live_followup_jobs SET status='cancelled',reason='global_disabled' WHERE status='pending'; RETURN; END IF;
FOR j IN SELECT * FROM live_followup_jobs WHERE status='pending' AND scheduled_at<=now() AND whatsapp_number_id=p_number_id ORDER BY public.live_followup_priority(type,step),scheduled_at,id LIMIT 50 FOR UPDATE SKIP LOCKED LOOP
IF NOT public.live_followup_enabled(j.event_id) THEN UPDATE live_followup_jobs SET status='cancelled',reason='event_disabled' WHERE id=j.id; CONTINUE; END IF;
INSERT INTO live_followup_instances(whatsapp_number_id) VALUES(j.whatsapp_number_id) ON CONFLICT DO NOTHING;
SELECT * INTO pacing FROM live_followup_instances WHERE whatsapp_number_id=j.whatsapp_number_id FOR UPDATE;
IF pacing.paused OR pacing.next_send_at>now() THEN RETURN; END IF;
IF EXISTS(SELECT 1 FROM live_followup_jobs WHERE whatsapp_number_id=j.whatsapp_number_id AND status='processing') THEN RETURN; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(j.customer_key,72819));
SELECT count(*) INTO v_hour FROM live_followup_jobs WHERE whatsapp_number_id=j.whatsapp_number_id AND claimed_at>now()-interval '1 hour'; IF v_hour>=coalesce((cfg->'limits'->>'hourly')::integer,80) THEN RETURN; END IF;
SELECT count(*) INTO v_day FROM live_followup_jobs WHERE customer_key=j.customer_key AND claimed_at>=((now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo'); IF v_day>=coalesce((cfg->'limits'->>'daily_customer')::integer,6) THEN UPDATE live_followup_jobs SET status='skipped',reason='customer_daily_limit' WHERE id=j.id; CONTINUE; END IF;
IF j.type='D' AND now()>j.scheduled_at+interval '15 minutes' THEN UPDATE live_followup_jobs SET status='skipped',reason='late_step' WHERE id=j.id; CONTINUE; END IF;
IF j.step>0 AND EXISTS(SELECT 1 FROM live_followup_jobs WHERE sequence_key=j.sequence_key AND step<j.step AND status IN ('pending','processing','uncertain')) THEN CONTINUE; END IF;
SELECT array_agg(variant) INTO used FROM live_followup_jobs WHERE customer_key=j.customer_key AND type=j.type AND step=j.step AND variant IS NOT NULL AND status IN ('sent','processing','uncertain'); SELECT x INTO chosen FROM generate_series(0,2) x WHERE NOT x=ANY(coalesce(used,'{}'::integer[])) ORDER BY random() LIMIT 1;
IF chosen IS NULL THEN UPDATE live_followup_jobs SET status='skipped',reason='variations_exhausted' WHERE id=j.id; CONTINUE; END IF;
v_min:=coalesce((cfg->'limits'->>'interval_min')::integer,20);v_max:=coalesce((cfg->'limits'->>'interval_max')::integer,60);
UPDATE live_followup_instances SET next_send_at=clock_timestamp()+make_interval(secs=>v_min+floor(random()*(v_max-v_min+1))::integer) WHERE whatsapp_number_id=j.whatsapp_number_id;
UPDATE live_followup_jobs SET status='processing',claimed_at=clock_timestamp(),variant=chosen WHERE id=j.id RETURNING * INTO j; RETURN NEXT j; RETURN;
END LOOP; END $function$;

CREATE OR REPLACE FUNCTION public.live_followup_failure_v2(p_job_id uuid, p_reason text, p_uncertain boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE j live_followup_jobs;
BEGIN
  -- v2 (28/11/2026): incerto vira 'uncertain' (conferência manual, nunca reenvia) mas NÃO pausa a instância;
  -- pausa só por 3 erros seguidos ou bloqueio/desconexão do provedor, como no v1.
  SELECT * INTO j FROM live_followup_jobs WHERE id=p_job_id AND status='processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE live_followup_jobs SET status=CASE WHEN p_uncertain THEN 'uncertain' ELSE 'skipped' END,reason=left(p_reason,200) WHERE id=j.id;
  UPDATE live_followup_instances SET consecutive_errors=consecutive_errors+1,
    paused=paused OR consecutive_errors+1>=3 OR p_reason ~ '(disconnected|restrict|provider_429|provider_403)',
    reason=left(p_reason,200)
  WHERE whatsapp_number_id=j.whatsapp_number_id;
END $function$;
