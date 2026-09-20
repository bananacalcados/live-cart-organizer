
-- 1) Log table
CREATE TABLE IF NOT EXISTS public.pos_sales_reattribution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid,
  old_unified_id uuid,
  new_unified_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pos_sales_reattribution_log TO authenticated;
GRANT ALL ON public.pos_sales_reattribution_log TO service_role;
ALTER TABLE public.pos_sales_reattribution_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read reattribution log" ON public.pos_sales_reattribution_log;
CREATE POLICY "Authenticated can read reattribution log"
  ON public.pos_sales_reattribution_log FOR SELECT TO authenticated USING (true);

-- 2) CORREÇÃO 1 + 4: find_or_create_unified_customer
CREATE OR REPLACE FUNCTION public.find_or_create_unified_customer(p_cpf text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_ig_user_id text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_source text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cpf      text := norm_cpf(p_cpf);
  v_phone    text := norm_phone_br(p_phone);
  v_suffix   text := phone_suffix8(v_phone);
  v_ddd      text := phone_ddd(v_phone);
  v_email    text := norm_email(p_email);
  v_ig       text := norm_instagram(p_instagram);
  v_name     text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_id       uuid;
  v_email_uses integer;
BEGIN
  -- 1) CPF (identidade forte)
  IF v_cpf IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified WHERE cpf = v_cpf LIMIT 1;
  END IF;

  -- 2) suffix8 + DDD
  IF v_id IS NULL AND v_suffix IS NOT NULL AND v_ddd IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE phone_suffix8 = v_suffix AND ddd = v_ddd
     LIMIT 1;
  END IF;

  -- 3) suffix8 puro
  IF v_id IS NULL AND v_suffix IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE phone_suffix8 = v_suffix
     LIMIT 1;
  END IF;

  -- 4) email não genérico e pouco reutilizado
  IF v_id IS NULL AND v_email IS NOT NULL AND NOT is_generic_email(v_email) THEN
    SELECT count(*) INTO v_email_uses FROM customers_unified WHERE lower(email) = v_email;
    IF v_email_uses <= 3 THEN
      SELECT id INTO v_id FROM customers_unified
       WHERE lower(email) = v_email
       ORDER BY created_at ASC
       LIMIT 1;
    END IF;
  END IF;

  -- 5) instagram
  IF v_id IS NULL AND v_ig IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE lower(instagram_handle) = v_ig
     LIMIT 1;
  END IF;

  -- 6) source_origins — SOMENTE identificadores por registro (contêm ':').
  --    Tags genéricas como 'pos-sale' nunca podem casar (colava vendas de
  --    pessoas diferentes no cliente mais antigo com a tag).
  IF v_id IS NULL AND p_source IS NOT NULL AND position(':' in p_source) > 0 THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE source_origins ? p_source
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  -- 7) nome normalizado + DDD — só com nome de 3+ palavras (evita homônimos)
  IF v_id IS NULL AND v_name IS NOT NULL AND v_ddd IS NOT NULL
     AND array_length(regexp_split_to_array(btrim(v_name), '\s+'), 1) >= 3 THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE lower(btrim(name)) = lower(v_name) AND ddd = v_ddd
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE customers_unified SET
      name              = COALESCE(NULLIF(name, ''), p_name),
      cpf               = COALESCE(cpf, v_cpf),
      email             = COALESCE(NULLIF(email, ''), v_email),
      phone_e164        = COALESCE(phone_e164, v_phone),
      phone_suffix8     = COALESCE(phone_suffix8, v_suffix),
      ddd               = COALESCE(ddd, v_ddd),
      instagram_handle  = COALESCE(NULLIF(instagram_handle, ''), v_ig),
      instagram_user_id = COALESCE(instagram_user_id, p_ig_user_id),
      source_origins    = CASE
        WHEN p_source IS NOT NULL AND NOT (source_origins ? p_source)
          THEN source_origins || to_jsonb(p_source)
        ELSE source_origins
      END,
      last_seen_at      = now(),
      updated_at        = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO customers_unified (
    name, cpf, email, phone_e164, phone_suffix8, ddd,
    instagram_handle, instagram_user_id,
    source_origins, last_seen_at
  ) VALUES (
    v_name,
    v_cpf, v_email, v_phone, v_suffix, v_ddd,
    v_ig, p_ig_user_id,
    CASE WHEN p_source IS NULL THEN '[]'::jsonb ELSE to_jsonb(ARRAY[p_source]) END,
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- 3) CORREÇÃO 2: trigger de sync
CREATE OR REPLACE FUNCTION public.trg_pos_sales_sync_customer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_c record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.customer_unified_id IS NOT NULL THEN
      PERFORM public.recalc_customer_metrics(OLD.customer_unified_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.customer_unified_id IS NULL
     AND (NEW.customer_phone IS NOT NULL OR NEW.customer_cpf IS NOT NULL OR NEW.customer_email IS NOT NULL) THEN
    v_uid := public.find_or_create_unified_customer(
      p_cpf    => NEW.customer_cpf,
      p_phone  => NEW.customer_phone,
      p_email  => NEW.customer_email,
      p_name   => NEW.customer_name,
      p_source => 'pos-sale:' || NEW.id::text
    );
    IF v_uid IS NOT NULL THEN
      NEW.customer_unified_id := v_uid;
    END IF;
  END IF;

  -- Fallback: venda sem contato próprio, mas com cliente cadastrado no PDV
  IF NEW.customer_unified_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT cpf, whatsapp, email, name INTO v_c
      FROM public.pos_customers WHERE id = NEW.customer_id;
    IF FOUND AND (v_c.cpf IS NOT NULL OR v_c.whatsapp IS NOT NULL OR v_c.email IS NOT NULL) THEN
      v_uid := public.find_or_create_unified_customer(
        p_cpf    => v_c.cpf,
        p_phone  => v_c.whatsapp,
        p_email  => v_c.email,
        p_name   => COALESCE(NEW.customer_name, v_c.name),
        p_source => 'pos:' || NEW.customer_id::text
      );
      IF v_uid IS NOT NULL THEN
        NEW.customer_unified_id := v_uid;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
