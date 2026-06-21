CREATE OR REPLACE FUNCTION public.apply_online_order_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_event_channel text;
  v_default_store uuid;
  v_target_store  uuid;
  v_item          jsonb;
  v_sku           text;
  v_qty           numeric;
  v_pp            record;
  v_idem          text;
  v_inserted      uuid;
  v_default_site_store uuid := '04408292-fc70-4f04-822b-349cbd4f6b09'::uuid; -- Site + Centro
  v_shopify_items jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
BEGIN
  -- Apenas quando vira pago
  IF NEW.is_paid IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_paid, false) IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Se for pedido de evento físico, o roteamento POS já cuida da baixa.
  IF NEW.event_id IS NOT NULL THEN
    SELECT channel, default_store_id
      INTO v_event_channel, v_default_store
    FROM public.events
    WHERE id = NEW.event_id;

    IF v_default_store IS NOT NULL
       AND v_event_channel IS DISTINCT FROM 'site' THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Resolve loja de origem
  v_target_store := COALESCE(NEW.pickup_store_id, v_default_site_store);

  IF NEW.products IS NULL OR jsonb_typeof(NEW.products) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(NEW.products, '[]'::jsonb))
  LOOP
    v_sku := COALESCE(v_item->>'sku', v_item->>'SKU');
    v_qty := COALESCE(NULLIF(v_item->>'quantity','')::numeric, 1);

    IF v_sku IS NULL OR v_sku = '' OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- Tenta achar pos_products na loja alvo (pode não existir; ainda registramos o movimento)
    SELECT id, stock, parent_sku, barcode, sku
      INTO v_pp
    FROM public.pos_products
    WHERE sku = v_sku AND store_id = v_target_store
    LIMIT 1;

    v_idem := 'online_order:' || NEW.id::text || ':' || v_sku;

    -- Insere movimento idempotente; se já existe não faz nada
    WITH ins AS (
      INSERT INTO public.stock_movements (
        pos_product_id, store_id, sku, parent_sku,
        movement_type, quantity, reference_type, reference_id,
        idempotency_key, notes
      ) VALUES (
        v_pp.id, v_target_store, v_sku, v_pp.parent_sku,
        'sale', -v_qty, 'online_order', NEW.id::text,
        v_idem,
        'Pedido online pago (canal site / sem evento físico)'
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    )
    SELECT id INTO v_inserted FROM ins;

    -- Só decrementa pos_products se o INSERT foi efetivado (não duplicado)
    IF v_inserted IS NOT NULL AND v_pp.id IS NOT NULL THEN
      UPDATE public.pos_products
         SET stock = stock - v_qty,
             updated_at = now()
       WHERE id = v_pp.id;

      -- Acumula item para espelhar estoque na Shopify (SET absoluto = soma das lojas)
      v_shopify_items := v_shopify_items || jsonb_build_object(
        'barcode', v_pp.barcode,
        'sku',     COALESCE(v_pp.sku, v_sku)
      );
    END IF;

    v_inserted := NULL;
  END LOOP;

  -- Espelha estoque na Shopify (event-driven, idempotente/auto-corretivo)
  IF jsonb_array_length(v_shopify_items) > 0 THEN
    v_payload := jsonb_build_object(
      'sale_id',    NEW.id,
      'sale_event', 'sale',
      'items',      v_shopify_items
    );
    PERFORM net.http_post(
      url     := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/shopify-mirror-stock',
      headers := jsonb_build_object('Content-Type','application/json','apikey', v_anon_key,'Authorization','Bearer '||v_anon_key),
      body    := v_payload
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_online_order_stock_movement failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;