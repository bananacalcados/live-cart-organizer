ALTER TABLE public.instagram_comment_rules
  ADD COLUMN IF NOT EXISTS min_delay_seconds integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS max_delay_seconds integer NOT NULL DEFAULT 60;

CREATE TABLE IF NOT EXISTS public.ig_live_cart_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  event_id uuid,
  rule_id uuid REFERENCES public.instagram_comment_rules(id) ON DELETE SET NULL,
  kind text NOT NULL,
  instagram_handle text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  channel text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, kind)
);
GRANT SELECT ON public.ig_live_cart_notifications TO authenticated;
GRANT ALL ON public.ig_live_cart_notifications TO service_role;
ALTER TABLE public.ig_live_cart_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe vê avisos da live" ON public.ig_live_cart_notifications FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_iglcn_due ON public.ig_live_cart_notifications (status, scheduled_at);

CREATE OR REPLACE FUNCTION public.enqueue_ig_live_cart_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_handle text; v_kind text; v_rule record; v_last timestamptz; v_at timestamptz; v_live boolean;
BEGIN
  IF NEW.event_id IS NULL OR NEW.customer_id IS NULL OR NEW.stage IN ('cancelled','paid','completed','shipped') THEN RETURN NEW; END IF;
  SELECT (live_active_until > now() OR coalesce(is_live_broadcasting,false)) INTO v_live FROM events WHERE id = NEW.event_id;
  IF NOT coalesce(v_live,false) THEN RETURN NEW; END IF;
  SELECT lower(trim(both '@ ' from instagram_handle)) INTO v_handle FROM customers WHERE id = NEW.customer_id;
  IF v_handle IS NULL OR v_handle = '' THEN RETURN NEW; END IF;

  IF coalesce(NEW.phone_last4,'') ~ '^\d{4}$' THEN v_kind := 'live_cart_ready';
  ELSIF TG_OP = 'INSERT' THEN v_kind := 'live_cart_missing_last4';
  ELSE RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND coalesce(OLD.phone_last4,'') = coalesce(NEW.phone_last4,'') THEN RETURN NEW; END IF;

  SELECT * INTO v_rule FROM instagram_comment_rules WHERE is_active AND trigger_type = v_kind ORDER BY updated_at DESC LIMIT 1;
  IF v_rule.id IS NULL THEN RETURN NEW; END IF;

  -- espaçamento anti-spam: cada aviso fica pelo menos min_delay depois do último agendado da live
  SELECT max(scheduled_at) INTO v_last FROM ig_live_cart_notifications WHERE event_id = NEW.event_id AND status IN ('pending','processing');
  v_at := now() + make_interval(secs => 3 + floor(random()*5));
  IF v_last IS NOT NULL THEN
    v_at := greatest(v_at, v_last + make_interval(secs => v_rule.min_delay_seconds
      + floor(random() * greatest(v_rule.max_delay_seconds - v_rule.min_delay_seconds, 0))));
  END IF;

  INSERT INTO ig_live_cart_notifications (order_id, event_id, rule_id, kind, instagram_handle, scheduled_at)
  VALUES (NEW.id, NEW.event_id, v_rule.id, v_kind, v_handle, v_at)
  ON CONFLICT (order_id, kind) DO NOTHING;
  -- se já pediu os 4 dígitos e ainda nem enviou, cancela o pedido de dígitos
  IF v_kind = 'live_cart_ready' THEN
    UPDATE ig_live_cart_notifications SET status='skipped', error='4 dígitos chegaram antes do envio'
    WHERE order_id = NEW.id AND kind='live_cart_missing_last4' AND status='pending';
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ig_live_cart_notify ON public.orders;
CREATE TRIGGER trg_ig_live_cart_notify AFTER INSERT OR UPDATE OF phone_last4 ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enqueue_ig_live_cart_notification();

CREATE OR REPLACE FUNCTION public.claim_ig_live_cart_notifications(p_limit int DEFAULT 5)
RETURNS SETOF public.ig_live_cart_notifications LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE ig_live_cart_notifications n SET status='processing', attempts = attempts + 1
  WHERE id IN (SELECT id FROM ig_live_cart_notifications WHERE status='pending' AND scheduled_at <= now()
               ORDER BY scheduled_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING n.*;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_ig_live_cart_notifications(int) FROM public, anon, authenticated;