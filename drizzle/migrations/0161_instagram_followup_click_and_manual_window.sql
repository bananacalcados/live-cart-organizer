ALTER TABLE public.live_followup_jobs ADD COLUMN button_clicked_at timestamptz, ADD COLUMN button_expires_at timestamptz;
CREATE TABLE public.instagram_account_capabilities (whatsapp_number_id uuid PRIMARY KEY REFERENCES public.whatsapp_numbers(id), human_agent_approved boolean NOT NULL DEFAULT false, checked_at timestamptz NOT NULL DEFAULT now(), evidence text NOT NULL DEFAULT 'unverified');
GRANT ALL ON public.instagram_account_capabilities TO service_role;
ALTER TABLE public.instagram_account_capabilities ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.instagram_reply_context(text,uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,$s$m.created_at>now()-interval '24 hours'$s$, $s$m.created_at>now()-interval '7 days'$s$);
 def:=replace(def,$s$'window_open',inbound IS NOT NULL$s$, $s$'human_agent_approved',coalesce((SELECT human_agent_approved FROM instagram_account_capabilities WHERE whatsapp_number_id=nid),false),'manual_until',inbound+interval '7 days','window_open',coalesce(inbound>now()-interval '24 hours',false)$s$);
 EXECUTE def;
 SELECT pg_get_functiondef('public.live_followup_job_context(uuid)'::regprocedure) INTO def;
 def:=replace(def,$s$m.created_at>j.base_at AND (j.channel<>'instagram'$s$, $s$m.created_at>j.base_at AND coalesce(m.source,'')<>'ig_interaction' AND (j.channel<>'instagram'$s$);
 EXECUTE def;
END $$;
CREATE OR REPLACE FUNCTION public.live_followup_button_claim(p_job_id uuid,p_sender_id text,p_number_id uuid,p_clicked_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j live_followup_jobs; v_id uuid; ctx jsonb; expected text;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO j FROM live_followup_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.type<>'F' OR j.step<>0 OR j.status<>'sent' OR j.reason<>'aguardando_toque' OR j.button_clicked_at IS NOT NULL OR j.button_expires_at IS NULL OR j.button_expires_at<=now() OR j.whatsapp_number_id IS DISTINCT FROM p_number_id OR p_clicked_at>now()+interval '1 minute' OR p_clicked_at<j.sent_at-interval '1 minute' THEN RETURN NULL; END IF;
 SELECT ig_user_id INTO expected FROM instagram_user_links WHERE lower(username)=j.instagram LIMIT 1;
 IF expected IS DISTINCT FROM p_sender_id OR NOT live_followup_enabled(j.event_id) THEN RETURN NULL; END IF;
 ctx:=live_followup_job_context(j.id);
 IF coalesce((ctx->>'customer_replied')::boolean,false) OR coalesce((ctx->>'manual_recent')::boolean,false) OR coalesce((ctx->>'opted_out')::boolean,false) OR coalesce((ctx->>'linked_closed')::boolean,false) OR coalesce((ctx->>'has_phone')::boolean,false) OR ctx->'order'->>'id' IS NULL OR coalesce((ctx->'order'->>'is_paid')::boolean,false) OR coalesce((ctx->'order'->>'paid_externally')::boolean,false) OR ctx->'order'->>'stage' IN ('cancelled','refunded','paid','completed','shipped') THEN RETURN NULL; END IF;
 UPDATE live_followup_jobs SET button_clicked_at=p_clicked_at,reason='toque_recebido' WHERE id=j.id;
 INSERT INTO live_followup_jobs(event_id,order_id,access_id,customer_key,instagram,whatsapp_number_id,channel,type,step,sequence_key,base_at,scheduled_at,status,claimed_at,variant)
 VALUES(j.event_id,j.order_id,j.access_id,j.customer_key,j.instagram,j.whatsapp_number_id,'instagram','F',-1,j.sequence_key,p_clicked_at,now(),'processing',now(),0) ON CONFLICT(customer_key,sequence_key,step) DO NOTHING RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_button_claim(uuid,text,uuid,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.live_followup_button_claim(uuid,text,uuid,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.live_followup_button_finish(p_job_id uuid,p_message_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j live_followup_jobs; cfg jsonb; i integer; minutes integer;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF p_message_id IS NULL OR length(p_message_id)=0 THEN RETURN false; END IF;
 SELECT * INTO j FROM live_followup_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.type<>'F' OR j.step<>-1 OR j.status<>'processing' THEN RETURN false; END IF;
 UPDATE live_followup_jobs SET status='sent',sent_at=now(),message_id=p_message_id,reason='link_apos_toque' WHERE id=j.id;
 IF NOT live_followup_enabled(j.event_id) THEN RETURN true; END IF;
 SELECT value INTO cfg FROM live_followup_settings WHERE id;
 FOR i IN 1..3 LOOP
 minutes:=coalesce((cfg->'types'->'F'->'steps'->i->>'minutes')::integer,CASE i WHEN 1 THEN 10 WHEN 2 THEN 25 ELSE 45 END);
 INSERT INTO live_followup_jobs(event_id,order_id,access_id,customer_key,instagram,whatsapp_number_id,channel,type,step,sequence_key,base_at,scheduled_at,status)
 VALUES(j.event_id,j.order_id,j.access_id,j.customer_key,j.instagram,j.whatsapp_number_id,'instagram','F',i,j.sequence_key,j.base_at,j.base_at+make_interval(mins=>minutes)+make_interval(secs=>floor(random()*120-60)::integer),'pending') ON CONFLICT(customer_key,sequence_key,step) DO NOTHING;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_button_finish(uuid,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.live_followup_button_finish(uuid,text) TO service_role;