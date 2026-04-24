
-- 1) Habilita pg_net (necessário pra trigger chamar edge function de forma assíncrona)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2) Tabela de log de envios (idempotência + auditoria)
CREATE TABLE IF NOT EXISTS public.meta_capi_offline_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  event_name text NOT NULL DEFAULT 'Purchase',
  event_id text NOT NULL,
  dataset_id text NOT NULL,
  test_event_code text,
  status text NOT NULL DEFAULT 'pending',
  http_status int,
  meta_response jsonb,
  error_message text,
  payload_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT meta_capi_offline_log_unique_sale_event UNIQUE (sale_id, event_name)
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_offline_log_sale_id ON public.meta_capi_offline_log(sale_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_offline_log_created_at ON public.meta_capi_offline_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_capi_offline_log_status ON public.meta_capi_offline_log(status);

-- 3) RLS — só admin pode ver os logs
ALTER TABLE public.meta_capi_offline_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view meta capi offline logs"
ON public.meta_capi_offline_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Service role tem acesso total automático (bypassa RLS); não precisa policy de INSERT/UPDATE.

-- 4) Função que dispara a edge function via pg_net
CREATE OR REPLACE FUNCTION public.trigger_meta_capi_offline_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_should_send boolean := false;
  v_supabase_url text;
  v_service_key text;
  v_request_id bigint;
BEGIN
  -- Status que indicam venda concluída (qualquer um dispara)
  IF NEW.status IN ('paid', 'completed', 'pending_sync', 'pending_pickup') THEN
    -- Só dispara se houve mudança de estado pra essa lista (não dispara em UPDATEs irrelevantes)
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

  -- Verifica se já foi enviado (idempotência adicional além do UNIQUE constraint)
  IF EXISTS (
    SELECT 1 FROM public.meta_capi_offline_log
    WHERE sale_id = NEW.id AND event_name = 'Purchase' AND status IN ('sent', 'pending')
  ) THEN
    RETURN NEW;
  END IF;

  v_supabase_url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co';
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- Se a config não existir, fallback: tenta variável vault (não bloqueia)
  IF v_service_key IS NULL OR v_service_key = '' THEN
    -- Sem service key configurada no DB; a edge function tem que ser chamada de outro jeito.
    -- Loga como erro pra debug.
    INSERT INTO public.meta_capi_offline_log (sale_id, event_name, event_id, dataset_id, status, error_message)
    VALUES (NEW.id, 'Purchase', 'pending_' || NEW.id::text, '1346445220878187', 'error',
            'service_role_key not set in db settings — configure ALTER DATABASE ... SET app.settings.service_role_key')
    ON CONFLICT (sale_id, event_name) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Dispara HTTP POST assíncrono via pg_net (não bloqueia)
  SELECT extensions.net.http_post(
    url := v_supabase_url || '/functions/v1/meta-capi-offline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('sale_id', NEW.id::text, 'source', 'db_trigger')
  ) INTO v_request_id;

  -- Marca como pending pra evitar disparos duplicados
  INSERT INTO public.meta_capi_offline_log (sale_id, event_name, event_id, dataset_id, status, payload_summary)
  VALUES (NEW.id, 'Purchase', 'pending_' || NEW.id::text, '1346445220878187', 'pending',
          jsonb_build_object('pg_net_request_id', v_request_id, 'triggered_at', now()))
  ON CONFLICT (sale_id, event_name) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca quebrar a transação da venda por erro de envio
  RAISE WARNING '[trigger_meta_capi_offline_purchase] error: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 5) Trigger na tabela pos_sales
DROP TRIGGER IF EXISTS trg_meta_capi_offline_purchase ON public.pos_sales;
CREATE TRIGGER trg_meta_capi_offline_purchase
AFTER INSERT OR UPDATE OF status ON public.pos_sales
FOR EACH ROW
EXECUTE FUNCTION public.trigger_meta_capi_offline_purchase();
