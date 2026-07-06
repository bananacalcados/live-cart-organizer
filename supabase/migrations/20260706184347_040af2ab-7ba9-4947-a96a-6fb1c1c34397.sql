
-- ═══════════════════════════════════════════════════════════════════════
-- OPÇÃO A — Estancar a duplicação de clientes na matriz unificada.
--
-- Causa raiz: find_or_create_unified_customer NÃO casava pelo identificador
-- estável de origem (source_origins, ex.: 'zoppy:<id>'). Registros só-nome
-- (sem telefone/CPF/email) caíam sempre no INSERT, criando um clone a cada
-- re-sync horário disparado pelo cron sync-pos-shopify-to-rfm via os triggers
-- de mirror (zoppy / chat / pos).
--
-- Correção: adicionar dois passos na cascata de identidade ANTES do INSERT:
--   6) match por source_origins (identidade estável de re-sync)
--   7) match por nome normalizado + DDD (último recurso, regra do usuário)
-- ═══════════════════════════════════════════════════════════════════════

-- Índices para manter os triggers rápidos (busca por origem e por nome+DDD).
CREATE INDEX IF NOT EXISTS idx_customers_unified_source_origins
  ON public.customers_unified USING gin (source_origins);

CREATE INDEX IF NOT EXISTS idx_customers_unified_name_ddd
  ON public.customers_unified (lower(btrim(name)), ddd);

CREATE OR REPLACE FUNCTION public.find_or_create_unified_customer(
  p_cpf text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_instagram text DEFAULT NULL::text,
  p_ig_user_id text DEFAULT NULL::text,
  p_name text DEFAULT NULL::text,
  p_source text DEFAULT NULL::text
)
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

  -- 6) source_origins — identidade ESTÁVEL de re-sync.
  --    Impede que um registro só-nome (sem telefone/CPF/email) seja recriado
  --    a cada execução do mirror. Escolhe o registro mais antigo (o original)
  --    de forma determinística quando já houver clones.
  IF v_id IS NULL AND p_source IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE source_origins ? p_source
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  -- 7) nome normalizado + DDD — último recurso (regra do usuário): quando não
  --    há identidade forte, mas há nome e DDD, evita cadastro duplicado da
  --    mesma pessoa da mesma região.
  IF v_id IS NULL AND v_name IS NOT NULL AND v_ddd IS NOT NULL THEN
    SELECT id INTO v_id FROM customers_unified
     WHERE lower(btrim(name)) = lower(v_name) AND ddd = v_ddd
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Atualiza apenas campos vazios; telefone segue a regra do usuário.
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
