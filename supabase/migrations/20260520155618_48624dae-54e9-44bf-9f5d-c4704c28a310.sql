CREATE OR REPLACE FUNCTION public.trigger_meta_capi_offline_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'vault'
AS $function$
DECLARE
  v_should_send boolean := false;
  v_supabase_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co';
  v_internal_secret text;
  v_request_id bigint;
BEGIN
  IF NEW.status IN ('paid', 'completed', 'pending_sync', 'pending_pickup') THEN
    IF TG_OP = 'INSERT' THEN
      v_should_send := true;
    ELSIF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status)
          AND COALESCE(OLD.status, '') NOT IN ('paid', 'completed', 'pending_sync', 'pending_pickup') THEN
      v_should_send := true;
    END IF;
  END IF;

  IF NOT v_should_send THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.meta_capi_offline_log
    WHERE sale_id = NEW.id AND event_name = 'Purchase' AND status IN ('sent', 'pending')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_internal_secret
  FROM vault.decrypted_secrets
  WHERE name = 'meta_capi_internal_secret'
  LIMIT 1;

  IF v_internal_secret IS NULL OR v_internal_secret = '' OR v_internal_secret = 'PLACEHOLDER_REPLACE_ME' THEN
    INSERT INTO public.meta_capi_offline_log (sale_id, event_name, event_id, dataset_id, status, error_message)
    VALUES (NEW.id, 'Purchase', 'pending_' || NEW.id::text, '1346445220878187', 'error',
            'meta_capi_internal_secret not set in vault')
    ON CONFLICT (sale_id, event_name) DO NOTHING;
    RETURN NEW;
  END IF;

  -- FIX: usar net.http_post (extensão pg_net está no schema "net", não "extensions.net")
  SELECT net.http_post(
    url := v_supabase_url || '/functions/v1/meta-capi-offline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', v_internal_secret
    ),
    body := jsonb_build_object('sale_id', NEW.id::text, 'source', 'db_trigger')
  ) INTO v_request_id;

  INSERT INTO public.meta_capi_offline_log (sale_id, event_name, event_id, dataset_id, status, payload_summary)
  VALUES (NEW.id, 'Purchase', 'pending_' || NEW.id::text, '1346445220878187', 'pending',
          jsonb_build_object('pg_net_request_id', v_request_id, 'triggered_at', now()))
  ON CONFLICT (sale_id, event_name) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Loga o erro real em meta_capi_offline_log pra não ficar invisível
  INSERT INTO public.meta_capi_offline_log (sale_id, event_name, event_id, dataset_id, status, error_message)
  VALUES (NEW.id, 'Purchase', 'pending_' || NEW.id::text, '1346445220878187', 'error',
          'trigger error: ' || SQLERRM)
  ON CONFLICT (sale_id, event_name) DO NOTHING;
  RAISE WARNING '[trigger_meta_capi_offline_purchase] error: %', SQLERRM;
  RETURN NEW;
END;
$function$;