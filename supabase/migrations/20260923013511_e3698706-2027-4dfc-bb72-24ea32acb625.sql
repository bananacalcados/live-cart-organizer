ALTER TABLE public.shipment_simulations ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.shipment_simulations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shipment_simulations_merged ON public.shipment_simulations(merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_shipment_tracking_for_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fulfillment TEXT;
  v_master public.shipment_simulations%ROWTYPE;
  v_phone TEXT;
BEGIN
  IF NEW.status NOT IN ('paid', 'completed') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status_cancelamento::text, 'ativo') <> 'ativo' THEN
    RETURN NEW;
  END IF;
  -- somente vendas online
  IF COALESCE(NEW.sales_channel, 'presencial') NOT IN ('site', 'live', 'link_online', 'whatsapp') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_simulations WHERE sale_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_fulfillment := CASE WHEN COALESCE(NEW.is_store_pickup, false) THEN 'pickup' ELSE 'carrier' END;
  v_phone := regexp_replace(COALESCE(NEW.customer_phone, ''), '\D', '', 'g');

  -- reaproveita o envio em aberto do mesmo cliente (envio unificado)
  IF length(v_phone) >= 8 THEN
    SELECT * INTO v_master
      FROM public.shipment_simulations s
     WHERE s.kind = 'order'
       AND s.merged_into_id IS NULL
       AND s.real_tracking_code IS NULL
       AND s.delivered_at IS NULL
       AND COALESCE(s.fulfillment, 'carrier') = v_fulfillment
       AND s.created_at > now() - interval '7 days'
       AND right(regexp_replace(COALESCE(s.customer_phone, ''), '\D', '', 'g'), 8) = right(v_phone, 8)
     ORDER BY s.created_at DESC
     LIMIT 1;
  END IF;

  INSERT INTO public.shipment_simulations (
    tracking_code, sale_id, kind, fulfillment, stage, stage_started_at,
    customer_name, customer_phone, order_reference,
    destination_city, destination_state, posted_at, status, merged_into_id
  ) VALUES (
    public.gen_shipment_public_code(), NEW.id, 'order', v_fulfillment, 'em_separacao', now(),
    NEW.customer_name, NEW.customer_phone, upper(substr(NEW.id::text, 1, 8)),
    NEW.customer_city, NEW.customer_state, now(), 'active', v_master.id
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;