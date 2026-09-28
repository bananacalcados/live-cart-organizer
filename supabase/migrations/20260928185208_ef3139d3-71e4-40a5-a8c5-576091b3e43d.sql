CREATE OR REPLACE FUNCTION public.wake_ig_live_cart_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/ig-live-cart-notify',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from internal_function_secrets where key='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.wake_ig_live_cart_notify() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_wake_ig_live_cart_notify ON public.ig_live_cart_notifications;
CREATE TRIGGER trg_wake_ig_live_cart_notify AFTER INSERT ON public.ig_live_cart_notifications
FOR EACH STATEMENT EXECUTE FUNCTION public.wake_ig_live_cart_notify();