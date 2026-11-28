-- Emergency producer rollback only. Do not run unless reverting is required.
-- Keep the fixed D cutover and job scope, so old carts never become eligible.
CREATE OR REPLACE FUNCTION public.live_followup_dirty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE v_key text; BEGIN IF NOT public.live_followup_enabled(NEW.event_id) THEN RETURN NEW; END IF; v_key:=TG_TABLE_NAME||':'||NEW.id; INSERT INTO live_followup_sources(source_key,event_id,order_id,access_id,changed_at) VALUES(v_key,NEW.event_id,CASE WHEN TG_TABLE_NAME='orders' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='live_selfservice_accesses' THEN NEW.id END,clock_timestamp()) ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at;
 IF TG_TABLE_NAME='live_selfservice_accesses' AND cardinality(NEW.order_ids)>0 THEN INSERT INTO live_followup_sources(source_key,event_id,order_id,changed_at) SELECT 'orders:'||x,NEW.event_id,x,clock_timestamp() FROM unnest(NEW.order_ids) x ON CONFLICT(source_key) DO UPDATE SET changed_at=excluded.changed_at; END IF;
 RETURN NEW; EXCEPTION WHEN others THEN RAISE WARNING '[live-followup-dirty] %',SQLERRM; RETURN NEW; END $function$;

REVOKE ALL ON FUNCTION public.live_followup_dirty() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_dirty() TO service_role;
