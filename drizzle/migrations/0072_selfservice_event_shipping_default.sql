CREATE OR REPLACE FUNCTION public.resolve_selfservice_event_shipping(p_order jsonb, p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE subtotal numeric; discount numeric; threshold numeric; fixed numeric;
BEGIN
  IF p_event->>'operation_mode' IS DISTINCT FROM 'whatsapp_autoatendimento'
     OR COALESCE((p_order->>'is_paid')::boolean,false)
     OR COALESCE((p_order->>'paid_externally')::boolean,false)
     OR p_order->>'stage' IN ('cancelled','paid')
     OR COALESCE((p_order->>'is_pickup')::boolean,false)
     OR COALESCE((p_order->>'is_delivery')::boolean,false)
     OR p_order->>'merged_into_order_id' IS NOT NULL
     OR p_order->>'mercadopago_payment_id' IS NOT NULL
     OR p_order->>'pagarme_order_id' IS NOT NULL
     OR p_order->>'appmax_order_id' IS NOT NULL
     OR p_order->>'vindi_transaction_id' IS NOT NULL
     OR p_order->>'austpay_transaction_id' IS NOT NULL THEN RETURN NULL; END IF;
  IF COALESCE((p_order->>'free_shipping')::boolean,false)
     AND COALESCE(p_order->'shipping_info'->>'source','')<>'event_rule' THEN RETURN NULL; END IF;
  IF p_order->>'custom_shipping_cost' IS NOT NULL THEN RETURN NULL; END IF;
  IF COALESCE(p_order->'shipping_info'->>'source','')<>'event_rule'
     AND (COALESCE((p_order->>'shipping_cost')::numeric,0)>0
          OR p_order->'shipping_info' IS NOT NULL AND p_order->'shipping_info'<>'null'::jsonb) THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(COALESCE((p->>'price')::numeric,0)*COALESCE((p->>'quantity')::numeric,1)),0)
    INTO subtotal FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_order->'products')='array' THEN p_order->'products' ELSE '[]'::jsonb END) p;
  IF subtotal<=0 THEN RETURN NULL; END IF;
  discount:=CASE WHEN p_order->>'discount_type'='percentage' THEN subtotal*COALESCE((p_order->>'discount_value')::numeric,0)/100
    WHEN p_order->>'discount_type' IS NOT NULL THEN COALESCE((p_order->>'discount_value')::numeric,0) ELSE 0 END;
  subtotal:=round(GREATEST(0,subtotal-discount),2);
  threshold:=NULLIF(p_event->>'free_shipping_threshold','')::numeric;
  fixed:=NULLIF(p_event->>'default_shipping_cost','')::numeric;
  IF threshold>0 AND subtotal>threshold THEN RETURN jsonb_build_object('shipping_cost',0,'free_shipping',true); END IF;
  IF fixed>0 THEN RETURN jsonb_build_object('shipping_cost',fixed,'free_shipping',false); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.resolve_selfservice_event_shipping(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_selfservice_event_shipping(jsonb,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.apply_selfservice_event_shipping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ev jsonb; resolved jsonb; prior_source text;
BEGIN
  IF COALESCE(NEW.is_paid,false) OR COALESCE(NEW.paid_externally,false) OR NEW.stage IN ('cancelled','paid') THEN RETURN NEW; END IF;
  SELECT jsonb_build_object('operation_mode',operation_mode,'default_shipping_cost',default_shipping_cost,'free_shipping_threshold',free_shipping_threshold)
    INTO ev FROM public.events WHERE id=NEW.event_id;
  IF ev->>'operation_mode' IS DISTINCT FROM 'whatsapp_autoatendimento' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    prior_source:=OLD.shipping_info->>'source';
    -- A staff override must stop the automatic rule, including a manually chosen zero.
    IF prior_source='event_rule' AND NEW.shipping_info IS NOT DISTINCT FROM OLD.shipping_info
       AND (NEW.free_shipping IS DISTINCT FROM OLD.free_shipping OR NEW.shipping_cost IS DISTINCT FROM OLD.shipping_cost) THEN
      IF NEW.free_shipping THEN
        NEW.shipping_info:=jsonb_build_object('source','manual','price',0);
        RETURN NEW;
      ELSIF NEW.shipping_cost IS DISTINCT FROM OLD.shipping_cost THEN
        NEW.shipping_info:=jsonb_build_object('source','manual','price',NEW.shipping_cost);
        RETURN NEW;
      ELSE
        -- Unchecking an automatic exemption returns to the event rule.
        NEW.shipping_info:=NULL;
      END IF;
    END IF;
  END IF;
  resolved:=public.resolve_selfservice_event_shipping(to_jsonb(NEW),ev);
  IF resolved IS NULL THEN RETURN NEW; END IF;
  NEW.shipping_cost:=(resolved->>'shipping_cost')::numeric;
  NEW.free_shipping:=(resolved->>'free_shipping')::boolean;
  IF NEW.shipping_info->>'source' IS DISTINCT FROM 'event_rule'
     OR NEW.shipping_info->'price' IS DISTINCT FROM resolved->'shipping_cost' THEN
    NEW.shipping_info:=jsonb_build_object('source','event_rule','carrier',CASE WHEN NEW.free_shipping THEN 'Frete Grátis (regra do evento)' ELSE 'Frete fixo do evento' END,'price',NEW.shipping_cost);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_selfservice_event_shipping() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_selfservice_event_shipping() TO service_role;
CREATE TRIGGER trg_orders_selfservice_shipping_insert BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.apply_selfservice_event_shipping();
CREATE TRIGGER trg_orders_selfservice_shipping_update
BEFORE UPDATE OF products,discount_type,discount_value,free_shipping,shipping_cost,shipping_info,custom_shipping_cost,is_pickup,is_delivery,event_id ON public.orders
FOR EACH ROW WHEN (OLD.products IS DISTINCT FROM NEW.products OR OLD.discount_type IS DISTINCT FROM NEW.discount_type OR OLD.discount_value IS DISTINCT FROM NEW.discount_value OR OLD.free_shipping IS DISTINCT FROM NEW.free_shipping OR OLD.shipping_cost IS DISTINCT FROM NEW.shipping_cost OR OLD.shipping_info IS DISTINCT FROM NEW.shipping_info OR OLD.custom_shipping_cost IS DISTINCT FROM NEW.custom_shipping_cost OR OLD.is_pickup IS DISTINCT FROM NEW.is_pickup OR OLD.is_delivery IS DISTINCT FROM NEW.is_delivery OR OLD.event_id IS DISTINCT FROM NEW.event_id)
EXECUTE FUNCTION public.apply_selfservice_event_shipping();