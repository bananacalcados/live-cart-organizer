-- PREPARED ONLY. Never place this file in the automatic migration directory.
-- First deploy the reviewed scheduler guard, then run this transaction only after
-- Matthews explicitly authorizes it. This changes functions, not existing jobs.
BEGIN;
DO $prepare$
DECLARE
  dirty_def text;
  context_def text;
  old_branch text := 'IF TG_TABLE_NAME=''live_selfservice_accesses'' AND cardinality(NEW.order_ids)>0 THEN INSERT INTO live_followup_sources(source_key,event_id,order_id,changed_at) SELECT ''orders:''||x,NEW.event_id,x,clock_timestamp() FROM unnest(NEW.order_ids) x ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at; END IF;';
  new_branch text := 'IF TG_TABLE_NAME=''live_selfservice_accesses'' THEN IF cardinality(NEW.order_ids)>0 THEN INSERT INTO live_followup_sources(source_key,event_id,order_id,changed_at) SELECT ''orders:''||x,NEW.event_id,x,clock_timestamp() FROM unnest(NEW.order_ids) x ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at; END IF; END IF;';
  marker text := '''ig_instance_id'',ig.whatsapp_number_id)';
  cutover timestamptz := clock_timestamp();
BEGIN
  IF current_setting('app.followup_manual_apply_authorized',true) IS DISTINCT FROM 'yes'
    OR current_setting('app.followup_manual_scheduler_guard_reviewed',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Explicit authorization and deployed scheduler cutover guard required';
  END IF;
  IF current_setting('app.followup_manual_allow_live',true) IS DISTINCT FROM 'yes' AND (
    EXISTS(SELECT 1 FROM public.live_comments WHERE created_at>now()-interval '30 minutes') OR
    EXISTS(SELECT 1 FROM public.orders WHERE event_id IS NOT NULL AND created_at>now()-interval '30 minutes')
  ) THEN RAISE EXCEPTION 'Live activity detected: separate explicit authorization required'; END IF;
  SELECT pg_get_functiondef('public.live_followup_dirty()'::regprocedure) INTO dirty_def;
  SELECT pg_get_functiondef('public.live_followup_source_contexts(integer)'::regprocedure) INTO context_def;
  IF strpos(dirty_def,old_branch)=0 OR strpos(context_def,marker)=0
    OR strpos(context_def,'manual_cart_before_cutover')>0 THEN
    RAISE EXCEPTION 'Unexpected deployed definition or fix already applied; inspect before proceeding';
  END IF;
  -- A nested IF is essential: PostgreSQL resolves NEW.order_ids while preparing
  -- the combined expression, even for an orders row that has no such column.
  EXECUTE replace(dirty_def,old_branch,new_branch);
  -- Keep a fixed deployment boundary in the context. The scheduler ACKs only
  -- NEW scheduling attempts for old manual carts; existing jobs stay untouched.
  EXECUTE replace(context_def,marker,format(
    '''manual_cart_before_cutover'',coalesce(o.origin IS DISTINCT FROM ''catalog'' AND o.selfservice_cart_sent_at IS NULL AND o.live_followup_cart_sent_at < %L::timestamptz,false),%s',cutover,marker));
  RAISE NOTICE 'Manual cart follow-up cutover UTC: %',cutover;
END
$prepare$;
REVOKE ALL ON FUNCTION public.live_followup_dirty() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_dirty() TO service_role;
REVOKE ALL ON FUNCTION public.live_followup_source_contexts(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_source_contexts(integer) TO service_role;
COMMIT;