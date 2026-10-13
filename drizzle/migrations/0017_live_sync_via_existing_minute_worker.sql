CREATE OR REPLACE FUNCTION public.expire_live_payment_windows()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
  ev record;
  v_secret text;
BEGIN
  UPDATE public.orders
     SET payment_window_expires_at = NULL
   WHERE COALESCE(is_paid, false) = false
     AND payment_window_expires_at IS NOT NULL
     AND payment_window_expires_at < now();
  GET DIAGNOSTICS affected = ROW_COUNT;

  -- Sincronização de comentários da live (instagram-live-sync) saiu do navegador:
  -- reaproveita este worker de 1 min. Sem live ativa, não faz nada.
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