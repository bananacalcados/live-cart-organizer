ALTER TABLE public.live_followup_jobs
  ADD COLUMN IF NOT EXISTS original_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS postponed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS postponed_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS postponed_reason text;

CREATE OR REPLACE FUNCTION public.live_followup_postpone(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j live_followup_jobs; v_ig text; v_in timestamptz; v_manual timestamptz; v_target timestamptz; v_why text; v_orig timestamptz; v_shift interval;
BEGIN
  SELECT * INTO j FROM live_followup_jobs WHERE id=p_job_id AND status='processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('action','lost'); END IF;
  SELECT l.ig_user_id INTO v_ig FROM instagram_user_links l WHERE lower(l.username)=j.instagram LIMIT 1;
  SELECT max(m.created_at) INTO v_in FROM whatsapp_messages m
   WHERE m.phone=ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,v_ig)) AND m.whatsapp_number_id=j.whatsapp_number_id
     AND m.direction='incoming' AND m.created_at>now()-interval '24 hours' AND coalesce(m.source,'')<>'ig_interaction'
     AND (j.channel<>'instagram' OR (coalesce(m.message,'') NOT LIKE '💬 Comentário%' AND NOT EXISTS(SELECT 1 FROM live_comments lc WHERE lc.comment_id=m.message_id)));
  SELECT max(m.created_at) INTO v_manual FROM whatsapp_messages m
   WHERE m.phone=ANY(public.live_followup_contact_aliases(j.phone,j.whatsapp_number_id,v_ig)) AND m.whatsapp_number_id=j.whatsapp_number_id
     AND m.direction='outgoing' AND m.sender_user_id IS NOT NULL AND m.created_at>now()-interval '24 hours';
  IF v_in IS NOT NULL AND (v_manual IS NULL OR v_in>v_manual) AND v_in>now()-interval '15 minutes' THEN
    v_target:=greatest(v_in+interval '15 minutes',now()+interval '5 minutes'); v_why:='customer_waiting';
  ELSIF v_in IS NOT NULL AND (v_manual IS NULL OR v_in>v_manual) THEN
    v_target:=now()+interval '5 minutes'; v_why:='customer_waiting';
  ELSIF v_manual>now()-interval '15 minutes' THEN
    v_target:=v_manual+interval '15 minutes'; v_why:='manual_recent';
  ELSIF v_in>now()-interval '15 minutes' THEN
    v_target:=v_in+interval '15 minutes'; v_why:='customer_recent';
  ELSE RETURN jsonb_build_object('action','send'); END IF;

  v_orig:=coalesce(j.original_scheduled_at,j.scheduled_at);
  IF v_target>v_orig+interval '3 hours' THEN
    UPDATE live_followup_jobs SET status='cancelled',reason='human_attendance',postponed_reason=v_why
     WHERE customer_key=j.customer_key AND event_id=j.event_id AND status IN ('pending','processing')
       AND (CASE WHEN j.order_id IS NOT NULL THEN order_id=j.order_id ELSE sequence_key=j.sequence_key END);
    RETURN jsonb_build_object('action','cancelled','reason','human_attendance');
  END IF;
  v_shift:=v_target-j.scheduled_at;
  UPDATE live_followup_jobs SET status='pending',claimed_at=NULL,variant=NULL,original_scheduled_at=v_orig,scheduled_at=v_target,
    postponed_count=postponed_count+1,postponed_minutes=ceil(extract(epoch FROM v_target-v_orig)/60)::integer,postponed_reason=v_why,reason='postponed_human'
   WHERE id=j.id;
  IF v_shift>interval '0' THEN
    UPDATE live_followup_jobs SET original_scheduled_at=coalesce(original_scheduled_at,scheduled_at),scheduled_at=scheduled_at+v_shift
     WHERE sequence_key=j.sequence_key AND step>j.step AND status='pending';
  END IF;
  RETURN jsonb_build_object('action','postponed','until',v_target,'why',v_why);
END $$;
REVOKE ALL ON FUNCTION public.live_followup_postpone(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_postpone(uuid) TO service_role;