ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS registered_at timestamptz;
COMMENT ON COLUMN public.orders.registered_at IS 'Primeira vez que o carrinho ficou montado (etapa awaiting_confirmation).';
ALTER TABLE public.event_raffles ADD COLUMN IF NOT EXISTS max_registration_minutes integer, ADD COLUMN IF NOT EXISTS max_payment_minutes integer;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS payment_window_on_assembly boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.events.payment_window_on_assembly IS 'Quando true, o prazo de 20 min de pagamento começa quando o carrinho é montado.';

CREATE OR REPLACE FUNCTION public.orders_mark_cart_assembled()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stage = 'awaiting_confirmation' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'awaiting_confirmation') THEN
    IF NEW.registered_at IS NULL THEN NEW.registered_at := now(); END IF;
    IF NEW.event_id IS NOT NULL AND NEW.payment_window_expires_at IS NULL AND NOT coalesce(NEW.is_paid, false)
       AND EXISTS (SELECT 1 FROM events e WHERE e.id = NEW.event_id AND e.payment_window_on_assembly) THEN
      NEW.payment_window_expires_at := now() + interval '20 minutes';
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;

CREATE TRIGGER trg_orders_mark_cart_assembled BEFORE INSERT OR UPDATE OF stage ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_mark_cart_assembled();

-- Relógio também quando o prazo é empurrado para depois (o overlay troca pelo pedido).
CREATE OR REPLACE TRIGGER trg_overlay_order_events AFTER UPDATE OF is_paid, stage, payment_window_expires_at ON public.orders
FOR EACH ROW WHEN ((new.is_paid IS DISTINCT FROM old.is_paid) OR (new.stage IS DISTINCT FROM old.stage)
  OR (new.payment_window_expires_at IS NOT NULL AND (old.payment_window_expires_at IS NULL OR new.payment_window_expires_at > old.payment_window_expires_at)))
EXECUTE FUNCTION overlay_order_events();

CREATE OR REPLACE FUNCTION public.overlay_order_events()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_handle text; v_product text; v_size text;
BEGIN
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  SELECT ltrim(coalesce(instagram_handle,''),'@') INTO v_handle FROM customers WHERE id = NEW.customer_id;
  v_product := coalesce(NEW.products->0->>'title', NEW.products->0->>'name', 'seu par');
  v_size := coalesce(substring(coalesce(NEW.products->0->>'variant','') from '(\d{2})\s*$'), '');
  IF coalesce(NEW.is_paid,false) AND NOT coalesce(OLD.is_paid,false) THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'paid',
      jsonb_build_object('handle', coalesce(v_handle,''), 'product', v_product, 'order_id', NEW.id));
  END IF;
  IF NEW.stage = 'awaiting_confirmation' AND OLD.stage IS DISTINCT FROM 'awaiting_confirmation' THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'assembled',
      jsonb_build_object('handle', coalesce(v_handle,''), 'product', v_product, 'size', v_size,
        'expires_at', NEW.payment_window_expires_at, 'order_id', NEW.id));
  END IF;
  IF NEW.payment_window_expires_at IS NOT NULL AND NOT coalesce(NEW.is_paid,false)
     AND (OLD.payment_window_expires_at IS NULL OR NEW.payment_window_expires_at > OLD.payment_window_expires_at) THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'timer',
      jsonb_build_object('handle', coalesce(v_handle,''), 'product', v_product, 'size', v_size,
        'expires_at', NEW.payment_window_expires_at, 'order_id', NEW.id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.expire_live_payment_windows()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
  ev record;
  v_secret text;
BEGIN
  -- Aviso no overlay (só lives no ar). has_stock = existe estoque além deste carrinho
  -- (mesma soma de pos_products por código usada na checagem de estoque). Nunca bloqueia.
  BEGIN
    INSERT INTO public.live_overlay_events(event_id, kind, payload)
    SELECT o.event_id, 'expired', jsonb_build_object(
      'handle', ltrim(coalesce(c.instagram_handle,''),'@'),
      'product', coalesce(o.products->0->>'title', o.products->0->>'name', 'par'),
      'size', coalesce(substring(coalesce(o.products->0->>'variant','') from '(\d{2})\s*$'), ''),
      'order_id', o.id,
      'has_stock', coalesce(nullif(o.products->0->>'sku','') IS NOT NULL AND (
          SELECT coalesce(sum(pp.stock),0) FROM public.pos_products pp WHERE pp.barcode = o.products->0->>'sku'
        ) > greatest(1, coalesce(nullif(o.products->0->>'quantity','')::numeric, 1)), false))
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id AND e.live_active_until > now()
      LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE COALESCE(o.is_paid, false) = false
       AND o.payment_window_expires_at IS NOT NULL
       AND o.payment_window_expires_at < now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'overlay expired events failed: %', SQLERRM;
  END;

  -- Vencer o prazo só limpa o relógio: o pedido não é cancelado nem libera estoque.
  UPDATE public.orders
     SET payment_window_expires_at = NULL
   WHERE COALESCE(is_paid, false) = false
     AND payment_window_expires_at IS NOT NULL
     AND payment_window_expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;

  BEGIN
    FOR ev IN
      SELECT id FROM public.events WHERE live_active_until > now() ORDER BY id LIMIT 3
    LOOP
      IF v_secret IS NULL THEN
        SELECT value INTO v_secret FROM public.internal_function_secrets WHERE key = 'cron_secret';
      END IF;
      PERFORM net.http_post(
        url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/instagram-live-sync',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', coalesce(v_secret,'')),
        body := jsonb_build_object('eventId', ev.id),
        timeout_milliseconds := 30000
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'instagram-live-sync dispatch failed: %', SQLERRM;
  END;

  RETURN affected;
END;
$function$;

CREATE OR REPLACE FUNCTION public.raffle_norm_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN length(d3) = 11 THEN '55' || d3 END FROM (
    SELECT CASE WHEN length(d2) = 10 THEN substr(d2,1,2) || '9' || substr(d2,3) ELSE d2 END AS d3 FROM (
      SELECT CASE WHEN d LIKE '55%' THEN substr(d,3) ELSE d END AS d2 FROM (SELECT regexp_replace(coalesce(p,''),'\D','','g') AS d) a) b) c
$$;

-- Regra única do sorteio: usada pela barra do overlay, pela aba Participantes e pelo SORTEAR.
CREATE OR REPLACE FUNCTION public.event_raffle_pool(p_raffle_id uuid)
RETURNS TABLE(phone text, display_name text, order_id uuid, product text, entry_value numeric,
  registration_minutes numeric, payment_minutes numeric, eligible boolean, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
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
        WHEN NOT b.reg_ok THEN CASE WHEN b.reg_min IS NULL THEN 'cadastro não concluído' ELSE 'cadastro em ' || trim_scale(b.reg_min) || ' min' END
        WHEN NOT b.pay_ok THEN CASE WHEN NOT b.paid THEN 'não pagou' WHEN b.pay_min IS NULL THEN 'pagamento sem horário' ELSE 'pagamento em ' || trim_scale(b.pay_min) || ' min' END
        WHEN coalesce(r.min_purchase_value,0) > 0 AND a.aud_val < r.min_purchase_value THEN 'abaixo do valor mínimo'
        WHEN EXISTS (SELECT 1 FROM winners w WHERE w.k = b.k) THEN 'já ganhou outro sorteio'
      END AS why
    FROM best b JOIN agg a ON a.k = b.k
  ), from_leads AS (
    SELECT DISTINCT ON (right(public.raffle_norm_phone(l.phone), 8))
      public.raffle_norm_phone(l.phone) AS ph, coalesce(l.instagram, l.name)::text AS handle,
      CASE WHEN EXISTS (SELECT 1 FROM winners w WHERE w.k = right(public.raffle_norm_phone(l.phone), 8)) THEN 'já ganhou outro sorteio' END AS why
    FROM public.event_leads l
    WHERE r.audience = 'live_leads' AND l.event_id = r.event_id AND NOT coalesce(l.disqualified, false)
      AND public.raffle_norm_phone(l.phone) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM q WHERE q.k = right(public.raffle_norm_phone(l.phone), 8))
    ORDER BY right(public.raffle_norm_phone(l.phone), 8), l.created_at
  )
  SELECT f.ph, f.handle, f.id, f.prod, f.aud_val, f.reg_min, f.pay_min, f.why IS NULL, f.why FROM from_orders f
  UNION ALL
  SELECT l.ph, l.handle, NULL::uuid, NULL::text, 0::numeric, NULL::numeric, NULL::numeric, l.why IS NULL, l.why FROM from_leads l;
END $$;
REVOKE ALL ON FUNCTION public.event_raffle_pool(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_raffle_pool(uuid) TO service_role;

-- Barra do overlay: elegíveis ao vivo do sorteio em rascunho mais recente.
CREATE OR REPLACE FUNCTION public.overlay_raffle_count(p_event_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce((SELECT count(*)::int FROM public.event_raffle_pool(
    (SELECT r.id FROM public.event_raffles r WHERE r.event_id = p_event_id AND r.status = 'draft' ORDER BY r.created_at DESC LIMIT 1)) p
    WHERE p.eligible), 0)
$$;