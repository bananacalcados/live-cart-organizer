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
    IF OLD.free_shipping AND NOT COALESCE(NEW.free_shipping,false)
       AND NEW.shipping_info IS NOT DISTINCT FROM OLD.shipping_info
       AND NEW.shipping_cost IS NOT DISTINCT FROM OLD.shipping_cost
       AND NEW.custom_shipping_cost IS NULL THEN
      NEW.shipping_info:=NULL;
      NEW.shipping_cost:=0;
    ELSIF prior_source='event_rule' AND NEW.shipping_info IS NOT DISTINCT FROM OLD.shipping_info
       AND (NEW.free_shipping IS DISTINCT FROM OLD.free_shipping OR NEW.shipping_cost IS DISTINCT FROM OLD.shipping_cost) THEN
      IF NEW.free_shipping THEN
        NEW.shipping_info:=jsonb_build_object('source','manual','price',0);
        RETURN NEW;
      ELSIF NEW.shipping_cost IS DISTINCT FROM OLD.shipping_cost THEN
        NEW.shipping_info:=jsonb_build_object('source','manual','price',NEW.shipping_cost);
        RETURN NEW;
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