
-- 1) Resumo (contagem de variações + estoque REAL em pares) por master
CREATE OR REPLACE FUNCTION public.legacy_masters_summary(p_master_ids uuid[])
RETURNS TABLE(master_id uuid, variant_count integer, total_stock numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    v.master_id,
    count(*)::int AS variant_count,
    COALESCE(sum(ps.s), 0) AS total_stock
  FROM public.product_variants v
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(pp.stock), 0) AS s
    FROM public.pos_products pp
    WHERE (v.gtin IS NOT NULL AND v.gtin <> '' AND pp.barcode = v.gtin)
       OR ((v.gtin IS NULL OR v.gtin = '') AND v.sku IS NOT NULL AND v.sku <> '' AND pp.sku = v.sku)
  ) ps ON true
  WHERE v.master_id = ANY(p_master_ids)
  GROUP BY v.master_id;
$$;

-- 2) Variações de um master, com estoque real por variação
CREATE OR REPLACE FUNCTION public.legacy_master_variants(p_master_id uuid)
RETURNS TABLE(
  id uuid,
  sku text,
  gtin text,
  color text,
  size text,
  is_active boolean,
  stock numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    v.id,
    v.sku,
    v.gtin,
    v.color,
    v.size,
    v.is_active,
    COALESCE((
      SELECT sum(pp.stock)
      FROM public.pos_products pp
      WHERE (v.gtin IS NOT NULL AND v.gtin <> '' AND pp.barcode = v.gtin)
         OR ((v.gtin IS NULL OR v.gtin = '') AND v.sku IS NOT NULL AND v.sku <> '' AND pp.sku = v.sku)
    ), 0) AS stock
  FROM public.product_variants v
  WHERE v.master_id = p_master_id
  ORDER BY v.size NULLS LAST, v.color NULLS LAST;
$$;

-- 3) Unificar masters selecionados sob um pai (alvo)
CREATE OR REPLACE FUNCTION public.merge_selected_masters(p_target_id uuid, p_source_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sources uuid[];
  s uuid;
  vrec record;
  v_moved int := 0;
  v_conflicts int := 0;
  v_deleted int := 0;
  v_conflict_skus text[] := ARRAY[]::text[];
BEGIN
  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'target_id obrigatório';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products_master WHERE id = p_target_id) THEN
    RAISE EXCEPTION 'produto pai (alvo) não encontrado';
  END IF;

  -- remove o alvo da lista de origens (se vier junto) e nulos
  SELECT array_agg(x) INTO v_sources
  FROM unnest(p_source_ids) x
  WHERE x IS NOT NULL AND x <> p_target_id;

  IF v_sources IS NULL OR array_length(v_sources, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'moved', 0, 'deleted', 0, 'conflicts', 0);
  END IF;

  -- Move variações de cada origem para o alvo (tratando conflito de cor+tamanho)
  FOREACH s IN ARRAY v_sources LOOP
    FOR vrec IN
      SELECT * FROM public.product_variants WHERE master_id = s
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.product_variants t
        WHERE t.master_id = p_target_id
          AND COALESCE(t.color,'') = COALESCE(vrec.color,'')
          AND COALESCE(t.size,'') = COALESCE(vrec.size,'')
      ) THEN
        -- já existe variação igual no pai: mantém na origem (não move) e registra
        v_conflicts := v_conflicts + 1;
        v_conflict_skus := array_append(v_conflict_skus, vrec.sku);
      ELSE
        UPDATE public.product_variants
        SET master_id = p_target_id, updated_at = now()
        WHERE id = vrec.id;
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
  END LOOP;

  -- Repassa vínculos de itens de nota de compra para o alvo
  UPDATE public.purchase_invoice_items
  SET master_id = p_target_id
  WHERE master_id = ANY(v_sources);

  -- Enriquece o alvo com dados onde está vazio (custo/venda/imagens/ncm)
  UPDATE public.products_master tgt SET
    cost_price = CASE WHEN COALESCE(tgt.cost_price,0) = 0
                      THEN (SELECT max(m.cost_price) FROM public.products_master m WHERE m.id = ANY(v_sources) AND COALESCE(m.cost_price,0) > 0)
                      ELSE tgt.cost_price END,
    sale_price = CASE WHEN COALESCE(tgt.sale_price,0) = 0
                      THEN (SELECT max(m.sale_price) FROM public.products_master m WHERE m.id = ANY(v_sources) AND COALESCE(m.sale_price,0) > 0)
                      ELSE tgt.sale_price END,
    images = CASE WHEN (tgt.images IS NULL OR array_length(tgt.images,1) IS NULL)
                  THEN (SELECT m.images FROM public.products_master m WHERE m.id = ANY(v_sources) AND m.images IS NOT NULL AND array_length(m.images,1) > 0 LIMIT 1)
                  ELSE tgt.images END,
    brand = COALESCE(tgt.brand, (SELECT m.brand FROM public.products_master m WHERE m.id = ANY(v_sources) AND m.brand IS NOT NULL LIMIT 1)),
    category = COALESCE(tgt.category, (SELECT m.category FROM public.products_master m WHERE m.id = ANY(v_sources) AND m.category IS NOT NULL LIMIT 1)),
    updated_at = now()
  WHERE tgt.id = p_target_id;

  -- Apaga as origens que ficaram sem variações
  WITH empty_sources AS (
    SELECT m.id FROM public.products_master m
    WHERE m.id = ANY(v_sources)
      AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.master_id = m.id)
  )
  DELETE FROM public.products_master WHERE id IN (SELECT id FROM empty_sources);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'deleted', v_deleted,
    'conflicts', v_conflicts,
    'conflict_skus', to_jsonb(v_conflict_skus)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.legacy_masters_summary(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_master_variants(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_selected_masters(uuid, uuid[]) TO authenticated;
