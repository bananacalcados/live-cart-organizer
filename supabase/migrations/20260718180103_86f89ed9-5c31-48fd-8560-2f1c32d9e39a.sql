
CREATE OR REPLACE FUNCTION public.trg_blocked_buyer_sale_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_digits text;
  v_key text;
  v_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/blocked-buyer-sale-alert';
  v_store_name text;
  v_seller_name text;
BEGIN
  v_digits := regexp_replace(coalesce(NEW.customer_phone,''), '\D', '', 'g');
  IF v_digits = '' THEN RETURN NEW; END IF;

  -- Normaliza: remove DDI 55 se presente (12 ou 13 dígitos)
  IF left(v_digits,2) = '55' AND char_length(v_digits) IN (12,13) THEN
    v_digits := substring(v_digits from 3);
  END IF;

  -- Chave DDD (2) + últimos 8 dígitos (ignora 9º dígito)
  IF char_length(v_digits) IN (10,11) THEN
    v_key := substring(v_digits from 1 for 2) || right(v_digits, 8);
  ELSE
    v_key := right(v_digits, 8);
  END IF;

  -- Alvo: 5514997087469 -> DDD 14 + 97087469 = '1497087469'
  IF v_key NOT IN ('1497087469', '97087469') THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_store_name FROM public.pos_stores WHERE id = NEW.store_id;
  SELECT name INTO v_seller_name FROM public.pos_sellers WHERE id = NEW.seller_id;

  PERFORM extensions.net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object(
      'sale_id', NEW.id::text,
      'customer_name', NEW.customer_name,
      'customer_phone', NEW.customer_phone,
      'total', NEW.total,
      'store_name', v_store_name,
      'seller_name', v_seller_name
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[trg_blocked_buyer_sale_alert] error for sale %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blocked_buyer_sale_alert ON public.pos_sales;
CREATE TRIGGER trg_blocked_buyer_sale_alert
AFTER INSERT ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.trg_blocked_buyer_sale_alert();
