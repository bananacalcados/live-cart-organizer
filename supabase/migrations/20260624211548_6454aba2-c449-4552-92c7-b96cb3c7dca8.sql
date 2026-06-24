-- ===== Etapa 3: seleção de lote + resolvedor de template =====

-- Resolvedor de template pela contagem de cards "ok" (mínimo 2)
CREATE OR REPLACE FUNCTION public.resolve_campaign_template(p_campanha_id uuid)
RETURNS public.templates_carrossel
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok_count integer;
  v_tpl public.templates_carrossel;
BEGIN
  SELECT count(*) INTO v_ok_count
  FROM public.campanha_cards
  WHERE campanha_id = p_campanha_id AND status = 'ok';

  IF v_ok_count < 2 THEN
    RETURN NULL;
  END IF;

  -- Carrossel suporta no máximo 10 cards
  IF v_ok_count > 10 THEN
    v_ok_count := 10;
  END IF;

  SELECT * INTO v_tpl
  FROM public.templates_carrossel
  WHERE qtd_cards = v_ok_count AND aprovado = true
  LIMIT 1;

  RETURN v_tpl; -- NULL se não houver template aprovado para essa contagem
END;
$$;

-- Seleção do lote elegível para uma campanha
CREATE OR REPLACE FUNCTION public.select_campaign_batch(
  p_campanha_id uuid,
  p_limit integer DEFAULT NULL,
  p_global_cap_days integer DEFAULT 7
)
RETURNS TABLE (
  cliente_id uuid,
  phone text,
  phone_suffix8 text,
  nome text,
  primeiro_nome text,
  tamanhos text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.campanhas_auto;
  v_limit integer;
  f jsonb;
BEGIN
  SELECT * INTO c FROM public.campanhas_auto WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_limit := COALESCE(p_limit, c.qtd_por_dia, 50);
  f := COALESCE(c.filtro_json, '{}'::jsonb);

  RETURN QUERY
  SELECT cv.id,
         cv.phone,
         cv.phone_suffix8,
         cv.name,
         cv.first_name,
         cv.purchased_sizes
  FROM public.crm_customers_v cv
  WHERE cv.phone_suffix8 IS NOT NULL
    AND cv.phone IS NOT NULL
    AND COALESCE(cv.opt_out_mass_dispatch, false) = false
    AND COALESCE(cv.is_archived, false) = false
    -- Filtros de público (cada bloco só aplica quando informado)
    AND (NOT (f ? 'regions')  OR jsonb_array_length(f->'regions')  = 0 OR cv.region_type = ANY (SELECT jsonb_array_elements_text(f->'regions')))
    AND (NOT (f ? 'states')   OR jsonb_array_length(f->'states')   = 0 OR cv.state = ANY (SELECT jsonb_array_elements_text(f->'states')))
    AND (NOT (f ? 'cities')   OR jsonb_array_length(f->'cities')   = 0 OR cv.city = ANY (SELECT jsonb_array_elements_text(f->'cities')))
    AND (NOT (f ? 'genders')  OR jsonb_array_length(f->'genders')  = 0 OR cv.gender = ANY (SELECT jsonb_array_elements_text(f->'genders')))
    AND (NOT (f ? 'rfm_segments') OR jsonb_array_length(f->'rfm_segments') = 0 OR cv.rfm_segment = ANY (SELECT jsonb_array_elements_text(f->'rfm_segments')))
    AND (NOT (f ? 'tags_any') OR jsonb_array_length(f->'tags_any') = 0 OR cv.tags && ARRAY(SELECT jsonb_array_elements_text(f->'tags_any')))
    AND (NOT (f ? 'min_total_orders') OR cv.total_orders >= (f->>'min_total_orders')::int)
    AND (NOT (f ? 'max_total_orders') OR cv.total_orders <= (f->>'max_total_orders')::int)
    AND (NOT (f ? 'purchased_within_days') OR cv.last_purchase_at >= now() - ((f->>'purchased_within_days')::int || ' days')::interval)
    AND (NOT (f ? 'purchased_before_days') OR cv.last_purchase_at <= now() - ((f->>'purchased_before_days')::int || ' days')::interval)
    -- Carência da própria campanha
    AND NOT EXISTS (
      SELECT 1 FROM public.campanha_envios ce
      WHERE ce.campanha_id = c.id
        AND ce.phone_suffix8 = cv.phone_suffix8
        AND ce.status IN ('enviado','entregue','lido')
        AND ce.enviado_em >= now() - (c.cooldown_dias || ' days')::interval
    )
    -- Teto global de marketing (anti-spam entre todas as automações)
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_envios_globais g
      WHERE g.phone_suffix8 = cv.phone_suffix8
        AND g.enviado_em >= now() - (p_global_cap_days || ' days')::interval
    )
  ORDER BY cv.last_purchase_at ASC NULLS FIRST
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.select_campaign_batch(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_campaign_template(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_campaign_batch(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_template(uuid) TO authenticated, service_role;