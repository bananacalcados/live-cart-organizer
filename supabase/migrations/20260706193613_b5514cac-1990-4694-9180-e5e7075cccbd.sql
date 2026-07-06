CREATE OR REPLACE FUNCTION public.unify_upsert_customers(p_records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec           jsonb;
  v_id          uuid;
  v_phone       text;
  v_pdigits     text;
  v_has_phone   boolean;
  v_cpf         text;
  v_email       text;
  v_ig          text;
  v_origins     jsonb;
  v_first       text;
  v_tags_in     text[];
  result        jsonb := '[]'::jsonb;
BEGIN
  FOR rec IN SELECT value FROM jsonb_array_elements(COALESCE(p_records, '[]'::jsonb))
  LOOP
    v_cpf     := NULLIF(rec->>'cpf', '');
    v_email   := NULLIF(rec->>'email', '');
    v_ig      := NULLIF(rec->>'instagram_handle', '');
    v_phone   := NULLIF(rec->>'phone_e164', '');
    v_pdigits := regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g');
    -- Telefone BR válido = 12 ou 13 dígitos (55 + DDD + 8/9 dígitos).
    v_has_phone := length(v_pdigits) BETWEEN 12 AND 13;
    v_origins := COALESCE(rec->'source_origins', '[]'::jsonb);
    v_first   := v_origins->>0;

    -- GUARD DE IDENTIDADE: sem CPF, telefone BR válido, e-mail ou Instagram → não cria.
    IF v_cpf IS NULL AND NOT v_has_phone AND v_email IS NULL AND v_ig IS NULL THEN
      CONTINUE;
    END IF;

    -- Resolve/cria a identidade canônica (idempotente + blindado).
    v_id := find_or_create_unified_customer(
      p_cpf        => v_cpf,
      p_phone      => CASE WHEN v_has_phone THEN v_phone ELSE NULL END,
      p_email      => v_email,
      p_instagram  => v_ig,
      p_ig_user_id => NULLIF(rec->>'instagram_user_id', ''),
      p_name       => NULLIF(rec->>'name', ''),
      p_source     => v_first
    );
    IF v_id IS NULL THEN CONTINUE; END IF;

    v_tags_in := ARRAY(SELECT jsonb_array_elements_text(COALESCE(rec->'tags', '[]'::jsonb)));

    -- Enriquecimento IDEMPOTENTE: só preenche lacunas / máximos / uniões.
    UPDATE customers_unified c SET
      birth_date         = COALESCE(c.birth_date, NULLIF(rec->>'birth_date','')::date),
      gender             = COALESCE(NULLIF(c.gender,''),          NULLIF(rec->>'gender','')),
      cep                = COALESCE(NULLIF(c.cep,''),             NULLIF(rec->>'cep','')),
      address            = COALESCE(NULLIF(c.address,''),         NULLIF(rec->>'address','')),
      address_number     = COALESCE(NULLIF(c.address_number,''),  NULLIF(rec->>'address_number','')),
      complement         = COALESCE(NULLIF(c.complement,''),      NULLIF(rec->>'complement','')),
      neighborhood       = COALESCE(NULLIF(c.neighborhood,''),    NULLIF(rec->>'neighborhood','')),
      city               = COALESCE(NULLIF(c.city,''),            NULLIF(rec->>'city','')),
      state              = COALESCE(NULLIF(c.state,''),           NULLIF(rec->>'state','')),
      shoe_size          = COALESCE(NULLIF(c.shoe_size,''),       NULLIF(rec->>'shoe_size','')),
      preferred_style    = COALESCE(NULLIF(c.preferred_style,''), NULLIF(rec->>'preferred_style','')),
      age_range          = COALESCE(NULLIF(c.age_range,''),       NULLIF(rec->>'age_range','')),
      children_age_range = COALESCE(NULLIF(c.children_age_range,''), NULLIF(rec->>'children_age_range','')),
      has_children       = COALESCE(c.has_children,false) OR COALESCE(NULLIF(rec->>'has_children','')::boolean,false),
      total_orders       = GREATEST(COALESCE(c.total_orders,0), COALESCE(NULLIF(rec->>'total_orders','')::numeric,0)::int),
      total_spent        = GREATEST(COALESCE(c.total_spent,0),  COALESCE(NULLIF(rec->>'total_spent','')::numeric,0)),
      avg_ticket         = GREATEST(COALESCE(c.avg_ticket,0),   COALESCE(NULLIF(rec->>'avg_ticket','')::numeric,0)),
      first_purchase_at  = LEAST(c.first_purchase_at,  NULLIF(rec->>'first_purchase_at','')::timestamptz),
      last_purchase_at   = GREATEST(c.last_purchase_at, NULLIF(rec->>'last_purchase_at','')::timestamptz),
      rfm_segment        = COALESCE(NULLIF(c.rfm_segment,''), NULLIF(rec->>'rfm_segment','')),
      rfm_r              = GREATEST(c.rfm_r,     NULLIF(rec->>'rfm_r','')::int),
      rfm_f              = GREATEST(c.rfm_f,     NULLIF(rec->>'rfm_f','')::int),
      rfm_m              = GREATEST(c.rfm_m,     NULLIF(rec->>'rfm_m','')::int),
      rfm_total          = GREATEST(c.rfm_total, NULLIF(rec->>'rfm_total','')::int),
      region_type        = COALESCE(NULLIF(c.region_type,''), NULLIF(rec->>'region_type','')),
      ddd                = COALESCE(NULLIF(c.ddd,''),         NULLIF(rec->>'ddd','')),
      tags               = ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(c.tags,'{}') || v_tags_in) x WHERE x IS NOT NULL AND x <> ''),
      is_banned          = COALESCE(c.is_banned,false) OR COALESCE(NULLIF(rec->>'is_banned','')::boolean,false),
      ban_reason         = COALESCE(NULLIF(c.ban_reason,''), NULLIF(rec->>'ban_reason','')),
      live_cancellation_count = GREATEST(COALESCE(c.live_cancellation_count,0), COALESCE(NULLIF(rec->>'live_cancellation_count','')::int,0)),
      cashback_balance   = GREATEST(COALESCE(c.cashback_balance,0), COALESCE(NULLIF(rec->>'cashback_balance','')::numeric,0)),
      cashback_expires_at= GREATEST(c.cashback_expires_at, NULLIF(rec->>'cashback_expires_at','')::timestamptz),
      source_origins     = (SELECT COALESCE(jsonb_agg(DISTINCT e), '[]'::jsonb)
                              FROM jsonb_array_elements(COALESCE(c.source_origins,'[]'::jsonb) || v_origins) e),
      updated_at         = now()
    WHERE c.id = v_id;

    IF v_first IS NOT NULL THEN
      result := result || jsonb_build_object('origin', v_first, 'id', v_id);
    END IF;
  END LOOP;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.unify_upsert_customers(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unify_upsert_customers(jsonb) TO service_role;