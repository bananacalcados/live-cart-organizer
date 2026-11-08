DO $$ DECLARE def text; BEGIN SELECT pg_get_functiondef('public.live_followup_simulate()'::regprocedure) INTO def; def:=replace(def,'UPDATE live_followup_settings SET value=jsonb_set(cfg,''{enabled}'',''true'');','UPDATE live_followup_settings SET value=jsonb_set(cfg,''{enabled}'',''true'') WHERE id=true;'); def:=replace(def,'FROM generate_series(1,39) x','FROM generate_series(1,39) AS gs(idx)');def:=replace(def,'''history-''||x','''history-''||idx'); EXECUTE def;
 SELECT pg_get_functiondef('public.live_followup_job_context(uuid)'::regprocedure) INTO def;
 def:=replace(def,'''cart_sent_at'',coalesce(q.sent_at,o.live_followup_cart_sent_at)', '''initial_sent_at'',(SELECT sent_at FROM live_followup_jobs WHERE sequence_key=j.sequence_key AND step=0 AND status=''sent'' LIMIT 1),''cart_sent_at'',coalesce(q.sent_at,o.live_followup_cart_sent_at)'); EXECUTE def;
END $$;
CREATE OR REPLACE FUNCTION public.live_followup_settings_validate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF (NEW.value->>'enabled')::boolean AND NOT coalesce((OLD.value->>'enabled')::boolean,false) AND EXISTS(SELECT 1 FROM event_followup_dispatches WHERE status IN ('processing','locked')) THEN RAISE EXCEPTION 'Legacy followup is sending'; END IF;
 RETURN NEW;END $$;
REVOKE ALL ON FUNCTION public.live_followup_settings_validate() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_settings_validate() TO service_role;
CREATE TRIGGER live_followup_settings_validate BEFORE UPDATE ON public.live_followup_settings FOR EACH ROW WHEN (OLD.value IS DISTINCT FROM NEW.value) EXECUTE FUNCTION public.live_followup_settings_validate();