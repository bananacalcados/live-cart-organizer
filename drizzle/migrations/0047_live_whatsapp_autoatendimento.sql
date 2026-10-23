ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS self_service_slug text,
  ADD COLUMN IF NOT EXISTS self_service_prize_name text,
  ADD COLUMN IF NOT EXISTS self_service_prize_image_url text,
  ADD COLUMN IF NOT EXISTS self_service_registration_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS self_service_product_notice text NOT NULL DEFAULT 'Linha Luxo importada · 7 dias para troca ou devolução';
CREATE UNIQUE INDEX IF NOT EXISTS events_self_service_slug_uq ON public.events (self_service_slug) WHERE self_service_slug IS NOT NULL;

ALTER TABLE public.event_raffles ADD COLUMN IF NOT EXISTS prize_requires_paid boolean NOT NULL DEFAULT false;
ALTER TABLE public.event_raffles ALTER COLUMN prize_requires_paid SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.event_raffles_default_registration_minutes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.max_registration_minutes IS NULL THEN
    SELECT e.self_service_registration_minutes INTO NEW.max_registration_minutes
      FROM public.events e WHERE e.id = NEW.event_id AND e.operation_mode = 'whatsapp_autoatendimento';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_event_raffles_default_reg_minutes ON public.event_raffles;
CREATE TRIGGER trg_event_raffles_default_reg_minutes BEFORE INSERT ON public.event_raffles
  FOR EACH ROW EXECUTE FUNCTION public.event_raffles_default_registration_minutes();

ALTER TABLE public.event_leads DROP CONSTRAINT IF EXISTS event_leads_source_check;
ALTER TABLE public.event_leads ADD CONSTRAINT event_leads_source_check
  CHECK (source = ANY (ARRAY['lp','typebot','referral','manual','member_area','live','live_whatsapp_link','autoatendimento']));

CREATE TABLE IF NOT EXISTS public.live_selfservice_accesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  entered_phone text NOT NULL,
  phone_key text NOT NULL,
  instagram text,
  order_ids uuid[] NOT NULL DEFAULT '{}',
  lead_id uuid,
  viewed_product_at timestamptz,
  registered_at timestamptz,
  paid_at timestamptz,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_selfservice_accesses_event_idx ON public.live_selfservice_accesses (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_selfservice_accesses_key_idx ON public.live_selfservice_accesses (event_id, phone_key);
GRANT SELECT ON public.live_selfservice_accesses TO authenticated;
GRANT ALL ON public.live_selfservice_accesses TO service_role;
ALTER TABLE public.live_selfservice_accesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read selfservice accesses" ON public.live_selfservice_accesses FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.orders_mark_cart_assembled()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text;
  v_reg_min integer;
  v_lead_at timestamptz;
  v_phone text;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT e.operation_mode, e.self_service_registration_minutes INTO v_mode, v_reg_min
      FROM events e WHERE e.id = NEW.event_id;
  END IF;

  IF v_mode = 'whatsapp_autoatendimento' THEN
    IF NEW.registered_at IS NULL AND NEW.customer_id IS NOT NULL THEN
      SELECT c.whatsapp INTO v_phone FROM customers c WHERE c.id = NEW.customer_id;
      IF length(regexp_replace(coalesce(v_phone,''), '\D', '', 'g')) >= 8 THEN
        SELECT min(coalesce(nullif(l.metadata->>'self_service_registered_at','')::timestamptz, l.created_at)) INTO v_lead_at
          FROM event_leads l
         WHERE l.event_id = NEW.event_id AND l.source = 'autoatendimento'
           AND l.phone_suffix = right(regexp_replace(v_phone, '\D', '', 'g'), 8);
        IF v_lead_at IS NOT NULL AND v_lead_at <= coalesce(NEW.created_at, now()) THEN
          NEW.registered_at := v_lead_at;
        END IF;
      END IF;
    END IF;
    IF NEW.stage = 'awaiting_confirmation' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'awaiting_confirmation') THEN
      IF NEW.payment_window_expires_at IS NULL AND NOT coalesce(NEW.is_paid, false)
         AND EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.payment_window_on_assembly) THEN
        NEW.payment_window_expires_at := now() + interval '20 minutes';
      END IF;
    END IF;
    NEW.eligible_for_prize := (coalesce(NEW.is_paid,false) OR coalesce(NEW.paid_externally,false))
      AND NEW.registered_at IS NOT NULL
      AND NEW.registered_at <= coalesce(NEW.created_at, now()) + make_interval(mins => coalesce(v_reg_min, 5));
    RETURN NEW;
  END IF;

  IF NEW.stage = 'awaiting_confirmation' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'awaiting_confirmation') THEN
    IF NEW.registered_at IS NULL THEN NEW.registered_at := now(); END IF;
    IF NEW.event_id IS NOT NULL AND NEW.payment_window_expires_at IS NULL AND NOT coalesce(NEW.is_paid, false)
       AND EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.payment_window_on_assembly) THEN
      NEW.payment_window_expires_at := now() + interval '20 minutes';
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_orders_mark_cart_assembled ON public.orders;
CREATE TRIGGER trg_orders_mark_cart_assembled
  BEFORE INSERT OR UPDATE OF stage, is_paid, paid_externally, registered_at, eligible_for_prize ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_mark_cart_assembled();

CREATE OR REPLACE FUNCTION public.event_raffle_pool(p_raffle_id uuid)
 RETURNS TABLE(phone text, display_name text, order_id uuid, product text, entry_value numeric, registration_minutes numeric, payment_minutes numeric, eligible boolean, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.event_raffles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.event_raffles WHERE id = p_raffle_id;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT o.id, o.created_at, o.stage,
      (coalesce(o.is_paid,false) OR coalesce(o.paid_externally,false)) AS paid,
      public.raffle_norm_phone(c.whatsapp) AS ph, c.instagram_handle AS handle,
      coalesce(o.products->0->>'title', o.products->0->>'name') AS prod,
      (SELECT coalesce(sum(coalesce(nullif(x->>'price','')::numeric,0) * coalesce(nullif(x->>'quantity','')::numeric,1)),0)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.products) = 'array' THEN o.products ELSE '[]'::jsonb END) x) AS val,
      round((extract(epoch FROM (o.registered_at - o.created_at)) / 60.0)::numeric, 1) AS reg_min,
      round((extract(epoch FROM (o.paid_at - o.created_at)) / 60.0)::numeric, 1) AS pay_min
    FROM public.orders o LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE o.event_id = r.event_id AND o.stage <> 'cancelled'
  ), q AS (
    SELECT b.*, right(b.ph, 8) AS k,
      CASE WHEN r.audience = 'confirmed_orders' THEN b.stage NOT IN ('pre_sale','incomplete_order','awaiting_confirmation')
           WHEN r.audience = 'payers' THEN b.paid ELSE false END AS in_aud,
      (r.max_registration_minutes IS NULL OR (b.reg_min IS NOT NULL AND b.reg_min <= r.max_registration_minutes)) AS reg_ok,
      (r.max_payment_minutes IS NULL OR (b.paid AND b.pay_min IS NOT NULL AND b.pay_min <= r.max_payment_minutes)) AS pay_ok
    FROM base b WHERE b.ph IS NOT NULL
  ), agg AS (
    SELECT q.k, coalesce(sum(q.val) FILTER (WHERE q.in_aud), 0) AS aud_val FROM q GROUP BY q.k
  ), best AS (
    SELECT DISTINCT ON (q.k) q.* FROM q ORDER BY q.k, q.in_aud DESC, (q.in_aud AND q.reg_ok AND q.pay_ok) DESC, q.created_at
  ), winners AS (
    SELECT DISTINCT right(regexp_replace(w.phone,'\D','','g'), 8) AS k
      FROM public.event_raffle_winners w JOIN public.event_raffles r2 ON r2.id = w.raffle_id
     WHERE r.exclude_previous_winners AND r2.event_id = r.event_id AND r2.id <> r.id AND w.voided_at IS NULL
  ), from_orders AS (
    SELECT b.ph, b.handle::text, b.id, b.prod, a.aud_val, b.reg_min, b.pay_min,
      CASE
        WHEN NOT b.in_aud THEN 'fora do público'
        WHEN coalesce(r.prize_requires_paid,false) AND NOT b.paid THEN 'não pagou'
        WHEN NOT b.reg_ok THEN CASE WHEN b.reg_min IS NULL THEN 'cadastro não concluído' ELSE 'cadastro em ' || trim_scale(b.reg_min) || ' min' END
        WHEN NOT b.pay_ok THEN CASE WHEN NOT b.paid THEN 'não pagou' WHEN b.pay_min IS NULL THEN 'pagamento sem horário' ELSE 'pagamento em ' || trim_scale(b.pay_min) || ' min' END
        WHEN coalesce(r.min_purchase_value,0) > 0 AND a.aud_val < r.min_purchase_value THEN 'abaixo do valor mínimo'
        WHEN EXISTS (SELECT 1 FROM winners w WHERE w.k = b.k) THEN 'já ganhou outro sorteio'
      END AS why
    FROM best b JOIN agg a ON a.k = b.k
  ), from_leads AS (
    SELECT DISTINCT ON (right(public.raffle_norm_phone(l.phone), 8))
      public.raffle_norm_phone(l.phone) AS ph, coalesce(l.instagram, l.name)::text AS handle,
      CASE WHEN coalesce(r.prize_requires_paid,false) THEN 'sem pedido pago' WHEN EXISTS (SELECT 1 FROM winners w WHERE w.k = right(public.raffle_norm_phone(l.phone), 8)) THEN 'já ganhou outro sorteio' END AS why
    FROM public.event_leads l
    WHERE r.audience = 'live_leads' AND l.event_id = r.event_id AND NOT coalesce(l.disqualified, false)
      AND public.raffle_norm_phone(l.phone) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM q WHERE q.k = right(public.raffle_norm_phone(l.phone), 8))
    ORDER BY right(public.raffle_norm_phone(l.phone), 8), l.created_at
  )
  SELECT f.ph, f.handle, f.id, f.prod, f.aud_val, f.reg_min, f.pay_min, f.why IS NULL, f.why FROM from_orders f
  UNION ALL
  SELECT l.ph, l.handle, NULL::uuid, NULL::text, 0::numeric, NULL::numeric, NULL::numeric, l.why IS NULL, l.why FROM from_leads l;
END $function$;