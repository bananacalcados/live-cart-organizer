CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.livete_ig_initial_dm_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  pg_net_request_id bigint,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.livete_ig_initial_dm_log TO authenticated;
GRANT ALL ON public.livete_ig_initial_dm_log TO service_role;

ALTER TABLE public.livete_ig_initial_dm_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view livete ig dm logs"
ON public.livete_ig_initial_dm_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.trigger_livete_ig_initial_dm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_has_ig boolean;
  v_automation_enabled boolean;
  v_supabase_url text;
  v_service_key text;
  v_request_id bigint;
BEGIN
  IF NEW.stage <> 'awaiting_confirmation' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;

  IF NEW.event_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (COALESCE(c.instagram_handle, '') <> '') INTO v_has_ig
  FROM public.customers c
  WHERE c.id = NEW.customer_id;

  IF NOT COALESCE(v_has_ig, false) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(e.automation_enabled, false) INTO v_automation_enabled
  FROM public.events e
  WHERE e.id = NEW.event_id;

  IF NOT COALESCE(v_automation_enabled, false) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.livete_ig_initial_dm_log (order_id, status)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (order_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_supabase_url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co';
  v_service_key := current_setting('app.settings.service_role_key', true);

  IF v_service_key IS NULL OR v_service_key = '' THEN
    UPDATE public.livete_ig_initial_dm_log
    SET status = 'error',
        error_message = 'service_role_key not set in db settings'
    WHERE order_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT extensions.net.http_post(
    url := v_supabase_url || '/functions/v1/livete-start-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'orderId', NEW.id::text,
      'forceInstagram', true,
      'keepStage', true,
      'source', 'db_trigger_awaiting_confirmation'
    )
  ) INTO v_request_id;

  UPDATE public.livete_ig_initial_dm_log
  SET pg_net_request_id = v_request_id
  WHERE order_id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trigger_livete_ig_initial_dm] error: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_livete_ig_initial_dm ON public.orders;
CREATE TRIGGER trg_livete_ig_initial_dm
AFTER INSERT OR UPDATE OF stage ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trigger_livete_ig_initial_dm();