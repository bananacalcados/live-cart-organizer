
-- ============================================================================
-- Shared helper: checa cota + snapshot de custo, sem inserir
-- Retorna set de linhas: unified_id, phone, name, eligible, reason,
-- template_category, unit_cost, provider
-- ============================================================================
CREATE OR REPLACE FUNCTION public.quota_check_with_snapshot(
  p_candidates jsonb,
  p_tipo_comunicacao text,
  p_provider text,
  p_template_category text,
  p_exclude_dispatch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  unified_id uuid,
  phone text,
  name text,
  eligible boolean,
  reason text,
  template_category text,
  unit_cost_brl numeric,
  provider text,
  toques_no_mes int,
  classificacao text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat text := COALESCE(lower(p_template_category), 'default');
  v_cost numeric := public.get_provider_cost(p_provider, v_cat);
BEGIN
  RETURN QUERY
  SELECT
    q.unified_id,
    q.phone,
    q.name,
    q.eligible,
    q.reason,
    v_cat,
    v_cost,
    p_provider,
    q.toques_no_mes,
    q.classificacao
  FROM public.check_touch_quota(p_candidates, p_tipo_comunicacao, p_provider, p_exclude_dispatch_id) q;
END;
$$;

-- ============================================================================
-- 1) enqueue_campanha_envios_guarded (carrossel Meta Cloud 1:1)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_campanha_envios_guarded(
  p_campanha_id uuid,
  p_candidates jsonb,       -- [{unified_id?, phone, name?, vendedora_id?, vendedora_nome?}]
  p_tipo_comunicacao text,
  p_template_category text DEFAULT NULL,
  p_shadow_mode boolean DEFAULT NULL,
  p_overrides jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_elem jsonb;
  v_uid uuid;
  v_phone text;
  v_name text;
  v_resolved jsonb := '[]'::jsonb;
  v_by_uid jsonb := '{}'::jsonb;
  v_inserted int := 0;
  v_excluded int := 0;
  v_shadow_inserted int := 0;
  v_cost_total numeric := 0;
  v_reasons jsonb := '{}'::jsonb;
  v_shadow boolean;
  v_provider text := 'meta_cloud';
  v_cat text;
  v_auto_created int := 0;
BEGIN
  IF p_campanha_id IS NULL THEN RAISE EXCEPTION 'p_campanha_id obrigatório'; END IF;
  IF p_tipo_comunicacao IS NULL OR p_tipo_comunicacao = '' THEN
    RAISE EXCEPTION 'tipo_comunicacao obrigatório';
  END IF;

  SELECT COALESCE(p_shadow_mode, shadow_mode, true),
         COALESCE(p_template_category, template_categoria, 'marketing')
    INTO v_shadow, v_cat
    FROM public.campanhas_auto WHERE id = p_campanha_id;

  -- Resolve/cria unified para cada candidato
  FOR v_elem IN SELECT jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) LOOP
    v_uid   := NULLIF(v_elem->>'unified_id','')::uuid;
    v_phone := NULLIF(v_elem->>'phone','');
    v_name  := NULLIF(v_elem->>'name','');
    IF v_uid IS NULL AND v_phone IS NOT NULL THEN
      v_uid := public.resolve_or_create_unified_customer(v_phone, v_name);
      IF v_uid IS NOT NULL THEN v_auto_created := v_auto_created + 1; END IF;
    END IF;
    IF v_uid IS NOT NULL THEN
      v_resolved := v_resolved || jsonb_build_array(
        jsonb_build_object('unified_id', v_uid, 'phone', v_phone, 'name', v_name));
      v_by_uid := v_by_uid || jsonb_build_object(v_uid::text, v_elem);
    END IF;
  END LOOP;

  -- Checagem + insert por resultado
  WITH q AS (
    SELECT * FROM public.quota_check_with_snapshot(
      v_resolved, p_tipo_comunicacao, v_provider, v_cat, NULL)
  ),
  ins AS (
    INSERT INTO public.campanha_envios (
      campanha_id, cliente_id, phone, phone_suffix8, vendedora_id, vendedora_nome,
      status, template_category_at_send, unit_cost_at_send, provider_at_send, shadow_mode
    )
    SELECT
      p_campanha_id,
      q.unified_id,
      COALESCE(q.phone, (v_by_uid->q.unified_id::text->>'phone')),
      right(regexp_replace(coalesce(q.phone,''),'\D','','g'), 8),
      NULLIF(v_by_uid->q.unified_id::text->>'vendedora_id','')::uuid,
      NULLIF(v_by_uid->q.unified_id::text->>'vendedora_nome',''),
      'pendente',
      q.template_category,
      q.unit_cost_brl,
      q.provider,
      v_shadow
    FROM q
    -- shadow=true insere TODOS; shadow=false insere só elegíveis (ou override)
    WHERE v_shadow = true OR q.eligible = true
    RETURNING id, unit_cost_at_send, shadow_mode
  )
  SELECT
    count(*) FILTER (WHERE NOT ins.shadow_mode)::int,
    count(*) FILTER (WHERE ins.shadow_mode)::int,
    COALESCE(sum(ins.unit_cost_at_send), 0)
  INTO v_inserted, v_shadow_inserted, v_cost_total
  FROM ins;

  -- Motivos de exclusão (contagem)
  SELECT COALESCE(jsonb_object_agg(reason, cnt), '{}'::jsonb)
    INTO v_reasons
    FROM (
      SELECT q.reason, count(*)::int AS cnt
      FROM public.quota_check_with_snapshot(v_resolved, p_tipo_comunicacao, v_provider, v_cat, NULL) q
      WHERE q.eligible = false
      GROUP BY q.reason
    ) r;
  v_excluded := COALESCE((SELECT sum((value)::int) FROM jsonb_each_text(v_reasons)), 0);

  RETURN jsonb_build_object(
    'campanha_id', p_campanha_id,
    'shadow_mode', v_shadow,
    'inserted', v_inserted,
    'shadow_inserted', v_shadow_inserted,
    'excluded', v_excluded,
    'reasons', v_reasons,
    'cost_estimate_brl', v_cost_total,
    'auto_created', v_auto_created,
    'provider', v_provider,
    'template_category', v_cat
  );
END;
$$;

-- ============================================================================
-- 2) enqueue_live_campaign_dispatches_guarded
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_live_campaign_dispatches_guarded(
  p_campaign_id uuid,
  p_message_id uuid,
  p_candidates jsonb,     -- [{unified_id?, phone, name?, lead_id?, whatsapp_number_id?, channel?, ig_user_id?, ig_comment_id?}]
  p_tipo_comunicacao text,
  p_provider text DEFAULT 'meta_cloud',
  p_template_category text DEFAULT 'marketing',
  p_shadow_mode boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_elem jsonb;
  v_uid uuid;
  v_phone text;
  v_name text;
  v_resolved jsonb := '[]'::jsonb;
  v_by_uid jsonb := '{}'::jsonb;
  v_shadow boolean;
  v_cat text := COALESCE(lower(p_template_category),'marketing');
  v_inserted int := 0;
  v_shadow_inserted int := 0;
  v_excluded int := 0;
  v_cost_total numeric := 0;
  v_reasons jsonb := '{}'::jsonb;
  v_auto_created int := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'p_campaign_id + p_message_id obrigatórios';
  END IF;

  SELECT COALESCE(p_shadow_mode, shadow_mode, true)
    INTO v_shadow FROM public.live_campaigns WHERE id = p_campaign_id;

  FOR v_elem IN SELECT jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) LOOP
    v_uid   := NULLIF(v_elem->>'unified_id','')::uuid;
    v_phone := NULLIF(v_elem->>'phone','');
    v_name  := NULLIF(v_elem->>'name','');
    IF v_uid IS NULL AND v_phone IS NOT NULL THEN
      v_uid := public.resolve_or_create_unified_customer(v_phone, v_name);
      IF v_uid IS NOT NULL THEN v_auto_created := v_auto_created + 1; END IF;
    END IF;
    IF v_uid IS NOT NULL THEN
      v_resolved := v_resolved || jsonb_build_array(
        jsonb_build_object('unified_id', v_uid, 'phone', v_phone, 'name', v_name));
      v_by_uid := v_by_uid || jsonb_build_object(v_uid::text, v_elem);
    END IF;
  END LOOP;

  WITH q AS (
    SELECT * FROM public.quota_check_with_snapshot(
      v_resolved, p_tipo_comunicacao, p_provider, v_cat, NULL)
  ),
  ins AS (
    INSERT INTO public.live_campaign_dispatches (
      campaign_id, message_id, lead_id, phone, whatsapp_number_id, channel,
      ig_user_id, ig_comment_id, status,
      template_category_at_send, unit_cost_at_send, provider_at_send, shadow_mode
    )
    SELECT
      p_campaign_id, p_message_id,
      NULLIF(v_by_uid->q.unified_id::text->>'lead_id','')::uuid,
      COALESCE(q.phone, (v_by_uid->q.unified_id::text->>'phone')),
      NULLIF(v_by_uid->q.unified_id::text->>'whatsapp_number_id','')::uuid,
      COALESCE(NULLIF(v_by_uid->q.unified_id::text->>'channel',''), 'whatsapp'),
      NULLIF(v_by_uid->q.unified_id::text->>'ig_user_id',''),
      NULLIF(v_by_uid->q.unified_id::text->>'ig_comment_id',''),
      'pending',
      q.template_category, q.unit_cost_brl, q.provider, v_shadow
    FROM q
    WHERE v_shadow = true OR q.eligible = true
    RETURNING id, unit_cost_at_send, shadow_mode
  )
  SELECT
    count(*) FILTER (WHERE NOT ins.shadow_mode)::int,
    count(*) FILTER (WHERE ins.shadow_mode)::int,
    COALESCE(sum(ins.unit_cost_at_send), 0)
  INTO v_inserted, v_shadow_inserted, v_cost_total
  FROM ins;

  SELECT COALESCE(jsonb_object_agg(reason, cnt), '{}'::jsonb)
    INTO v_reasons
    FROM (
      SELECT q.reason, count(*)::int AS cnt
      FROM public.quota_check_with_snapshot(v_resolved, p_tipo_comunicacao, p_provider, v_cat, NULL) q
      WHERE q.eligible = false GROUP BY q.reason
    ) r;
  v_excluded := COALESCE((SELECT sum((value)::int) FROM jsonb_each_text(v_reasons)), 0);

  RETURN jsonb_build_object(
    'campaign_id', p_campaign_id,
    'message_id', p_message_id,
    'shadow_mode', v_shadow,
    'inserted', v_inserted,
    'shadow_inserted', v_shadow_inserted,
    'excluded', v_excluded,
    'reasons', v_reasons,
    'cost_estimate_brl', v_cost_total,
    'auto_created', v_auto_created,
    'provider', p_provider,
    'template_category', v_cat
  );
END;
$$;

-- ============================================================================
-- 3) enqueue_mass_dispatch_targets_guarded (vip-orphan)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_mass_dispatch_targets_guarded(
  p_campaign_id uuid,
  p_candidates jsonb,   -- [{unified_id?, phone, name?, contact_id?}]
  p_tipo_comunicacao text,
  p_provider text DEFAULT 'uazapi',
  p_template_category text DEFAULT 'default',
  p_shadow_mode boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_elem jsonb;
  v_uid uuid;
  v_phone text;
  v_name text;
  v_resolved jsonb := '[]'::jsonb;
  v_by_uid jsonb := '{}'::jsonb;
  v_shadow boolean;
  v_cat text := COALESCE(lower(p_template_category),'default');
  v_inserted int := 0;
  v_shadow_inserted int := 0;
  v_excluded int := 0;
  v_cost_total numeric := 0;
  v_reasons jsonb := '{}'::jsonb;
  v_auto_created int := 0;
BEGIN
  IF p_campaign_id IS NULL THEN RAISE EXCEPTION 'p_campaign_id obrigatório'; END IF;

  SELECT COALESCE(p_shadow_mode, shadow_mode, true)
    INTO v_shadow FROM public.mass_dispatch_campaigns WHERE id = p_campaign_id;

  FOR v_elem IN SELECT jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) LOOP
    v_uid   := NULLIF(v_elem->>'unified_id','')::uuid;
    v_phone := NULLIF(v_elem->>'phone','');
    v_name  := NULLIF(v_elem->>'name','');
    IF v_uid IS NULL AND v_phone IS NOT NULL THEN
      v_uid := public.resolve_or_create_unified_customer(v_phone, v_name);
      IF v_uid IS NOT NULL THEN v_auto_created := v_auto_created + 1; END IF;
    END IF;
    IF v_uid IS NOT NULL THEN
      v_resolved := v_resolved || jsonb_build_array(
        jsonb_build_object('unified_id', v_uid, 'phone', v_phone, 'name', v_name));
      v_by_uid := v_by_uid || jsonb_build_object(v_uid::text, v_elem);
    END IF;
  END LOOP;

  WITH q AS (
    SELECT * FROM public.quota_check_with_snapshot(
      v_resolved, p_tipo_comunicacao, p_provider, v_cat, NULL)
  ),
  ins AS (
    INSERT INTO public.mass_dispatch_targets (
      campaign_id, contact_id, phone, phone_suffix8, display_name, status,
      template_category_at_send, unit_cost_at_send, provider_at_send, shadow_mode
    )
    SELECT
      p_campaign_id,
      NULLIF(v_by_uid->q.unified_id::text->>'contact_id','')::uuid,
      COALESCE(q.phone, v_by_uid->q.unified_id::text->>'phone'),
      right(regexp_replace(coalesce(q.phone,''),'\D','','g'), 8),
      COALESCE(q.name, v_by_uid->q.unified_id::text->>'name'),
      'pending',
      q.template_category, q.unit_cost_brl, q.provider, v_shadow
    FROM q
    WHERE v_shadow = true OR q.eligible = true
    ON CONFLICT (campaign_id, phone_suffix8) DO NOTHING
    RETURNING id, unit_cost_at_send, shadow_mode
  )
  SELECT
    count(*) FILTER (WHERE NOT ins.shadow_mode)::int,
    count(*) FILTER (WHERE ins.shadow_mode)::int,
    COALESCE(sum(ins.unit_cost_at_send), 0)
  INTO v_inserted, v_shadow_inserted, v_cost_total
  FROM ins;

  SELECT COALESCE(jsonb_object_agg(reason, cnt), '{}'::jsonb)
    INTO v_reasons
    FROM (
      SELECT q.reason, count(*)::int AS cnt
      FROM public.quota_check_with_snapshot(v_resolved, p_tipo_comunicacao, p_provider, v_cat, NULL) q
      WHERE q.eligible = false GROUP BY q.reason
    ) r;
  v_excluded := COALESCE((SELECT sum((value)::int) FROM jsonb_each_text(v_reasons)), 0);

  RETURN jsonb_build_object(
    'campaign_id', p_campaign_id,
    'shadow_mode', v_shadow,
    'inserted', v_inserted,
    'shadow_inserted', v_shadow_inserted,
    'excluded', v_excluded,
    'reasons', v_reasons,
    'cost_estimate_brl', v_cost_total,
    'auto_created', v_auto_created,
    'provider', p_provider,
    'template_category', v_cat
  );
END;
$$;

-- ============================================================================
-- 4) guard_automation_dispatch (single-shot: verifica UM destinatário)
-- Retorna decisão + snapshot para a function usar antes de enviar
-- ============================================================================
CREATE OR REPLACE FUNCTION public.guard_automation_dispatch(
  p_flow_id uuid,
  p_phone text,
  p_tipo_comunicacao text,
  p_provider text DEFAULT 'uazapi',
  p_template_category text DEFAULT 'default'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_shadow boolean;
  v_cat text := COALESCE(lower(p_template_category),'default');
  v_cost numeric;
  v_row record;
BEGIN
  IF p_flow_id IS NULL OR p_phone IS NULL THEN
    RAISE EXCEPTION 'p_flow_id e p_phone obrigatórios';
  END IF;
  SELECT COALESCE(shadow_mode, true) INTO v_shadow
    FROM public.automation_flows WHERE id = p_flow_id;

  v_uid := public.resolve_or_create_unified_customer(p_phone, NULL);
  v_cost := public.get_provider_cost(p_provider, v_cat);

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason', 'sem_telefone_valido',
      'shadow_mode', v_shadow, 'unified_id', null,
      'template_category', v_cat, 'unit_cost_brl', v_cost, 'provider', p_provider
    );
  END IF;

  SELECT * INTO v_row FROM public.check_touch_quota(
    jsonb_build_array(jsonb_build_object('unified_id', v_uid, 'phone', p_phone)),
    p_tipo_comunicacao, p_provider, NULL
  ) LIMIT 1;

  RETURN jsonb_build_object(
    'eligible', COALESCE(v_row.eligible, false),
    'reason', COALESCE(v_row.reason, 'sem_dado'),
    'unified_id', v_uid,
    'shadow_mode', v_shadow,
    'toques_no_mes', COALESCE(v_row.toques_no_mes, 0),
    'classificacao', COALESCE(v_row.classificacao, 'sem_classificacao'),
    'template_category', v_cat,
    'unit_cost_brl', v_cost,
    'provider', p_provider
  );
END;
$$;
