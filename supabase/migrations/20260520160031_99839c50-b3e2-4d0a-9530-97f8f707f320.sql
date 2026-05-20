-- 1) FIX da trigger online/Live (orders) — mesmo bug schema "extensions.net" → "net"
CREATE OR REPLACE FUNCTION public.trigger_meta_capi_purchase_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'vault'
AS $$
DECLARE
  v_should_send boolean := false;
  v_supabase_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co';
  v_total numeric := 0;
  v_request_id bigint;
  v_event_id text;
  v_is_now_paid boolean;
  v_was_paid boolean;
BEGIN
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.meta_capi_purchase_sent_at IS NOT NULL THEN RETURN NEW; END IF;

  v_is_now_paid := (NEW.stage = 'paid')
                   OR COALESCE(NEW.is_paid, false)
                   OR COALESCE(NEW.paid_externally, false);

  IF NOT v_is_now_paid THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_should_send := true;
  ELSE
    v_was_paid := (COALESCE(OLD.stage,'') = 'paid')
                  OR COALESCE(OLD.is_paid, false)
                  OR COALESCE(OLD.paid_externally, false);
    IF NOT v_was_paid THEN v_should_send := true; END IF;
  END IF;

  IF NOT v_should_send THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM((item->>'price')::numeric * (item->>'quantity')::numeric), 0)
    INTO v_total
  FROM jsonb_array_elements(COALESCE(NEW.products, '[]'::jsonb)) AS item;

  IF NEW.discount_type = 'fixed' THEN
    v_total := v_total - COALESCE(NEW.discount_value, 0);
  ELSIF NEW.discount_type = 'percentage' THEN
    v_total := v_total - ROUND(v_total * COALESCE(NEW.discount_value, 0) / 100, 2);
  END IF;

  IF NOT COALESCE(NEW.free_shipping, false) THEN
    v_total := v_total + COALESCE(NEW.shipping_cost, 0);
  END IF;

  IF v_total <= 0 THEN RETURN NEW; END IF;

  v_event_id := 'purchase_order_' || NEW.id::text;

  -- FIX: net.http_post (não extensions.net.http_post)
  SELECT net.http_post(
    url := v_supabase_url || '/functions/v1/meta-capi-event',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'event_name', 'Purchase',
      'event_id',   v_event_id,
      'order_id',   NEW.id::text,
      'value',      v_total,
      'currency',   'BRL',
      'action_source', 'website'
    )
  ) INTO v_request_id;

  NEW.meta_capi_purchase_sent_at := now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trigger_meta_capi_purchase_on_paid] error for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- 2) BACKFILL PDV OFFLINE — vendas físicas desde 24/04 sem log "sent/pending"
DO $$
DECLARE
  v_internal_secret text;
  r record;
  v_req bigint;
  v_count int := 0;
BEGIN
  SELECT decrypted_secret INTO v_internal_secret
  FROM vault.decrypted_secrets WHERE name = 'meta_capi_internal_secret' LIMIT 1;

  IF v_internal_secret IS NULL OR v_internal_secret = 'PLACEHOLDER_REPLACE_ME' THEN
    RAISE NOTICE 'meta_capi_internal_secret not configured — skipping PDV backfill';
    RETURN;
  END IF;

  FOR r IN
    SELECT id FROM public.pos_sales
    WHERE created_at > '2026-04-24'
      AND status IN ('paid','completed','pending_sync','pending_pickup')
      AND id NOT IN (
        SELECT sale_id FROM public.meta_capi_offline_log
        WHERE event_name='Purchase' AND status IN ('sent','pending')
      )
    ORDER BY created_at ASC
    LIMIT 1000
  LOOP
    SELECT net.http_post(
      url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/meta-capi-offline',
      headers := jsonb_build_object('Content-Type','application/json','X-Internal-Secret', v_internal_secret),
      body := jsonb_build_object('sale_id', r.id::text, 'source', 'backfill_2026_05_20')
    ) INTO v_req;

    INSERT INTO public.meta_capi_offline_log (sale_id, event_name, event_id, dataset_id, status, payload_summary)
    VALUES (r.id, 'Purchase', 'pending_' || r.id::text, '1346445220878187', 'pending',
            jsonb_build_object('pg_net_request_id', v_req, 'triggered_at', now(), 'source','backfill'))
    ON CONFLICT (sale_id, event_name) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'PDV offline backfill: % vendas enfileiradas', v_count;
END $$;

-- 3) BACKFILL ONLINE/LIVE — orders pagos desde 24/04 sem meta_capi_purchase_sent_at
DO $$
DECLARE
  r record;
  v_req bigint;
  v_total numeric;
  v_event_id text;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT id, products, discount_type, discount_value, free_shipping, shipping_cost
    FROM public.orders
    WHERE created_at > '2026-04-24'
      AND event_id IS NOT NULL
      AND (stage='paid' OR is_paid=true OR paid_externally=true)
      AND meta_capi_purchase_sent_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1000
  LOOP
    SELECT COALESCE(SUM((item->>'price')::numeric * (item->>'quantity')::numeric), 0)
      INTO v_total
    FROM jsonb_array_elements(COALESCE(r.products, '[]'::jsonb)) AS item;

    IF r.discount_type = 'fixed' THEN
      v_total := v_total - COALESCE(r.discount_value, 0);
    ELSIF r.discount_type = 'percentage' THEN
      v_total := v_total - ROUND(v_total * COALESCE(r.discount_value, 0) / 100, 2);
    END IF;

    IF NOT COALESCE(r.free_shipping, false) THEN
      v_total := v_total + COALESCE(r.shipping_cost, 0);
    END IF;

    IF v_total <= 0 THEN CONTINUE; END IF;

    v_event_id := 'purchase_order_' || r.id::text;

    SELECT net.http_post(
      url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/meta-capi-event',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object(
        'event_name','Purchase',
        'event_id', v_event_id,
        'order_id', r.id::text,
        'value', v_total,
        'currency','BRL',
        'action_source','website'
      )
    ) INTO v_req;

    UPDATE public.orders SET meta_capi_purchase_sent_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Online/Live purchase backfill: % orders enfileirados', v_count;
END $$;