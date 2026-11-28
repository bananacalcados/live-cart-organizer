-- Apply through the migration tool only; fail closed while a live might be running.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE event_id IS NOT NULL AND created_at > now()-interval '1 hour')
     OR EXISTS (SELECT 1 FROM public.live_comments WHERE created_at > now()-interval '30 minutes') THEN
    RAISE EXCEPTION 'Live activity detected: do not change follow-up priorities now';
  END IF;
END $$;

-- Separate helper: the legacy v1 priority and sender switch remain intact.
CREATE OR REPLACE FUNCTION public.live_followup_priority_v2(p_type text,p_step integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE
    WHEN p_type='D' AND p_step=0 THEN 0
    WHEN p_type IN ('A','B','C') OR (p_type='F' AND p_step=0) THEN 1
    WHEN p_type='F' THEN least(greatest(p_step,1),3)+1
    WHEN p_type='D' AND p_step=1 THEN 6
    WHEN p_type='D' AND p_step>=2 THEN 7
    ELSE 5 END
$$;
REVOKE ALL ON FUNCTION public.live_followup_priority_v2(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_priority_v2(text,integer) TO service_role;

-- Preserve the current checks, variant rotation, hourly/customer caps and sampled pacing verbatim.
DO $migration$
DECLARE def text; old_loop text; new_loop text; marker text;
BEGIN
  SELECT pg_get_functiondef('public.live_followup_claim_one(uuid)'::regprocedure) INTO def;
  old_loop := 'FOR j IN SELECT * FROM live_followup_jobs WHERE status=''pending'' AND scheduled_at<=now() AND whatsapp_number_id=p_number_id ORDER BY public.live_followup_priority(type,step),scheduled_at,id LIMIT 50 FOR UPDATE SKIP LOCKED LOOP';
  new_loop := 'FOR j IN SELECT * FROM live_followup_jobs WHERE status=''pending'' AND scheduled_at<=now() AND whatsapp_number_id=p_number_id ORDER BY public.live_followup_priority_v2(type,step),scheduled_at,id LIMIT 50 FOR UPDATE SKIP LOCKED LOOP';
  IF strpos(def,old_loop)=0 OR strpos(def,'IF j.step>0 AND EXISTS')=0
     OR strpos(def,'status=''processing'',claimed_at=clock_timestamp(),variant=chosen')=0 THEN
    RAISE EXCEPTION 'Unexpected v2 claim definition; inspect before applying';
  END IF;
  marker := $block$
-- NÃO REMOVER: serialize this number before locking jobs; no cross-live routing or extra capacity.
INSERT INTO live_followup_instances(whatsapp_number_id) VALUES(p_number_id) ON CONFLICT DO NOTHING;
PERFORM 1 FROM live_followup_instances WHERE whatsapp_number_id=p_number_id FOR UPDATE;

-- Remember real contention, in bounded batches. Do not rewrite unchanged rows.
WITH waiting AS (
  SELECT lo.id FROM live_followup_jobs lo
  WHERE lo.whatsapp_number_id=p_number_id AND lo.status='pending'
    AND lo.type='D' AND lo.step IN (1,2) AND lo.scheduled_at<=now()
    AND public.live_followup_enabled(lo.event_id)
    AND lo.reason IS DISTINCT FROM 'aguardando_folga'
    AND EXISTS (SELECT 1 FROM live_followup_jobs hi
      WHERE hi.whatsapp_number_id=p_number_id AND hi.status='pending' AND hi.scheduled_at<=now()
        AND public.live_followup_priority_v2(hi.type,hi.step)<public.live_followup_priority_v2(lo.type,lo.step))
  ORDER BY lo.scheduled_at,lo.id LIMIT 50 FOR UPDATE OF lo SKIP LOCKED
) UPDATE live_followup_jobs target SET reason='aguardando_folga' FROM waiting w WHERE target.id=w.id;

-- Expire secondary D even when pacing/hourly cap stops claiming; never expire or resend processing/uncertain here.
WITH expired AS (
  SELECT candidate.id FROM live_followup_jobs candidate WHERE candidate.whatsapp_number_id=p_number_id AND candidate.status='pending'
    AND candidate.type='D' AND candidate.step IN (1,2) AND candidate.scheduled_at<now()-interval '15 minutes'
    AND public.live_followup_enabled(candidate.event_id)
    -- Keep event-disabled cancellation and daily-customer-limit precedence from the original claim.
    AND (SELECT count(*) FROM live_followup_jobs daily WHERE daily.customer_key=candidate.customer_key
      AND daily.claimed_at>=((now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      <coalesce((cfg->'limits'->>'daily_customer')::integer,6)
  ORDER BY candidate.scheduled_at,candidate.id LIMIT 50 FOR UPDATE OF candidate SKIP LOCKED
) UPDATE live_followup_jobs lo SET status='skipped',reason=CASE
    WHEN lo.reason='aguardando_folga' OR (
      SELECT count(*) FROM live_followup_jobs h WHERE h.whatsapp_number_id=p_number_id
        AND h.claimed_at>now()-interval '1 hour'
    )>=coalesce((cfg->'limits'->>'hourly')::integer,80)
    THEN 'sem_folga_no_pico' ELSE 'late_step' END
  FROM expired x WHERE lo.id=x.id;
$block$;
  def:=replace(def,old_loop,marker || E'\n' || new_loop);
  -- SKIP LOCKED must not let a secondary D pass a higher-priority due job locked by another transaction.
  def:=replace(def,'IF j.step>0 AND EXISTS', $guard$
IF j.type='D' AND j.step IN (1,2) AND EXISTS (
  SELECT 1 FROM live_followup_jobs hi WHERE hi.whatsapp_number_id=p_number_id
    AND hi.status='pending' AND hi.scheduled_at<=now()
    AND public.live_followup_priority_v2(hi.type,hi.step)<public.live_followup_priority_v2(j.type,j.step)
) THEN CONTINUE; END IF;
IF j.step>0 AND EXISTS$guard$);
  def:=replace(def,'status=''processing'',claimed_at=clock_timestamp(),variant=chosen',
    'status=''processing'',claimed_at=clock_timestamp(),variant=chosen,reason=CASE WHEN reason=''aguardando_folga'' THEN NULL ELSE reason END');
  EXECUTE def;
END $migration$;
REVOKE ALL ON FUNCTION public.live_followup_claim_one(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_claim_one(uuid) TO service_role;