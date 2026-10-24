CREATE OR REPLACE FUNCTION public.selfservice_notify_late_order(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE secret text; worker_url text;
BEGIN
 IF selfservice_access_for_order(p_order_id) IS NULL THEN RETURN; END IF;
 SELECT value INTO secret FROM internal_function_secrets WHERE key='cron_secret';
 SELECT coalesce(value->>'url',value #>> '{}') INTO worker_url FROM app_settings WHERE key='selfservice_queue_worker_url';
 IF secret IS NULL OR worker_url IS NULL THEN RETURN; END IF;
 PERFORM net.http_post(url:=replace(worker_url,'selfservice-message-worker','live-selfservice'),headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),body:=jsonb_build_object('action','send_cart','orderId',p_order_id));
END $$;