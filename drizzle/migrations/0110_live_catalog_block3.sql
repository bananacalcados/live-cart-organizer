-- lovable-cron-fallback-reviewed: owner explicitly requested a fixed 1-minute indexed check; delayed per-record invites need minute precision
ALTER TABLE public.events ADD COLUMN catalog_auto_invite boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN catalog_invite_delay_min integer NOT NULL DEFAULT 2;
ALTER TABLE public.events ADD COLUMN catalog_invite_delay_max integer NOT NULL DEFAULT 5;

CREATE TABLE public.live_catalog_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_id uuid,
  phone_key text NOT NULL,
  phone text,
  link_id uuid REFERENCES public.live_catalog_links(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('auto','manual')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sending','sent','skipped','failed')),
  send_after timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  send_seq integer NOT NULL DEFAULT 0,
  enqueued_at timestamptz,
  sent_message_key text,
  error text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, phone_key)
);
CREATE INDEX idx_live_catalog_invites_due ON public.live_catalog_invites(send_after) WHERE status='scheduled';
GRANT SELECT ON public.live_catalog_invites TO authenticated;
GRANT ALL ON public.live_catalog_invites TO service_role;
ALTER TABLE public.live_catalog_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Events module read live_catalog_invites" ON public.live_catalog_invites FOR SELECT TO authenticated USING (public.has_module_access(auth.uid(),'events'));

CREATE OR REPLACE FUNCTION public.live_catalog_ensure_link(p_event_id uuid, p_phone_key text, p_customer_id uuid, p_order_id uuid)
RETURNS public.live_catalog_links LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.live_catalog_links; v_exp timestamptz;
BEGIN
 IF coalesce(p_phone_key,'') !~ '^\d{10}$' THEN RAISE EXCEPTION 'Telefone inválido'; END IF;
 SELECT greatest(now(), coalesce(live_active_until, now())) + make_interval(hours => coalesce(catalog_link_hours,48)) INTO v_exp FROM events WHERE id=p_event_id;
 IF v_exp IS NULL THEN RAISE EXCEPTION 'Evento não encontrado'; END IF;
 INSERT INTO live_catalog_links(event_id, phone_key, customer_id, source_order_id, expires_at)
 VALUES (p_event_id, p_phone_key, p_customer_id, p_order_id, v_exp)
 ON CONFLICT (event_id, phone_key) DO NOTHING RETURNING * INTO l;
 IF l.id IS NULL THEN
  SELECT * INTO l FROM live_catalog_links WHERE event_id=p_event_id AND phone_key=p_phone_key FOR UPDATE;
  IF l.expires_at <= now() OR (l.customer_id IS NULL AND p_customer_id IS NOT NULL) OR (l.source_order_id IS NULL AND p_order_id IS NOT NULL) THEN
   UPDATE live_catalog_links SET
     expires_at = CASE WHEN expires_at <= now() THEN v_exp ELSE expires_at END,
     customer_id = coalesce(customer_id, p_customer_id),
     source_order_id = coalesce(source_order_id, p_order_id)
   WHERE id=l.id RETURNING * INTO l;
  END IF;
 END IF;
 RETURN l;
END $$;
REVOKE ALL ON FUNCTION public.live_catalog_ensure_link(uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_catalog_ensure_link(uuid,text,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.live_catalog_schedule_invite()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; v_phone text; v_key text; v_min int; v_max int;
BEGIN
 IF NOT (coalesce(NEW.is_paid,false) OR coalesce(NEW.paid_externally,false)) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (coalesce(OLD.is_paid,false) OR coalesce(OLD.paid_externally,false)) THEN RETURN NEW; END IF;
 IF NEW.stage = 'cancelled' OR NEW.origin IS NOT DISTINCT FROM 'catalog' OR NEW.event_id IS NULL THEN RETURN NEW; END IF;
 SELECT operation_mode, catalog_enabled, catalog_auto_invite, catalog_invite_delay_min, catalog_invite_delay_max INTO e FROM events WHERE id=NEW.event_id;
 IF e.operation_mode IS DISTINCT FROM 'whatsapp_autoatendimento' OR NOT coalesce(e.catalog_enabled,false) OR NOT coalesce(e.catalog_auto_invite,false) THEN RETURN NEW; END IF;
 IF NOT EXISTS (SELECT 1 FROM event_catalog_products WHERE event_id=NEW.event_id AND is_active) THEN RETURN NEW; END IF;
 SELECT whatsapp INTO v_phone FROM customer_registrations WHERE order_id=NEW.id AND coalesce(whatsapp,'')<>'' ORDER BY created_at DESC LIMIT 1;
 IF v_phone IS NULL AND NEW.customer_id IS NOT NULL THEN SELECT whatsapp INTO v_phone FROM customers WHERE id=NEW.customer_id; END IF;
 v_key := event_phone_key(v_phone);
 IF coalesce(v_key,'') !~ '^\d{10}$' THEN RETURN NEW; END IF;
 v_min := greatest(0, least(coalesce(e.catalog_invite_delay_min,2), coalesce(e.catalog_invite_delay_max,5)));
 v_max := greatest(v_min, coalesce(e.catalog_invite_delay_max,5));
 INSERT INTO live_catalog_invites(event_id, order_id, customer_id, phone_key, phone, kind, status, send_after)
 VALUES (NEW.event_id, NEW.id, NEW.customer_id, v_key, v_phone, 'auto', 'scheduled',
         now() + make_interval(secs => (v_min*60 + floor(random()*((v_max-v_min)*60+1)))::int))
 ON CONFLICT (event_id, phone_key) DO NOTHING;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING '[catalog invite] %', SQLERRM; RETURN NEW;
END $$;
CREATE TRIGGER trg_live_catalog_invite_ins AFTER INSERT ON public.orders FOR EACH ROW
 WHEN (coalesce(NEW.is_paid,false) OR coalesce(NEW.paid_externally,false)) EXECUTE FUNCTION public.live_catalog_schedule_invite();
CREATE TRIGGER trg_live_catalog_invite_upd AFTER UPDATE OF is_paid, paid_externally ON public.orders FOR EACH ROW
 WHEN ((coalesce(NEW.is_paid,false) OR coalesce(NEW.paid_externally,false)) AND NOT (coalesce(OLD.is_paid,false) OR coalesce(OLD.paid_externally,false)))
 EXECUTE FUNCTION public.live_catalog_schedule_invite();

CREATE OR REPLACE FUNCTION public.live_catalog_invites_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.live_catalog_invites LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE live_catalog_invites i SET status='sending', attempts=i.attempts+1
 WHERE i.id IN (SELECT id FROM live_catalog_invites WHERE status='scheduled' AND send_after<=now() ORDER BY send_after LIMIT least(greatest(p_limit,1),20) FOR UPDATE SKIP LOCKED)
 RETURNING i.*;
$$;
REVOKE ALL ON FUNCTION public.live_catalog_invites_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_catalog_invites_claim(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.live_catalog_invites_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u text; s text;
BEGIN
 UPDATE live_catalog_invites SET status='scheduled' WHERE status='sending' AND send_after < now()-interval '5 minutes' AND attempts < 3;
 IF EXISTS (SELECT 1 FROM live_catalog_invites WHERE status='scheduled' AND send_after<=now() LIMIT 1) THEN
  SELECT replace(value->>'url','selfservice-message-worker','live-catalog-invite') INTO u FROM app_settings WHERE key='selfservice_queue_worker_url';
  SELECT value INTO s FROM internal_function_secrets WHERE key='cron_secret';
  IF u IS NULL OR s IS NULL THEN RAISE EXCEPTION 'Catalog invite configuration missing'; END IF;
  PERFORM net.http_post(url:=u, headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',s), body:='{}'::jsonb, timeout_milliseconds:=55000);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.live_catalog_invites_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_catalog_invites_tick() TO service_role;

CREATE OR REPLACE FUNCTION public.live_catalog_staff_link(p_event_id uuid, p_phone text, p_customer_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_key text; v_cust uuid := p_customer_id; v_order uuid := p_order_id; l live_catalog_links; ev record; inv record; cart record; v_total numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT has_module_access(auth.uid(),'events') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
 SELECT id, self_service_slug, operation_mode, catalog_enabled INTO ev FROM events WHERE id=p_event_id;
 IF ev.id IS NULL OR ev.operation_mode <> 'whatsapp_autoatendimento' OR NOT ev.catalog_enabled THEN RAISE EXCEPTION 'Catálogo não está ativo neste evento'; END IF;
 v_key := event_phone_key(p_phone);
 IF coalesce(v_key,'') !~ '^\d{10}$' THEN RAISE EXCEPTION 'Telefone inválido'; END IF;
 IF v_order IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id=v_order AND event_id=p_event_id) THEN v_order := NULL; END IF;
 IF v_order IS NULL THEN
  SELECT o.id, o.customer_id INTO v_order, v_cust FROM orders o JOIN customers c ON c.id=o.customer_id
  WHERE o.event_id=p_event_id AND (o.is_paid OR o.paid_externally) AND coalesce(o.origin,'')<>'catalog' AND event_phone_key(c.whatsapp)=v_key
  ORDER BY o.created_at DESC LIMIT 1;
  v_cust := coalesce(p_customer_id, v_cust);
 END IF;
 IF v_cust IS NULL AND v_order IS NOT NULL THEN SELECT customer_id INTO v_cust FROM orders WHERE id=v_order; END IF;
 l := live_catalog_ensure_link(p_event_id, v_key, v_cust, v_order);
 SELECT kind, status, enqueued_at, error INTO inv FROM live_catalog_invites WHERE event_id=p_event_id AND phone_key=v_key;
 IF l.customer_id IS NOT NULL THEN
  SELECT id, products, is_paid, paid_externally, discount_type, discount_value, free_shipping, shipping_cost INTO cart FROM orders
  WHERE event_id=p_event_id AND customer_id=l.customer_id AND origin='catalog' AND stage<>'cancelled' ORDER BY created_at DESC LIMIT 1;
  IF cart.id IS NOT NULL THEN
   SELECT coalesce(sum(coalesce((p->>'price')::numeric,0)*coalesce((p->>'quantity')::numeric,1)),0) INTO v_total FROM jsonb_array_elements(coalesce(cart.products,'[]'::jsonb)) p;
   v_total := greatest(0, v_total - CASE WHEN cart.discount_type='percentage' THEN v_total*coalesce(cart.discount_value,0)/100 ELSE coalesce(cart.discount_value,0) END)
              + CASE WHEN cart.free_shipping THEN 0 ELSE coalesce(cart.shipping_cost,0) END;
  END IF;
 END IF;
 RETURN jsonb_build_object(
  'link_id', l.id, 'url', 'https://checkout.bananacalcados.com.br/pedido/'||ev.self_service_slug||'/catalogo/'||l.token,
  'expires_at', l.expires_at, 'open_count', l.open_count, 'opened_at', l.opened_at,
  'invite_sent_at', l.invite_sent_at, 'invite_kind', l.invite_kind,
  'invite_status', inv.status, 'invite_error', inv.error,
  'cart', CASE WHEN cart.id IS NULL THEN NULL ELSE jsonb_build_object('order_id', cart.id, 'total', round(v_total,2), 'paid', coalesce(cart.is_paid,false) OR coalesce(cart.paid_externally,false)) END);
END $$;
REVOKE ALL ON FUNCTION public.live_catalog_staff_link(uuid,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_catalog_staff_link(uuid,text,uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.live_catalog_staff_send(p_event_id uuid, p_phone text, p_customer_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_info jsonb; v_key text; v_link live_catalog_links; v_id uuid;
BEGIN
 v_info := live_catalog_staff_link(p_event_id, p_phone, p_customer_id, p_order_id);
 v_key := event_phone_key(p_phone);
 SELECT * INTO v_link FROM live_catalog_links WHERE id=(v_info->>'link_id')::uuid;
 INSERT INTO live_catalog_invites(event_id, order_id, customer_id, phone_key, phone, link_id, kind, status, send_after, requested_by)
 VALUES (p_event_id, v_link.source_order_id, v_link.customer_id, v_key, p_phone, v_link.id, 'manual', 'scheduled', now(), auth.uid())
 ON CONFLICT (event_id, phone_key) DO UPDATE SET kind='manual', status='scheduled', send_after=now(), attempts=0, error=NULL,
   phone=EXCLUDED.phone, link_id=EXCLUDED.link_id, requested_by=EXCLUDED.requested_by, send_seq=live_catalog_invites.send_seq+1
 WHERE live_catalog_invites.status <> 'sending'
 RETURNING id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Convite já está sendo enviado'; END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.live_catalog_staff_send(uuid,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_catalog_staff_send(uuid,text,uuid,uuid) TO authenticated, service_role;

DO $$ DECLARE j bigint; BEGIN
 SELECT jobid INTO j FROM cron.job WHERE jobname='live-catalog-invites';
 IF j IS NULL THEN PERFORM cron.schedule('live-catalog-invites','* * * * *','SELECT public.live_catalog_invites_tick();'); END IF;
END $$;