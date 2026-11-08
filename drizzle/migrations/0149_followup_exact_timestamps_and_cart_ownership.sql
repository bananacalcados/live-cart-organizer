ALTER TABLE public.orders ADD COLUMN live_followup_first_item_at timestamptz;
ALTER TABLE public.orders ADD COLUMN live_followup_cart_sent_at timestamptz;
ALTER TABLE public.live_selfservice_accesses ADD COLUMN live_followup_phone_at timestamptz;
CREATE OR REPLACE FUNCTION public.live_followup_timestamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF TG_TABLE_NAME='orders' THEN IF NEW.live_followup_first_item_at IS NULL AND jsonb_array_length(coalesce(NEW.products,'[]'))>0 THEN NEW.live_followup_first_item_at:=clock_timestamp(); END IF;
 ELSE IF NEW.live_followup_phone_at IS NULL AND length(regexp_replace(coalesce(NEW.entered_phone,''),'\D','','g'))>=10 THEN NEW.live_followup_phone_at:=clock_timestamp(); END IF; END IF;
 RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.live_followup_timestamp() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_timestamp() TO service_role;
CREATE TRIGGER live_followup_order_timestamp BEFORE INSERT OR UPDATE OF products ON public.orders FOR EACH ROW EXECUTE FUNCTION public.live_followup_timestamp();
CREATE TRIGGER live_followup_access_timestamp BEFORE INSERT OR UPDATE OF entered_phone ON public.live_selfservice_accesses FOR EACH ROW EXECUTE FUNCTION public.live_followup_timestamp();
CREATE OR REPLACE FUNCTION public.live_followup_mark_manual_cart(p_order_id uuid,p_message_id text,p_number_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o orders; m whatsapp_messages; BEGIN IF NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'events')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO o FROM orders WHERE id=p_order_id; IF NOT FOUND OR o.is_paid OR o.paid_externally OR o.stage='cancelled' THEN RETURN; END IF;
 SELECT * INTO m FROM whatsapp_messages WHERE message_id=p_message_id AND whatsapp_number_id=p_number_id AND direction='outgoing' AND status='sent' AND sender_user_id=auth.uid() ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND OR m.created_at<now()-interval '2 minutes' OR NOT EXISTS(SELECT 1 FROM events WHERE id=o.event_id AND whatsapp_number_id=p_number_id) THEN RETURN; END IF;
 IF strpos(m.message,coalesce(o.cart_link,'no-link'))=0 AND strpos(m.message,p_order_id::text)=0 AND strpos(m.message,replace(p_order_id::text,'-',''))=0 THEN RETURN; END IF;
 UPDATE orders SET live_followup_cart_sent_at=m.created_at WHERE id=o.id AND live_followup_cart_sent_at IS NULL;
 IF public.live_followup_enabled(o.event_id) THEN INSERT INTO live_followup_sources(source_key,event_id,order_id) VALUES('orders:'||o.id,o.event_id,o.id) ON CONFLICT(source_key) DO UPDATE SET changed_at=clock_timestamp(); END IF;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_mark_manual_cart(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.live_followup_mark_manual_cart(uuid,text,uuid) TO authenticated;
CREATE TABLE public.live_followup_cart_leases(order_id uuid PRIMARY KEY,job_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.live_followup_cart_leases TO service_role;
ALTER TABLE public.live_followup_cart_leases ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.live_followup_cart_reserve(p_job_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j live_followup_jobs; BEGIN SELECT * INTO j FROM live_followup_jobs WHERE id=p_job_id AND status='processing'; IF NOT FOUND OR j.type NOT IN ('B','C') THEN RETURN false; END IF;
 PERFORM 1 FROM orders WHERE id=j.order_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM orders WHERE id=j.order_id AND (selfservice_cart_sent_at IS NOT NULL OR live_followup_cart_sent_at IS NOT NULL)) OR EXISTS(SELECT 1 FROM selfservice_message_queue WHERE order_id=j.order_id AND kind='cart_link' AND status IN ('pending','sending','sent')) THEN RETURN false; END IF;
 INSERT INTO live_followup_cart_leases(order_id,job_id) VALUES(j.order_id,j.id) ON CONFLICT DO NOTHING; RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.live_followup_cart_reserve(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_cart_reserve(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.live_followup_cart_finish(p_job_id uuid,p_message_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j live_followup_jobs; BEGIN SELECT * INTO j FROM live_followup_jobs WHERE id=p_job_id AND type IN ('B','C') AND status='processing'; IF NOT FOUND OR p_message_id IS NULL THEN RAISE EXCEPTION 'Unconfirmed cart'; END IF;
 UPDATE orders SET live_followup_cart_sent_at=coalesce(live_followup_cart_sent_at,clock_timestamp()) WHERE id=j.order_id;
 PERFORM selfservice_mark_cart_sent(ARRAY[j.order_id],p_message_id);
 INSERT INTO live_followup_sources(source_key,event_id,order_id) VALUES('orders:'||j.order_id,j.event_id,j.order_id) ON CONFLICT(source_key) DO UPDATE SET changed_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.live_followup_cart_finish(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_followup_cart_finish(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.selfservice_queue_enqueue(p_message_key text,p_event_id uuid,p_order_id uuid,p_kind text,p_phone text,p_whatsapp_number_id uuid,p_payload jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_kind='cart_link' AND p_order_id IS NOT NULL THEN
  PERFORM 1 FROM orders WHERE id=p_order_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM live_followup_cart_leases WHERE order_id=p_order_id) THEN RETURN true; END IF;
 END IF;
 INSERT INTO selfservice_message_queue(message_key,event_id,order_id,kind,phone,whatsapp_number_id,payload) VALUES(p_message_key,p_event_id,p_order_id,p_kind,p_phone,p_whatsapp_number_id,coalesce(p_payload,'{}')) ON CONFLICT(message_key) DO NOTHING; RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.selfservice_queue_enqueue(text,uuid,uuid,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_enqueue(text,uuid,uuid,text,text,uuid,jsonb) TO service_role;
DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('public.live_followup_source_contexts(integer)'::regprocedure) INTO def;
 def:=replace(def,'''first_item_at'',o.created_at','''first_item_at'',o.live_followup_first_item_at');
 def:=replace(def,'''created_at'',a.created_at','''created_at'',coalesce(a.live_followup_phone_at,a.created_at)');
 def:=replace(def,'''selfservice_cart_sent_at'',o.selfservice_cart_sent_at','''selfservice_cart_sent_at'',coalesce(o.selfservice_cart_sent_at,o.live_followup_cart_sent_at)');
 def:=replace(def,'''cart_sent_at'',q.sent_at','''cart_sent_at'',coalesce(q.sent_at,o.live_followup_cart_sent_at)'); EXECUTE def;
 SELECT pg_get_functiondef('public.live_followup_job_context(uuid)'::regprocedure) INTO def;
 def:=replace(def,'m.created_at>coalesce(prev.sent_at,j.base_at)','m.created_at>j.base_at');
 def:=replace(def,'''selfservice_cart_sent_at'',o.selfservice_cart_sent_at','''selfservice_cart_sent_at'',coalesce(o.selfservice_cart_sent_at,o.live_followup_cart_sent_at)');
 def:=replace(def,'''cart_sent_at'',q.sent_at','''cart_sent_at'',coalesce(q.sent_at,o.live_followup_cart_sent_at)');
 def:=replace(def,'right(regexp_replace(b.phone,''\D'','''',''g''),8)=right(j.phone,8)','b.phone IN (j.phone,substring(j.phone from 3),substring(j.phone from 1 for 4)||substring(j.phone from 6))');
 def:=replace(def,'m.phone IN (j.phone,j.phone||''@s.whatsapp.net'',l.ig_user_id)','m.phone IN (j.phone,j.phone||''@s.whatsapp.net'',substring(j.phone from 3),substring(j.phone from 1 for 4)||substring(j.phone from 6),l.ig_user_id)');
 def:=replace(def,'''has_phone'',length(regexp_replace(coalesce(r.whatsapp,c.whatsapp,a.confirmed_phone,a.entered_phone,''''),''\D'','''',''g''))>=10','''has_phone'',greatest(length(regexp_replace(coalesce(r.whatsapp,''''),''\D'','''',''g'')),length(regexp_replace(coalesce(c.whatsapp,''''),''\D'','''',''g'')),length(regexp_replace(coalesce(a.confirmed_phone,a.entered_phone,''''),''\D'','''',''g'')))>=10,''linked_closed'',EXISTS(SELECT 1 FROM orders linked WHERE linked.id=ANY(a.order_ids) AND (linked.is_paid OR linked.paid_externally OR linked.stage IN (''cancelled'',''refunded'')))'); EXECUTE def;
END $$;
COMMENT ON FUNCTION public.live_followup_sources_claim(integer) IS 'DEPRECATED: use non-destructive live_followup_source_contexts with versioned acknowledgement';
REVOKE ALL ON FUNCTION public.live_followup_sources_claim(integer) FROM service_role;