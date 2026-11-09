ALTER TABLE public.shipment_simulations
  ADD COLUMN IF NOT EXISTS delivery_estimate jsonb;
COMMENT ON COLUMN public.shipment_simulations.delivery_estimate IS 'Previsão pública mínima: estimated por cotação de CEP; confirmed pelo prazo estruturado da expedição. Nunca contém CEP, transportadora ou código real.';

CREATE OR REPLACE FUNCTION public.shipment_delivery_range(p_base timestamptz, p_days text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_match text[];
  v_min integer;
  v_max integer;
  v_base date;
BEGIN
  IF p_base IS NULL OR p_days IS NULL THEN RETURN NULL; END IF;
  v_match := regexp_match(trim(p_days), '^(\d{1,3})(?:\s*(?:-|a|ate|até)\s*(\d{1,3}))?(?:\s*dias?(?:\s*úteis)?)?$', 'i');
  IF v_match IS NULL THEN RETURN NULL; END IF;
  v_min := v_match[1]::integer;
  v_max := coalesce(v_match[2], v_match[1])::integer;
  IF v_min < 0 OR v_max < v_min OR v_max > 60 THEN RETURN NULL; END IF;
  v_base := (p_base AT TIME ZONE 'America/Sao_Paulo')::date;
  WHILE extract(dow FROM v_base) IN (0, 6) LOOP
    v_base := v_base + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'version', 1,
    'kind', 'confirmed',
    'start', public.add_business_days(v_base, v_min),
    'end', public.add_business_days(v_base, v_max),
    'delivery_days_min', v_min,
    'delivery_days_max', v_max,
    'calendar', 'mon_fri'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.shipment_delivery_range(timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shipment_delivery_range(timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.shipment_delivery_confirmed_on_tracking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days text;
  v_base timestamptz;
  v_estimate jsonb;
BEGIN
  SELECT p.delivery_days INTO v_days FROM public.pos_sales p WHERE p.id = NEW.sale_id;
  v_base := coalesce(nullif(NEW.stage_history->>'enviado','')::timestamptz, now());
  v_estimate := public.shipment_delivery_range(v_base, v_days);
  IF v_estimate IS NOT NULL THEN NEW.delivery_estimate := v_estimate; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.shipment_delivery_confirmed_on_tracking() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_shipment_delivery_confirmed
BEFORE UPDATE OF real_tracking_code, stage_history ON public.shipment_simulations
FOR EACH ROW
WHEN (
  NEW.real_tracking_code IS NOT NULL
  AND (
    OLD.real_tracking_code IS DISTINCT FROM NEW.real_tracking_code
    OR OLD.stage_history IS DISTINCT FROM NEW.stage_history
  )
)
EXECUTE FUNCTION public.shipment_delivery_confirmed_on_tracking();

CREATE OR REPLACE FUNCTION public.sync_shipment_delivery_from_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.shipment_simulations s
  SET delivery_estimate = public.shipment_delivery_range(
    coalesce(nullif(s.stage_history->>'enviado','')::timestamptz, NEW.shipped_at, NEW.expedition_finished_at, now()),
    NEW.delivery_days
  )
  WHERE s.sale_id = NEW.id
    AND s.real_tracking_code IS NOT NULL
    AND public.shipment_delivery_range(
      coalesce(nullif(s.stage_history->>'enviado','')::timestamptz, NEW.shipped_at, NEW.expedition_finished_at, now()),
      NEW.delivery_days
    ) IS NOT NULL
    AND s.delivery_estimate IS DISTINCT FROM public.shipment_delivery_range(
      coalesce(nullif(s.stage_history->>'enviado','')::timestamptz, NEW.shipped_at, NEW.expedition_finished_at, now()),
      NEW.delivery_days
    );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_shipment_delivery_from_sale() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_sync_shipment_delivery_from_sale
AFTER UPDATE OF delivery_days, tracking_code ON public.pos_sales
FOR EACH ROW
WHEN (
  OLD.delivery_days IS DISTINCT FROM NEW.delivery_days
  OR OLD.tracking_code IS DISTINCT FROM NEW.tracking_code
)
EXECUTE FUNCTION public.sync_shipment_delivery_from_sale();

UPDATE public.shipment_simulations s
SET delivery_estimate = public.shipment_delivery_range(
  nullif(s.stage_history->>'enviado','')::timestamptz,
  p.delivery_days
)
FROM public.pos_sales p
WHERE p.id = s.sale_id
  AND s.real_tracking_code IS NOT NULL
  AND s.delivery_estimate IS NULL
  AND nullif(s.stage_history->>'enviado','') IS NOT NULL
  AND public.shipment_delivery_range(nullif(s.stage_history->>'enviado','')::timestamptz, p.delivery_days) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_shipment_delivery_estimate(p_shipment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT replace(value->>'url','selfservice-message-worker','shipment-delivery-estimate')
  INTO v_url FROM public.app_settings WHERE key = 'selfservice_queue_worker_url';
  SELECT value INTO v_secret FROM public.internal_function_secrets WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[delivery-estimate] configuração interna ausente para %', p_shipment_id;
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    body := jsonb_build_object('shipment_id',p_shipment_id),
    timeout_milliseconds := 55000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[delivery-estimate] não foi possível agendar %: %', p_shipment_id, SQLERRM;
END;
$function$;
REVOKE ALL ON FUNCTION public.request_shipment_delivery_estimate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_shipment_delivery_estimate(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_shipment_delivery_estimate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.request_shipment_delivery_estimate(NEW.id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.queue_shipment_delivery_estimate() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_queue_shipment_delivery_estimate
AFTER INSERT ON public.shipment_simulations
FOR EACH ROW
WHEN (
  NEW.kind = 'order'
  AND NEW.merged_into_id IS NULL
  AND NEW.real_tracking_code IS NULL
  AND NEW.fulfillment = 'carrier'
)
EXECUTE FUNCTION public.queue_shipment_delivery_estimate();