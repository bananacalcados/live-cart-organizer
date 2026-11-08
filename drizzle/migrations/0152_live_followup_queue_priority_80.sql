CREATE OR REPLACE FUNCTION public.live_followup_priority(p_type text, p_step integer) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN p_type IN ('A','B','C') OR (p_type='F' AND p_step=0) THEN 0 WHEN p_type='D' THEN least(greatest(p_step+1,1),3) WHEN p_type='F' THEN least(greatest(p_step,1),3) ELSE 4 END
$$;
REVOKE ALL ON FUNCTION public.live_followup_priority(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_priority(text,integer) TO service_role;
DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.live_followup_claim(integer)'::regprocedure) INTO def;
 IF position('ORDER BY scheduled_at,id' IN def)=0 OR position('::integer,40)' IN def)=0 THEN RAISE EXCEPTION 'Unexpected follow-up claim definition'; END IF;
 def:=replace(def,'ORDER BY scheduled_at,id','ORDER BY public.live_followup_priority(type,step),scheduled_at,id');
 def:=replace(def,'::integer,40)','::integer,80)');
 EXECUTE def;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_claim(integer) TO service_role;