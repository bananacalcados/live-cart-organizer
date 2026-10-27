ALTER TABLE public.ig_live_cart_notifications
  ADD COLUMN IF NOT EXISTS link_token text,
  ADD COLUMN IF NOT EXISTS variant_index integer,
  ADD COLUMN IF NOT EXISTS manual_resends integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS ig_live_cart_notifications_link_token_key ON public.ig_live_cart_notifications(link_token) WHERE link_token IS NOT NULL;
-- Um único direct de cadastro por @ por live (anti-spam).
CREATE UNIQUE INDEX IF NOT EXISTS ig_live_cart_notif_register_handle_key ON public.ig_live_cart_notifications(event_id, instagram_handle) WHERE kind = 'selfservice_register_dm';
CREATE SEQUENCE IF NOT EXISTS public.selfservice_dm_variant_seq;

CREATE OR REPLACE FUNCTION public.enqueue_ig_live_cart_notification()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_handle text; v_kind text; v_rule record; v_last timestamptz; v_at timestamptz; v_live boolean; v_mode text;
BEGIN
 IF NEW.event_id IS NULL OR NEW.customer_id IS NULL OR NEW.stage IN ('cancelled','paid','completed','shipped') THEN RETURN NEW; END IF;
 SELECT operation_mode,(live_active_until > now() OR coalesce(is_live_broadcasting,false)) INTO v_mode,v_live FROM events WHERE id=NEW.event_id;
 SELECT lower(trim(both '@ ' from instagram_handle)) INTO v_handle FROM customers WHERE id=NEW.customer_id;
 IF v_mode='whatsapp_autoatendimento' AND NOT coalesce(NEW.is_paid,false) AND NOT coalesce(NEW.paid_externally,false) AND NEW.selfservice_cart_sent_at IS NULL AND jsonb_array_length(coalesce(NEW.products,'[]'::jsonb))>0 THEN
  PERFORM selfservice_notify_late_order(NEW.id);
  -- Direct com link único de cadastro: só para quem ainda não se cadastrou, 1 por @ por live.
  IF v_handle IS NOT NULL AND v_handle<>'' AND NEW.registered_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM live_selfservice_accesses a WHERE a.event_id=NEW.event_id AND NEW.id = ANY(a.order_ids) AND (a.registered_at IS NOT NULL OR a.whatsapp_confirmed_at IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM ig_live_cart_notifications n WHERE n.event_id=NEW.event_id AND n.instagram_handle=v_handle AND n.kind='selfservice_register_dm') THEN
   SELECT max(scheduled_at) INTO v_last FROM ig_live_cart_notifications WHERE event_id=NEW.event_id AND kind='selfservice_register_dm' AND status IN ('pending','processing');
   v_at:=greatest(now()+make_interval(secs=>5+floor(random()*6)), coalesce(v_last,now())+make_interval(secs=>8+floor(random()*8)));
   INSERT INTO ig_live_cart_notifications(order_id,event_id,kind,instagram_handle,scheduled_at,link_token,variant_index)
   VALUES(NEW.id,NEW.event_id,'selfservice_register_dm',v_handle,v_at,replace(gen_random_uuid()::text,'-',''),(nextval('selfservice_dm_variant_seq')%5)::int)
   ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 IF NOT coalesce(v_live,false) THEN RETURN NEW; END IF;
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
END $function$;

-- Reenvio manual pela equipe: máx. 2 reenvios, 10 min de intervalo, nunca com envio em andamento.
CREATE OR REPLACE FUNCTION public.selfservice_resend_register_dm(p_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_o record; v_handle text; v_n record;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Entre no sistema.'); END IF;
 SELECT o.id,o.event_id,o.registered_at,o.is_paid,o.stage,lower(trim(both '@ ' from c.instagram_handle)) h INTO v_o
   FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=p_order_id;
 IF v_o.id IS NULL OR coalesce(v_o.h,'')='' THEN RETURN jsonb_build_object('ok',false,'error','Pedido sem @ do Instagram.'); END IF;
 IF v_o.is_paid OR v_o.stage='cancelled' THEN RETURN jsonb_build_object('ok',false,'error','Pedido já pago ou cancelado.'); END IF;
 IF v_o.registered_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Cliente já se cadastrou.'); END IF;
 SELECT * INTO v_n FROM ig_live_cart_notifications WHERE event_id=v_o.event_id AND instagram_handle=v_o.h AND kind='selfservice_register_dm' FOR UPDATE;
 IF v_n.id IS NULL THEN
  INSERT INTO ig_live_cart_notifications(order_id,event_id,kind,instagram_handle,scheduled_at,link_token,variant_index)
  VALUES(v_o.id,v_o.event_id,'selfservice_register_dm',v_o.h,now(),replace(gen_random_uuid()::text,'-',''),(nextval('selfservice_dm_variant_seq')%5)::int);
  RETURN jsonb_build_object('ok',true,'queued',true);
 END IF;
 IF v_n.status IN ('pending','processing') THEN RETURN jsonb_build_object('ok',false,'error','Já tem um envio em andamento.'); END IF;
 IF v_n.manual_resends >= 2 THEN RETURN jsonb_build_object('ok',false,'error','Limite de reenvios atingido para este @.'); END IF;
 IF v_n.sent_at IS NOT NULL AND v_n.sent_at > now()-interval '10 minutes' THEN RETURN jsonb_build_object('ok',false,'error','Enviado há menos de 10 minutos. Aguarde.'); END IF;
 UPDATE ig_live_cart_notifications SET status='pending',scheduled_at=now(),manual_resends=manual_resends+1,error=NULL,
   variant_index=(nextval('selfservice_dm_variant_seq')%5)::int WHERE id=v_n.id;
 PERFORM net.http_post(url:='https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/ig-live-cart-notify',
   headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from internal_function_secrets where key='cron_secret')),
   body:='{}'::jsonb, timeout_milliseconds:=60000);
 RETURN jsonb_build_object('ok',true,'queued',true);
END $function$;
REVOKE ALL ON FUNCTION public.selfservice_resend_register_dm(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.selfservice_resend_register_dm(uuid) TO authenticated;