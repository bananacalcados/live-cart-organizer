CREATE TABLE public.event_catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  product_handle text,
  title text NOT NULL,
  image_url text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  original_price numeric NOT NULL,
  offer_price numeric,
  allow_cashback boolean NOT NULL DEFAULT true,
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, shopify_product_id)
);
CREATE INDEX idx_event_catalog_products_event ON public.event_catalog_products(event_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_catalog_products TO authenticated;
GRANT ALL ON public.event_catalog_products TO service_role;
ALTER TABLE public.event_catalog_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth access event_catalog_products" ON public.event_catalog_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.event_catalog_products_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.offer_price IS NOT NULL THEN NEW.allow_cashback := false; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_event_catalog_products_before_write
BEFORE INSERT OR UPDATE ON public.event_catalog_products
FOR EACH ROW EXECUTE FUNCTION public.event_catalog_products_before_write();

CREATE TABLE public.live_catalog_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text,'-',''),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  phone_key text NOT NULL,
  source_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  invite_sent_at timestamptz,
  invite_kind text CHECK (invite_kind IN ('auto','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, phone_key)
);
GRANT SELECT ON public.live_catalog_links TO authenticated;
GRANT ALL ON public.live_catalog_links TO service_role;
ALTER TABLE public.live_catalog_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read live_catalog_links" ON public.live_catalog_links FOR SELECT TO authenticated USING (true);

ALTER TABLE public.orders ADD COLUMN origin text;
CREATE INDEX idx_orders_origin ON public.orders(origin) WHERE origin IS NOT NULL;

ALTER TABLE public.events ADD COLUMN catalog_link_hours integer NOT NULL DEFAULT 48;
ALTER TABLE public.events ADD COLUMN catalog_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enqueue_ig_live_cart_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_handle text; v_kind text; v_rule record; v_last timestamptz; v_at timestamptz; v_live boolean; v_mode text;
BEGIN
 IF NEW.origin = 'catalog' THEN RETURN NEW; END IF;
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