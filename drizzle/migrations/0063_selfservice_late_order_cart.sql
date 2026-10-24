CREATE OR REPLACE FUNCTION public.selfservice_access_for_order(p_order_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; c record; ids uuid[];
BEGIN
 SELECT id,event_id,customer_id INTO o FROM orders WHERE id=p_order_id;
 IF o.id IS NULL THEN RETURN NULL; END IF;
 SELECT whatsapp,instagram_handle INTO c FROM customers WHERE id=o.customer_id;
 SELECT array_agg(a.id) INTO ids FROM live_selfservice_accesses a
 WHERE a.event_id=o.event_id AND a.whatsapp_confirmed_at IS NOT NULL AND a.registered_at IS NOT NULL
 AND (a.order_ids @> ARRAY[o.id] OR
 (length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'))>=10 AND a.confirmed_phone_key=event_phone_key(c.whatsapp)
 AND (nullif(trim(both '@ ' from coalesce(a.instagram,'')),'') IS NULL OR ig_handle_norm(a.instagram)=ig_handle_norm(c.instagram_handle)))
 OR (nullif(trim(both '@ ' from coalesce(c.instagram_handle,'')),'') IS NOT NULL AND ig_handle_norm(a.instagram)=ig_handle_norm(c.instagram_handle)));
 IF cardinality(ids)=1 THEN RETURN ids[1]; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.selfservice_access_for_order(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_access_for_order(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.selfservice_notify_late_order(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE secret text; worker_url text;
BEGIN
 IF selfservice_access_for_order(p_order_id) IS NULL THEN RETURN; END IF;
 SELECT value INTO secret FROM internal_function_secrets WHERE key='cron_secret';
 SELECT value #>> '{}' INTO worker_url FROM app_settings WHERE key='selfservice_queue_worker_url';
 IF secret IS NULL OR worker_url IS NULL THEN RETURN; END IF;
 PERFORM net.http_post(url:=replace(worker_url,'selfservice-message-worker','live-selfservice'),headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),body:=jsonb_build_object('action','send_cart','orderId',p_order_id));
END $$;
REVOKE ALL ON FUNCTION public.selfservice_notify_late_order(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_notify_late_order(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_ig_live_cart_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_handle text; v_kind text; v_rule record; v_last timestamptz; v_at timestamptz; v_live boolean; v_mode text;
BEGIN
 IF NEW.event_id IS NULL OR NEW.customer_id IS NULL OR NEW.stage IN ('cancelled','paid','completed','shipped') THEN RETURN NEW; END IF;
 SELECT operation_mode,(live_active_until > now() OR coalesce(is_live_broadcasting,false)) INTO v_mode,v_live FROM events WHERE id=NEW.event_id;
 IF v_mode='whatsapp_autoatendimento' AND NOT coalesce(NEW.is_paid,false) AND NOT coalesce(NEW.paid_externally,false) AND NEW.selfservice_cart_sent_at IS NULL AND jsonb_array_length(coalesce(NEW.products,'[]'::jsonb))>0 THEN
  PERFORM selfservice_notify_late_order(NEW.id);
 END IF;
 IF NOT coalesce(v_live,false) THEN RETURN NEW; END IF;
 SELECT lower(trim(both '@ ' from instagram_handle)) INTO v_handle FROM customers WHERE id=NEW.customer_id;
 IF v_handle IS NULL OR v_handle='' THEN RETURN NEW; END IF;
 IF coalesce(NEW.phone_last4,'') ~ '^\d{4}$' THEN v_kind:='live_cart_ready';
 ELSIF TG_OP='INSERT' THEN v_kind:='live_cart_missing_last4'; ELSE RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND coalesce(OLD.phone_last4,'')=coalesce(NEW.phone_last4,'') THEN RETURN NEW; END IF;
 SELECT * INTO v_rule FROM instagram_comment_rules WHERE is_active AND trigger_type=v_kind ORDER BY updated_at DESC LIMIT 1;
 IF v_rule.id IS NULL THEN RETURN NEW; END IF;
 SELECT max(scheduled_at) INTO v_last FROM ig_live_cart_notifications WHERE event_id=NEW.event_id AND status IN ('pending','processing');
 v_at:=now()+make_interval(secs=>3+floor(random()*5));
 IF v_last IS NOT NULL THEN v_at:=greatest(v_at,v_last+make_interval(secs=>v_rule.min_delay_seconds+floor(random()*greatest(v_rule.max_delay_seconds-v_rule.min_delay_seconds,0)))); END IF;
 INSERT INTO ig_live_cart_notifications(order_id,event_id,rule_id,kind,instagram_handle,scheduled_at) VALUES(NEW.id,NEW.event_id,v_rule.id,v_kind,v_handle,v_at) ON CONFLICT(order_id,kind) DO NOTHING;
 IF v_kind='live_cart_ready' THEN UPDATE ig_live_cart_notifications SET status='skipped',error='4 dígitos chegaram antes do envio' WHERE order_id=NEW.id AND kind='live_cart_missing_last4' AND status='pending'; END IF;
 RETURN NEW;
EXCEPTION WHEN others THEN RAISE WARNING '[cart notification] %',SQLERRM; RETURN NEW;
END $$;
DROP TRIGGER trg_ig_live_cart_notify ON public.orders;
CREATE TRIGGER trg_ig_live_cart_notify AFTER INSERT OR UPDATE OF phone_last4,products,customer_id ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enqueue_ig_live_cart_notification();