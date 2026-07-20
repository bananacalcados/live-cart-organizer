
-- Ravena bypass: adiciona parametro p_skip_unify a enqueue_dispatch_recipients_guarded
-- Quando true: NÃO cria/consulta customers_unified e NÃO aplica motor de cota.
-- Insere diretamente em dispatch_recipients com unified_customer_id = NULL.
-- Usado exclusivamente para a base Ravena (loja externa isolada em public.ravena_customers).

CREATE OR REPLACE FUNCTION public.enqueue_dispatch_recipients_guarded(
  p_dispatch_id uuid,
  p_candidates jsonb,
  p_tipo_comunicacao text,
  p_provider text DEFAULT NULL,
  p_overrides jsonb DEFAULT '[]'::jsonb,
  p_skip_unify boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_overridden int := 0;
  v_auto_created int := 0;
  v_resolved jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_overrides_meta jsonb := '[]'::jsonb;
  v_actor uuid := auth.uid();
  v_elem jsonb;
  v_uid uuid;
  v_phone text;
  v_name text;
  v_was_null boolean;
BEGIN
  IF p_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'p_dispatch_id required';
  END IF;
  IF p_tipo_comunicacao IS NULL OR p_tipo_comunicacao = '' THEN
    RAISE EXCEPTION 'tipo_comunicacao é obrigatório para qualquer disparo';
  END IF;

  -- =====================================================================
  -- BYPASS RAVENA: pula unify e motor de cota, insere direto.
  -- =====================================================================
  IF p_skip_unify THEN
    WITH cands AS (
      SELECT
        NULLIF(elem->>'phone','') AS phone,
        NULLIF(elem->>'name','')  AS nm
      FROM jsonb_array_elements(COALESCE(p_candidates,'[]'::jsonb)) elem
    ),
    ins AS (
      INSERT INTO public.dispatch_recipients
        (dispatch_id, phone, recipient_name, status, unified_customer_id, override_reason)
      SELECT
        p_dispatch_id,
        phone,
        nm,
        'pending',
        NULL,
        'ravena_bypass'
      FROM cands
      WHERE phone IS NOT NULL
      ON CONFLICT (dispatch_id, phone) DO NOTHING
      RETURNING id
    )
    SELECT count(*) INTO v_inserted FROM ins;

    UPDATE public.dispatch_history SET
      tipo_comunicacao = COALESCE(tipo_comunicacao, p_tipo_comunicacao),
      provider = COALESCE(provider, p_provider),
      quota_check_summary = jsonb_build_object('bypass','ravena','inserted', v_inserted),
      total_recipients = v_inserted
    WHERE id = p_dispatch_id;

    RETURN jsonb_build_object(
      'inserted', v_inserted,
      'overridden', 0,
      'auto_created_unified', 0,
      'bypass', 'ravena',
      'summary', jsonb_build_object('bypass','ravena')
    );
  END IF;

  -- Fluxo normal (Banana)
  FOR v_elem IN SELECT jsonb_array_elements(COALESCE(p_candidates,'[]'::jsonb))
  LOOP
    v_uid   := NULLIF(v_elem->>'unified_id','')::uuid;
    v_phone := NULLIF(v_elem->>'phone','');
    v_name  := NULLIF(v_elem->>'name','');
    v_was_null := (v_uid IS NULL);

    IF v_uid IS NULL AND v_phone IS NOT NULL THEN
      v_uid := public.resolve_or_create_unified_customer(v_phone, v_name);
      IF v_uid IS NOT NULL AND v_was_null THEN
        v_auto_created := v_auto_created + 1;
      END IF;
    END IF;

    IF v_uid IS NOT NULL THEN
      v_resolved := v_resolved || jsonb_build_array(
        jsonb_build_object('unified_id', v_uid, 'phone', v_phone, 'name', v_name)
      );
    END IF;
  END LOOP;

  v_summary := public.dispatch_quota_summary(v_resolved, p_tipo_comunicacao, p_provider, p_dispatch_id, 20);

  WITH q AS (
    SELECT * FROM public.check_touch_quota(v_resolved, p_tipo_comunicacao, p_provider, p_dispatch_id)
  ),
  cand_names AS (
    SELECT
      (elem->>'unified_id')::uuid AS uid,
      NULLIF(elem->>'name','') AS nm
    FROM jsonb_array_elements(v_resolved) elem
  ),
  overrides AS (
    SELECT
      (o->>'unified_id')::uuid AS uid,
      NULLIF(o->>'motivo','') AS motivo
    FROM jsonb_array_elements(COALESCE(p_overrides,'[]'::jsonb)) o
  ),
  ins AS (
    INSERT INTO public.dispatch_recipients
      (dispatch_id, phone, recipient_name, status, unified_customer_id, override_reason)
    SELECT
      p_dispatch_id,
      q.phone,
      COALESCE(cn.nm, q.name),
      'pending',
      q.unified_id,
      CASE WHEN ov.uid IS NOT NULL THEN concat('override:', COALESCE(ov.motivo,'sem_motivo'), '|', q.reason) ELSE NULL END
    FROM q
    LEFT JOIN cand_names cn ON cn.uid = q.unified_id
    LEFT JOIN overrides ov ON ov.uid = q.unified_id
    WHERE q.phone IS NOT NULL
      AND (q.eligible OR ov.uid IS NOT NULL)
    ON CONFLICT (dispatch_id, phone) DO NOTHING
    RETURNING id, override_reason
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE override_reason IS NOT NULL)
  INTO v_inserted, v_overridden
  FROM ins;

  IF jsonb_array_length(COALESCE(p_overrides,'[]'::jsonb)) > 0 THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'unified_id', o->>'unified_id',
        'motivo', o->>'motivo',
        'override_by', v_actor,
        'override_at', now()
      )
    ) INTO v_overrides_meta
    FROM jsonb_array_elements(p_overrides) o;
  END IF;

  UPDATE public.dispatch_history SET
    tipo_comunicacao = COALESCE(tipo_comunicacao, p_tipo_comunicacao),
    provider = COALESCE(provider, p_provider),
    quota_check_summary = v_summary || jsonb_build_object('auto_created_unified', v_auto_created),
    manual_overrides = COALESCE(manual_overrides,'[]'::jsonb) || COALESCE(v_overrides_meta,'[]'::jsonb),
    total_recipients = v_inserted
  WHERE id = p_dispatch_id;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'overridden', v_overridden,
    'auto_created_unified', v_auto_created,
    'summary', v_summary
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_dispatch_recipients_guarded(uuid, jsonb, text, text, jsonb, boolean)
  TO authenticated, service_role;
