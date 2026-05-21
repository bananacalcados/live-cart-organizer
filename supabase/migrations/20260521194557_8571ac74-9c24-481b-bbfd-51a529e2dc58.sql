-- ============================================================================
-- ONDA 0 — Camada de compatibilidade: espelhamento legado → customers_unified
-- ============================================================================

-- ---------- Helpers de normalização (idempotentes) -------------------------

CREATE OR REPLACE FUNCTION public.norm_phone_br(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(raw, '\D', '', 'g');
  IF d IS NULL OR length(d) < 10 THEN RETURN NULL; END IF;
  IF length(d) >= 12 AND left(d, 2) = '55' THEN d := substring(d from 3); END IF;
  IF length(d) = 10 THEN d := left(d, 2) || '9' || substring(d from 3); END IF;
  IF length(d) <> 11 THEN RETURN NULL; END IF;
  RETURN '55' || d;
END $$;

CREATE OR REPLACE FUNCTION public.phone_suffix8(e164 text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN e164 IS NULL THEN NULL ELSE right(e164, 8) END
$$;

CREATE OR REPLACE FUNCTION public.phone_ddd(e164 text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN e164 IS NULL OR length(e164) < 4 THEN NULL ELSE substring(e164 from 3 for 2) END
$$;

CREATE OR REPLACE FUNCTION public.norm_cpf(raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(raw, '\D', '', 'g');
  RETURN CASE WHEN length(d) = 11 THEN d ELSE NULL END;
END $$;

CREATE OR REPLACE FUNCTION public.norm_email(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN raw IS NULL OR btrim(raw) = '' THEN NULL ELSE lower(btrim(raw)) END
$$;

CREATE OR REPLACE FUNCTION public.norm_instagram(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN raw IS NULL OR btrim(raw) = '' THEN NULL
    ELSE lower(btrim(regexp_replace(raw, '^@', '')))
  END
$$;

-- Índice auxiliar para match por suffix8 (não existia)
CREATE INDEX IF NOT EXISTS customers_unified_phone_suffix8_idx
  ON public.customers_unified (phone_suffix8) WHERE phone_suffix8 IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_unified_phone_e164_idx
  ON public.customers_unified (phone_e164) WHERE phone_e164 IS NOT NULL;

-- ---------- Helper central: find_or_create_unified_customer ----------------
-- Cascata: CPF > suffix8+DDD > suffix8 > email > instagram
-- Telefone só sobrescreve se atual estiver NULL (regra do usuário: CPF é rei)

CREATE OR REPLACE FUNCTION public.find_or_create_unified_customer(
  p_cpf       text DEFAULT NULL,
  p_phone     text DEFAULT NULL,
  p_email     text DEFAULT NULL,
  p_instagram text DEFAULT NULL,
  p_ig_user_id text DEFAULT NULL,
  p_name      text DEFAULT NULL,
  p_source    text DEFAULT NULL  -- ex: 'pos:uuid', 'chat:uuid'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cpf      text := norm_cpf(p_cpf);
  v_phone    text := norm_phone_br(p_phone);
  v_suffix   text := phone_suffix8(v_phone);
  v_ddd      text := phone_ddd(v_phone);
  v_email    text := norm_email(p_email);
  v_ig       text := norm_instagram(p_instagram);
  v_id       uuid;
BEGIN
  -- 1) CPF
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

  -- 4) email
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE lower(email) = v_email
     LIMIT 1;
  END IF;

  -- 5) instagram
  IF v_id IS NULL AND v_ig IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE lower(instagram_handle) = v_ig
     LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Atualiza apenas campos vazios; telefone segue regra do usuário
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

  -- Cria novo
  INSERT INTO customers_unified (
    name, cpf, email, phone_e164, phone_suffix8, ddd,
    instagram_handle, instagram_user_id,
    source_origins, last_seen_at
  ) VALUES (
    NULLIF(btrim(COALESCE(p_name, '')), ''),
    v_cpf, v_email, v_phone, v_suffix, v_ddd,
    v_ig, p_ig_user_id,
    CASE WHEN p_source IS NULL THEN '[]'::jsonb ELSE to_jsonb(ARRAY[p_source]) END,
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ---------- Triggers de espelhamento (um por tabela) -----------------------

-- customers (legacy)
CREATE OR REPLACE FUNCTION public.mirror_customers_to_unified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := find_or_create_unified_customer(
    p_phone     => NEW.whatsapp,
    p_instagram => NEW.instagram_handle,
    p_source    => 'customers:' || NEW.id::text
  );
  -- Espelha ban/tags (campos exclusivos dessa tabela)
  UPDATE customers_unified SET
    is_banned  = NEW.is_banned,
    ban_reason = COALESCE(NEW.ban_reason, ban_reason),
    tags       = (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(tags,'{}') || COALESCE(NEW.tags,'{}')) x),
    live_cancellation_count = GREATEST(live_cancellation_count, COALESCE(NEW.live_cancellation_count, 0)),
    updated_at = now()
  WHERE id = v_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_customers ON public.customers;
CREATE TRIGGER trg_mirror_customers
AFTER INSERT OR UPDATE OF instagram_handle, whatsapp, is_banned, ban_reason, tags, live_cancellation_count
ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.mirror_customers_to_unified();

-- pos_customers
CREATE OR REPLACE FUNCTION public.mirror_pos_customers_to_unified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := find_or_create_unified_customer(
    p_cpf    => NEW.cpf,
    p_phone  => NEW.whatsapp,
    p_email  => NEW.email,
    p_name   => NEW.name,
    p_source => 'pos:' || NEW.id::text
  );
  UPDATE customers_unified SET
    birth_date         = COALESCE(birth_date, NULL),
    gender             = COALESCE(NULLIF(gender, ''), NEW.gender),
    cep                = COALESCE(NULLIF(cep, ''), NEW.cep),
    address            = COALESCE(NULLIF(address, ''), NEW.address),
    address_number     = COALESCE(NULLIF(address_number, ''), NEW.address_number),
    complement         = COALESCE(NULLIF(complement, ''), NEW.complement),
    neighborhood       = COALESCE(NULLIF(neighborhood, ''), NEW.neighborhood),
    city               = COALESCE(NULLIF(city, ''), NEW.city),
    state              = COALESCE(NULLIF(state, ''), NEW.state),
    shoe_size          = COALESCE(NULLIF(shoe_size, ''), NEW.shoe_size),
    preferred_style    = COALESCE(NULLIF(preferred_style, ''), NEW.preferred_style),
    age_range          = COALESCE(NULLIF(age_range, ''), NEW.age_range),
    has_children       = COALESCE(has_children, NEW.has_children),
    children_age_range = COALESCE(NULLIF(children_age_range, ''), NEW.children_age_range),
    updated_at         = now()
  WHERE id = v_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_pos_customers ON public.pos_customers;
CREATE TRIGGER trg_mirror_pos_customers
AFTER INSERT OR UPDATE
ON public.pos_customers
FOR EACH ROW EXECUTE FUNCTION public.mirror_pos_customers_to_unified();

-- chat_contacts
CREATE OR REPLACE FUNCTION public.mirror_chat_contacts_to_unified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := find_or_create_unified_customer(
    p_phone  => NEW.phone,
    p_name   => COALESCE(NEW.custom_name, NEW.display_name),
    p_source => 'chat:' || NEW.id::text
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_chat_contacts ON public.chat_contacts;
CREATE TRIGGER trg_mirror_chat_contacts
AFTER INSERT OR UPDATE OF phone, display_name, custom_name, profile_pic_url
ON public.chat_contacts
FOR EACH ROW EXECUTE FUNCTION public.mirror_chat_contacts_to_unified();

-- zoppy_customers
CREATE OR REPLACE FUNCTION public.mirror_zoppy_customers_to_unified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text;
BEGIN
  v_name := btrim(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,''));
  v_id := find_or_create_unified_customer(
    p_phone  => NEW.phone,
    p_email  => NEW.email,
    p_name   => NULLIF(v_name, ''),
    p_source => 'zoppy:' || NEW.id::text
  );
  UPDATE customers_unified SET
    gender            = COALESCE(NULLIF(gender, ''), NEW.gender),
    birth_date        = COALESCE(birth_date, NEW.birth_date::date),
    cep               = COALESCE(NULLIF(cep, ''), NEW.postcode),
    city              = COALESCE(NULLIF(city, ''), NEW.city),
    state             = COALESCE(NULLIF(state, ''), NEW.state),
    rfm_segment       = COALESCE(NEW.rfm_segment, rfm_segment),
    rfm_r             = COALESCE(NEW.rfm_recency_score, rfm_r),
    rfm_f             = COALESCE(NEW.rfm_frequency_score, rfm_f),
    rfm_m             = COALESCE(NEW.rfm_monetary_score, rfm_m),
    rfm_total         = COALESCE(NEW.rfm_total_score, rfm_total),
    region_type       = COALESCE(NULLIF(region_type, ''), NEW.region_type),
    total_orders      = GREATEST(total_orders, COALESCE(NEW.total_orders, 0)),
    total_spent       = GREATEST(total_spent, COALESCE(NEW.total_spent, 0)),
    avg_ticket        = COALESCE(NEW.avg_ticket, avg_ticket),
    first_purchase_at = LEAST(COALESCE(first_purchase_at, NEW.first_purchase_at), COALESCE(NEW.first_purchase_at, first_purchase_at)),
    last_purchase_at  = GREATEST(COALESCE(last_purchase_at, NEW.last_purchase_at), COALESCE(NEW.last_purchase_at, last_purchase_at)),
    updated_at        = now()
  WHERE id = v_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_zoppy_customers ON public.zoppy_customers;
CREATE TRIGGER trg_mirror_zoppy_customers
AFTER INSERT OR UPDATE
ON public.zoppy_customers
FOR EACH ROW EXECUTE FUNCTION public.mirror_zoppy_customers_to_unified();

-- customer_registrations
CREATE OR REPLACE FUNCTION public.mirror_customer_registrations_to_unified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := find_or_create_unified_customer(
    p_cpf    => NEW.cpf,
    p_phone  => NEW.whatsapp,
    p_email  => NEW.email,
    p_name   => NEW.full_name,
    p_source => 'registration:' || NEW.id::text
  );
  UPDATE customers_unified SET
    cep            = COALESCE(NULLIF(cep, ''), NEW.cep),
    address        = COALESCE(NULLIF(address, ''), NEW.address),
    address_number = COALESCE(NULLIF(address_number, ''), NEW.address_number),
    complement     = COALESCE(NULLIF(complement, ''), NEW.complement),
    neighborhood   = COALESCE(NULLIF(neighborhood, ''), NEW.neighborhood),
    city           = COALESCE(NULLIF(city, ''), NEW.city),
    state          = COALESCE(NULLIF(state, ''), NEW.state),
    updated_at     = now()
  WHERE id = v_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_customer_registrations ON public.customer_registrations;
CREATE TRIGGER trg_mirror_customer_registrations
AFTER INSERT OR UPDATE
ON public.customer_registrations
FOR EACH ROW EXECUTE FUNCTION public.mirror_customer_registrations_to_unified();

-- instagram_user_links
CREATE OR REPLACE FUNCTION public.mirror_instagram_links_to_unified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := find_or_create_unified_customer(
    p_instagram  => NEW.username,
    p_ig_user_id => NEW.ig_user_id,
    p_source     => 'ig_link:' || NEW.id::text
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mirror_instagram_links ON public.instagram_user_links;
CREATE TRIGGER trg_mirror_instagram_links
AFTER INSERT OR UPDATE OF username, ig_user_id
ON public.instagram_user_links
FOR EACH ROW EXECUTE FUNCTION public.mirror_instagram_links_to_unified();

-- ---------- Colunas unified_customer_id em loyalty/prizes ------------------

ALTER TABLE public.customer_loyalty_points
  ADD COLUMN IF NOT EXISTS unified_customer_id uuid;

ALTER TABLE public.customer_prizes
  ADD COLUMN IF NOT EXISTS unified_customer_id uuid;

CREATE INDEX IF NOT EXISTS customer_loyalty_points_unified_idx
  ON public.customer_loyalty_points (unified_customer_id);
CREATE INDEX IF NOT EXISTS customer_prizes_unified_idx
  ON public.customer_prizes (unified_customer_id);

-- Backfill: vincula registros existentes pelo telefone (suffix8)
UPDATE public.customer_loyalty_points lp
   SET unified_customer_id = cu.id
  FROM public.customers_unified cu
 WHERE lp.unified_customer_id IS NULL
   AND cu.phone_suffix8 = right(regexp_replace(lp.customer_phone, '\D', '', 'g'), 8)
   AND right(regexp_replace(lp.customer_phone, '\D', '', 'g'), 8) <> '';

UPDATE public.customer_prizes cp
   SET unified_customer_id = cu.id
  FROM public.customers_unified cu
 WHERE cp.unified_customer_id IS NULL
   AND cu.phone_suffix8 = right(regexp_replace(cp.customer_phone, '\D', '', 'g'), 8)
   AND right(regexp_replace(cp.customer_phone, '\D', '', 'g'), 8) <> '';