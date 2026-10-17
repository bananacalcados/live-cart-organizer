-- Run with the managed database query tool. This never calls a provider.
-- All fixtures and state changes are rolled back before the worker sees them.
BEGIN;
DO $$
DECLARE
  wid uuid := 'fb7dd381-6460-4f28-8d01-f15943edb879';
  gid uuid := 'ff68a22e-09c7-4e84-bd86-2d644c7392af';
  cid uuid := 'e403d0f3-2105-4cdd-a621-26ac2d17dc48';
  older uuid; newer uuid; a public.group_admin_actions;
  delay timestamptz; h bigint; d bigint;
BEGIN
  PERFORM 1 FROM public.group_admin_throttle WHERE whatsapp_number_id=wid FOR UPDATE;
  UPDATE public.group_admin_actions SET not_before=now()+interval '1 day' WHERE whatsapp_number_id=wid AND status='queued';
  UPDATE public.group_admin_throttle SET paused=false,window_start='00:00',window_end='23:59:59',next_allowed_at=NULL,min_gap_seconds=60,max_gap_seconds=60,max_per_hour=200,max_per_day=200,actions_since_long_pause=0 WHERE whatsapp_number_id=wid;
  INSERT INTO public.group_admin_actions(whatsapp_number_id,group_db_id,group_jid,campaign_id,action_type,payload,created_at,seq)
  VALUES(wid,gid,'120363026089410146@g.us',cid,'set_description','{}',now()-interval '1 hour',NULL) RETURNING id INTO older;
  INSERT INTO public.group_admin_actions(whatsapp_number_id,group_db_id,group_jid,campaign_id,action_type,payload,seq)
  VALUES(wid,gid,'120363026089410146@g.us',cid,'set_description','{}',1) RETURNING id INTO newer;
  a:=public.claim_next_group_admin_action(wid);
  IF a.id IS DISTINCT FROM older THEN RAISE EXCEPTION 'Oldest action must win over seq=1'; END IF;
  SELECT next_allowed_at INTO delay FROM public.group_admin_throttle WHERE whatsapp_number_id=wid;
  IF delay-a.started_at<>interval '60 seconds' THEN RAISE EXCEPTION 'Fixed sampled delay not saved'; END IF;
  a:=public.claim_next_group_admin_action(wid);
  IF a.id IS NOT NULL THEN RAISE EXCEPTION 'Second claim bypassed throttle'; END IF;
  IF (SELECT next_allowed_at FROM public.group_admin_throttle WHERE whatsapp_number_id=wid) IS DISTINCT FROM delay THEN RAISE EXCEPTION 'Repeated claim resampled delay'; END IF;
  PERFORM public.finish_group_admin_action(older,'retry','temporary',NULL,true);
  SELECT hour_count,day_count INTO h,d FROM public.group_admin_attempt_counts(wid);
  IF h<1 OR d<1 THEN RAISE EXCEPTION 'Retry missing from counts'; END IF;
  UPDATE public.group_admin_throttle SET next_allowed_at=NULL,consecutive_failures=2 WHERE whatsapp_number_id=wid;
  UPDATE public.group_admin_actions SET not_before=NULL WHERE id=older;
  a:=public.claim_next_group_admin_action(wid);
  PERFORM public.finish_group_admin_action(older,'failed','Permission denied',NULL,false);
  IF (SELECT consecutive_failures FROM public.group_admin_throttle WHERE whatsapp_number_id=wid)<>2 THEN RAISE EXCEPTION 'Permission error changed instance failure count'; END IF;
  IF (SELECT cardinality(attempt_history) FROM public.group_admin_actions WHERE id=older)<>2 THEN RAISE EXCEPTION 'Attempts not preserved'; END IF;
  UPDATE public.group_admin_throttle SET max_per_hour=2,next_allowed_at=NULL WHERE whatsapp_number_id=wid;
  a:=public.claim_next_group_admin_action(wid);
  IF a.id IS NOT NULL THEN RAISE EXCEPTION 'Retry attempts bypassed hourly cap'; END IF;
  UPDATE public.group_admin_throttle SET max_per_hour=200,max_per_day=2 WHERE whatsapp_number_id=wid;
  a:=public.claim_next_group_admin_action(wid);
  IF a.id IS NOT NULL THEN RAISE EXCEPTION 'Retry attempts bypassed daily cap'; END IF;
  UPDATE public.whatsapp_numbers SET is_active=false WHERE id=wid;
  PERFORM public.claim_next_group_admin_action(wid);
  IF (SELECT status FROM public.group_admin_actions WHERE id=newer)<>'skipped' THEN RAISE EXCEPTION 'Inactive action not skipped'; END IF;
  IF (SELECT error_message FROM public.group_admin_actions WHERE id=newer)<>'Instância inativa' THEN RAISE EXCEPTION 'Inactive reason missing'; END IF;
END $$;
ROLLBACK;