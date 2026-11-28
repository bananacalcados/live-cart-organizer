DO $fix$
DECLARE
  dirty_def text;
  source_def text;
  job_def text;
  old_branch text := 'IF TG_TABLE_NAME=''live_selfservice_accesses'' AND cardinality(NEW.order_ids)>0 THEN INSERT INTO live_followup_sources(source_key,event_id,order_id,changed_at) SELECT ''orders:''||x,NEW.event_id,x,clock_timestamp() FROM unnest(NEW.order_ids) x ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at; END IF;';
  new_branch text := 'IF TG_TABLE_NAME=''live_selfservice_accesses'' THEN IF cardinality(NEW.order_ids)>0 THEN INSERT INTO live_followup_sources(source_key,event_id,order_id,changed_at) SELECT ''orders:''||x,NEW.event_id,x,clock_timestamp() FROM unnest(NEW.order_ids) x ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at; END IF; END IF;';
  marker text := '''ig_instance_id'',ig.whatsapp_number_id)';
  linked_marker text := 'linked.id=ANY(a.order_ids) AND (';
  cutover timestamptz := clock_timestamp();
BEGIN
  SELECT pg_get_functiondef('public.live_followup_dirty()'::regprocedure) INTO dirty_def;
  SELECT pg_get_functiondef('public.live_followup_source_contexts(integer)'::regprocedure) INTO source_def;
  SELECT pg_get_functiondef('public.live_followup_job_context(uuid)'::regprocedure) INTO job_def;
  IF strpos(dirty_def,old_branch)=0 OR strpos(source_def,marker)=0
    OR strpos(source_def,'cart_followup_cutover_at')>0 OR strpos(job_def,linked_marker)=0 THEN
    RAISE EXCEPTION 'Unexpected deployed definitions or fix already applied; inspect first';
  END IF;
  EXECUTE replace(source_def,marker,format('''cart_followup_cutover_at'',%L::text,%s',cutover,marker));
  EXECUTE replace(dirty_def,old_branch,new_branch);
  EXECUTE replace(job_def,linked_marker,'linked.id=ANY(a.order_ids) AND (j.order_id IS NULL OR linked.id=j.order_id) AND (');
  EXECUTE format('COMMENT ON FUNCTION public.live_followup_source_contexts(integer) IS %L','D cart-link cutover UTC: '||cutover::text||'; manual/catalog fix authorized 2026-11-28');
  RAISE NOTICE 'D cart-link cutover UTC: %',cutover;
END
$fix$;
REVOKE ALL ON FUNCTION public.live_followup_dirty() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_dirty() TO service_role;
REVOKE ALL ON FUNCTION public.live_followup_source_contexts(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_source_contexts(integer) TO service_role;
REVOKE ALL ON FUNCTION public.live_followup_job_context(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_job_context(uuid) TO service_role;