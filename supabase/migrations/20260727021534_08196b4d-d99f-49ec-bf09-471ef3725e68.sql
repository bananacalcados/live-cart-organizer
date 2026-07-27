CREATE OR REPLACE FUNCTION public.trigger_meta_capi_offline_enrich_resend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net', 'vault'
AS $function$
DECLARE
  v_supabase_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co';
  v_internal_secret text;
  v_request_id bigint;
  v_log record;
  v_gained boolean := false;
BEGIN
  -- Só vendas pagas e recentes (janela de aceite da Meta)
  IF NEW.status NOT IN ('paid','completed','pending_sync','pending_pickup') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.paid_at, NEW.created_at) < now() - interval '60 days' THEN
    RETURN NEW;
  END IF;

  -- Ganhou algum identificador novo? (Expedição preencheu ficha do PIX avulso)
  v_gained := (COALESCE(OLD.customer_cpf,'') = '' AND COALESCE(NEW.customer_cpf,'') <> '')
           OR (COALESCE(OLD.customer_email,'') = '' AND COALESCE(NEW.customer_email,'') <> '')
           OR (COALESCE(OLD.customer_cep,'') = '' AND COALESCE(NEW.customer_cep,'') <> '')
           OR (COALESCE(OLD.customer_phone,'') = '' AND COALESCE(NEW.customer_phone,'') <> '')
           OR (COALESCE(OLD.customer_name,'') = '' AND COALESCE(NEW.customer_name,'') <> '');

  IF NOT v_gained THEN RETURN NEW; END IF;

  SELECT * INTO v_log FROM public.meta_capi_offline_log
   WHERE sale_id = NEW.id AND event_name = 'Purchase'
   LIMIT 1;

  -- Só reenvia se já houve um envio e ainda não houve reenvio enriquecido
  IF v_log IS NULL OR v_log.status <> 'sent' THEN RETURN NEW; END IF;
  IF COALESCE(v_log.payload_summary->>'enriched_resend_at','') <> '' THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_internal_secret
  FROM vault.decrypted_secrets WHERE name = 'meta_capi_internal_secret' LIMIT 1;

  IF v_internal_secret IS NULL OR v_internal_secret = '' OR v_internal_secret = 'PLACEHOLDER_REPLACE_ME' THEN
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := v_supabase_url || '/functions/v1/meta-capi-offline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', v_internal_secret
    ),
    body := jsonb_build_object('sale_id', NEW.id::text, 'force', true, 'source', 'expedition_enrichment')
  ) INTO v_request_id;

  UPDATE public.meta_capi_offline_log
     SET payload_summary = COALESCE(payload_summary,'{}'::jsonb)
         || jsonb_build_object('enriched_resend_at', now(), 'enriched_request_id', v_request_id)
   WHERE sale_id = NEW.id AND event_name = 'Purchase';

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trigger_meta_capi_offline_enrich_resend] error for sale %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_meta_capi_offline_enrich_resend ON public.pos_sales;
CREATE TRIGGER trg_meta_capi_offline_enrich_resend
AFTER UPDATE OF customer_name, customer_phone, customer_cpf, customer_email, customer_cep
ON public.pos_sales
FOR EACH ROW
EXECUTE FUNCTION public.trigger_meta_capi_offline_enrich_resend();