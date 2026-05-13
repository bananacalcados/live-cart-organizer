
-- ============================================================
-- ETAPA 2: Análise + Merge de masters duplicados
-- ============================================================

-- Tabela de log da fusão
CREATE TABLE IF NOT EXISTS public.master_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  base_name text NOT NULL,
  canonical_master_id uuid,
  loser_master_id uuid,
  action text NOT NULL, -- 'pick_canonical' | 'merge_loser' | 'move_variant' | 'drop_dup_variant' | 'enrich_canonical' | 'delete_loser'
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_merge_log_run ON public.master_merge_log(run_id);

-- ------------------------------------------------------------
-- ANÁLISE (read-only): mostra grupos duplicados
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analyze_master_duplicates(p_limit int DEFAULT 50)
RETURNS TABLE(
  base_name text,
  master_count int,
  total_variants int,
  canonical_id uuid,
  canonical_variant_count int,
  canonical_score int,
  loser_ids uuid[],
  loser_variants_total int,
  sample_examples jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  RETURN QUERY
  WITH grouped AS (
    SELECT
      extract_base_product_name(m.name) AS base,
      m.id AS mid,
      m.name,
      m.ncm, m.cost_price, m.shopify_product_id, m.images,
      m.tiny_product_id,
      m.created_at,
      (SELECT count(*) FROM product_variants v WHERE v.master_id = m.id) AS vcount,
      (
        (CASE WHEN m.ncm IS NOT NULL AND m.ncm <> '' THEN 5 ELSE 0 END) +
        (CASE WHEN m.cost_price IS NOT NULL AND m.cost_price > 0 THEN 3 ELSE 0 END) +
        (CASE WHEN m.shopify_product_id IS NOT NULL THEN 4 ELSE 0 END) +
        (CASE WHEN m.images IS NOT NULL AND array_length(m.images,1) > 0 THEN 3 ELSE 0 END) +
        (CASE WHEN m.tiny_product_id IS NOT NULL THEN 2 ELSE 0 END)
      ) AS enrich_score
    FROM products_master m
    WHERE m.name IS NOT NULL
  ),
  ranked AS (
    SELECT g.*,
      (g.vcount * 10 + g.enrich_score) AS total_score,
      row_number() OVER (
        PARTITION BY g.base
        ORDER BY (g.vcount * 10 +
          (CASE WHEN g.ncm IS NOT NULL AND g.ncm <> '' THEN 5 ELSE 0 END) +
          (CASE WHEN g.cost_price IS NOT NULL AND g.cost_price > 0 THEN 3 ELSE 0 END) +
          (CASE WHEN g.shopify_product_id IS NOT NULL THEN 4 ELSE 0 END) +
          (CASE WHEN g.images IS NOT NULL AND array_length(g.images,1) > 0 THEN 3 ELSE 0 END) +
          (CASE WHEN g.tiny_product_id IS NOT NULL THEN 2 ELSE 0 END)
        ) DESC,
        g.created_at ASC
      ) AS rn
    FROM grouped g
  ),
  groups AS (
    SELECT base, count(*) AS cnt
    FROM ranked
    GROUP BY base
    HAVING count(*) > 1
  )
  SELECT
    gr.base AS base_name,
    gr.cnt::int AS master_count,
    (SELECT sum(vcount)::int FROM ranked r WHERE r.base = gr.base) AS total_variants,
    (SELECT mid FROM ranked r WHERE r.base = gr.base AND r.rn = 1) AS canonical_id,
    (SELECT vcount FROM ranked r WHERE r.base = gr.base AND r.rn = 1)::int AS canonical_variant_count,
    (SELECT total_score FROM ranked r WHERE r.base = gr.base AND r.rn = 1)::int AS canonical_score,
    (SELECT array_agg(mid ORDER BY rn) FROM ranked r WHERE r.base = gr.base AND r.rn > 1) AS loser_ids,
    (SELECT sum(vcount)::int FROM ranked r WHERE r.base = gr.base AND r.rn > 1) AS loser_variants_total,
    (SELECT jsonb_agg(jsonb_build_object('id', mid, 'name', name, 'variants', vcount, 'score', total_score, 'rn', rn) ORDER BY rn)
       FROM ranked r WHERE r.base = gr.base) AS sample_examples
  FROM groups gr
  ORDER BY (SELECT sum(vcount) FROM ranked r WHERE r.base = gr.base) DESC
  LIMIT p_limit;
END;
$$;

-- ------------------------------------------------------------
-- EXECUTOR: funde N grupos duplicados
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_master_duplicates(p_limit int DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_groups_processed int := 0;
  v_losers_deleted int := 0;
  v_variants_moved int := 0;
  v_variants_dropped_dup int := 0;
  v_canonical_enriched int := 0;
  grp record;
  loser_id uuid;
  loser_master record;
  canonical_master record;
  vrec record;
  conflict_variant_id uuid;
BEGIN
  FOR grp IN
    WITH grouped AS (
      SELECT
        extract_base_product_name(m.name) AS base,
        m.id AS mid,
        m.ncm, m.cost_price, m.shopify_product_id, m.images, m.tiny_product_id,
        m.created_at,
        (SELECT count(*) FROM product_variants v WHERE v.master_id = m.id) AS vcount,
        (
          (CASE WHEN m.ncm IS NOT NULL AND m.ncm <> '' THEN 5 ELSE 0 END) +
          (CASE WHEN m.cost_price IS NOT NULL AND m.cost_price > 0 THEN 3 ELSE 0 END) +
          (CASE WHEN m.shopify_product_id IS NOT NULL THEN 4 ELSE 0 END) +
          (CASE WHEN m.images IS NOT NULL AND array_length(m.images,1) > 0 THEN 3 ELSE 0 END) +
          (CASE WHEN m.tiny_product_id IS NOT NULL THEN 2 ELSE 0 END)
        ) AS enrich_score
      FROM products_master m
      WHERE m.name IS NOT NULL
    ),
    ranked AS (
      SELECT g.*,
        row_number() OVER (
          PARTITION BY g.base
          ORDER BY (g.vcount * 10 + g.enrich_score) DESC, g.created_at ASC
        ) AS rn
      FROM grouped g
    ),
    groups AS (
      SELECT base FROM ranked GROUP BY base HAVING count(*) > 1
    )
    SELECT
      gr.base,
      (SELECT mid FROM ranked r WHERE r.base = gr.base AND r.rn = 1) AS canonical_id,
      (SELECT array_agg(mid ORDER BY rn) FROM ranked r WHERE r.base = gr.base AND r.rn > 1) AS loser_ids
    FROM groups gr
    ORDER BY (SELECT sum(vcount) FROM ranked r WHERE r.base = gr.base) DESC
    LIMIT p_limit
  LOOP
    SELECT * INTO canonical_master FROM products_master WHERE id = grp.canonical_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    INSERT INTO master_merge_log(run_id, base_name, canonical_master_id, action, details)
    VALUES (v_run_id, grp.base, grp.canonical_id, 'pick_canonical',
            jsonb_build_object('losers', grp.loser_ids));

    FOREACH loser_id IN ARRAY grp.loser_ids LOOP
      SELECT * INTO loser_master FROM products_master WHERE id = loser_id;
      IF NOT FOUND THEN CONTINUE; END IF;

      -- Enriquecer canonical com dados do perdedor (apenas onde canonical está vazio)
      UPDATE products_master c SET
        ncm                = COALESCE(NULLIF(c.ncm,''),                NULLIF(loser_master.ncm,'')),
        cest               = COALESCE(NULLIF(c.cest,''),               NULLIF(loser_master.cest,'')),
        origem             = COALESCE(NULLIF(c.origem,''),             NULLIF(loser_master.origem,'')),
        unidade            = COALESCE(NULLIF(c.unidade,''),            NULLIF(loser_master.unidade,'')),
        brand              = COALESCE(NULLIF(c.brand,''),              NULLIF(loser_master.brand,'')),
        category           = COALESCE(NULLIF(c.category,''),           NULLIF(loser_master.category,'')),
        description        = COALESCE(NULLIF(c.description,''),        NULLIF(loser_master.description,'')),
        cost_price         = CASE WHEN c.cost_price IS NULL OR c.cost_price = 0 THEN loser_master.cost_price ELSE c.cost_price END,
        sale_price         = CASE WHEN c.sale_price IS NULL OR c.sale_price = 0 THEN loser_master.sale_price ELSE c.sale_price END,
        weight_kg          = COALESCE(c.weight_kg, loser_master.weight_kg),
        height_cm          = COALESCE(c.height_cm, loser_master.height_cm),
        width_cm           = COALESCE(c.width_cm,  loser_master.width_cm),
        length_cm          = COALESCE(c.length_cm, loser_master.length_cm),
        images             = CASE WHEN (c.images IS NULL OR array_length(c.images,1) IS NULL) THEN loser_master.images ELSE c.images END,
        shopify_product_id = COALESCE(c.shopify_product_id, loser_master.shopify_product_id),
        tiny_product_id    = COALESCE(c.tiny_product_id,    loser_master.tiny_product_id),
        classe_produto     = COALESCE(NULLIF(c.classe_produto,''), NULLIF(loser_master.classe_produto,'')),
        updated_at         = now()
      WHERE c.id = grp.canonical_id;
      v_canonical_enriched := v_canonical_enriched + 1;

      -- Mover variantes do perdedor para o canonical
      FOR vrec IN SELECT * FROM product_variants WHERE master_id = loser_id LOOP
        -- 1) (color, size) duplicado no canonical?
        SELECT id INTO conflict_variant_id
        FROM product_variants
        WHERE master_id = grp.canonical_id
          AND COALESCE(lower(color),'') = COALESCE(lower(vrec.color),'')
          AND COALESCE(lower(size),'')  = COALESCE(lower(vrec.size),'')
        LIMIT 1;

        IF conflict_variant_id IS NOT NULL THEN
          -- Enriquecer canonical variant com dados do perdedor
          UPDATE product_variants cv SET
            sku                = COALESCE(NULLIF(cv.sku,''),  NULLIF(vrec.sku,'')),
            gtin               = COALESCE(NULLIF(cv.gtin,''), NULLIF(vrec.gtin,'')),
            tiny_variant_id    = COALESCE(cv.tiny_variant_id, vrec.tiny_variant_id),
            shopify_variant_id = COALESCE(cv.shopify_variant_id, vrec.shopify_variant_id),
            updated_at         = now()
          WHERE cv.id = conflict_variant_id;

          DELETE FROM product_variants WHERE id = vrec.id;
          v_variants_dropped_dup := v_variants_dropped_dup + 1;

          INSERT INTO master_merge_log(run_id, base_name, canonical_master_id, loser_master_id, action, details)
          VALUES (v_run_id, grp.base, grp.canonical_id, loser_id, 'drop_dup_variant',
                  jsonb_build_object('variant_id', vrec.id, 'color', vrec.color, 'size', vrec.size,
                                     'kept_canonical_variant', conflict_variant_id));
        ELSE
          -- 2) Conflito de SKU/GTIN com OUTRO master?
          IF vrec.sku IS NOT NULL AND vrec.sku <> '' AND EXISTS (
            SELECT 1 FROM product_variants WHERE sku = vrec.sku AND master_id <> loser_id AND master_id <> grp.canonical_id
          ) THEN
            UPDATE product_variants SET sku = NULL WHERE id = vrec.id;
          END IF;
          IF vrec.gtin IS NOT NULL AND vrec.gtin <> '' AND EXISTS (
            SELECT 1 FROM product_variants WHERE gtin = vrec.gtin AND master_id <> loser_id AND master_id <> grp.canonical_id
          ) THEN
            UPDATE product_variants SET gtin = NULL WHERE id = vrec.id;
          END IF;

          UPDATE product_variants SET master_id = grp.canonical_id, updated_at = now() WHERE id = vrec.id;
          v_variants_moved := v_variants_moved + 1;

          INSERT INTO master_merge_log(run_id, base_name, canonical_master_id, loser_master_id, action, details)
          VALUES (v_run_id, grp.base, grp.canonical_id, loser_id, 'move_variant',
                  jsonb_build_object('variant_id', vrec.id, 'color', vrec.color, 'size', vrec.size));
        END IF;
        conflict_variant_id := NULL;
      END LOOP;

      -- Deletar perdedor (não terá mais variantes)
      DELETE FROM products_master WHERE id = loser_id;
      v_losers_deleted := v_losers_deleted + 1;

      INSERT INTO master_merge_log(run_id, base_name, canonical_master_id, loser_master_id, action, details)
      VALUES (v_run_id, grp.base, grp.canonical_id, loser_id, 'delete_loser', NULL);
    END LOOP;

    v_groups_processed := v_groups_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'groups_processed', v_groups_processed,
    'losers_deleted', v_losers_deleted,
    'variants_moved', v_variants_moved,
    'variants_dropped_dup', v_variants_dropped_dup,
    'canonical_enriched', v_canonical_enriched
  );
END;
$$;

-- RLS no log
ALTER TABLE public.master_merge_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "merge_log_admin_read" ON public.master_merge_log
  FOR SELECT TO authenticated USING (true);
