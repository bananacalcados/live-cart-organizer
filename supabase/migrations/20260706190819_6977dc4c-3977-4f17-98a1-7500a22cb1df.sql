-- Detecta e-mails genéricos/placeholder que NÃO servem como identidade de cliente.
CREATE OR REPLACE FUNCTION public.is_generic_email(raw text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN raw IS NULL OR btrim(raw) = '' THEN true
    ELSE (
      -- parte local (antes do @) muito curta é chute/placeholder
      length(split_part(lower(btrim(raw)), '@', 1)) <= 4
      -- domínio interno de fallback nunca identifica pessoa
      OR split_part(lower(btrim(raw)), '@', 2) = 'cliente.bananacalcados.com.br'
      -- padrões de teclado/teste comuns
      OR split_part(lower(btrim(raw)), '@', 1) ~ '^(teste|test|sememail|sememail|noemail|nao|email|cliente|usuario|user|asdf?|qwer?t?y?|abcd?e?|xxx+|aaa+|123+)'
    )
  END
$$;

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

  -- 4) email — SÓ como identidade se NÃO for genérico/placeholder E se ainda
  --    não estiver reutilizado por muitos cadastros (evita mesclar pessoas
  --    distintas que digitaram o mesmo e-mail "lixo").
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

  -- 6) source_origins — identidade ESTÁVEL de re-sync.
  IF v_id IS NULL AND p_source IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE source_origins ? p_source
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  -- 7) nome normalizado + DDD — último recurso (regra do usuário).
  IF v_id IS NULL AND v_name IS NOT NULL AND v_ddd IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE lower(btrim(name)) = lower(v_name) AND ddd = v_ddd
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Atualiza apenas campos vazios; telefone segue a regra do usuário.
    -- E-mail genérico não sobrescreve e-mail já existente.
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
    v_name,
    v_cpf, v_email, v_phone, v_suffix, v_ddd,
    v_ig, p_ig_user_id,
    CASE WHEN p_source IS NULL THEN '[]'::jsonb ELSE to_jsonb(ARRAY[p_source]) END,
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;