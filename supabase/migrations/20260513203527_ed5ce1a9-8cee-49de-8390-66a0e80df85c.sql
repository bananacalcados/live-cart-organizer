
-- ============================================================
-- ETAPA 3: Triggers de sincronização bidirecional
-- ============================================================

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS last_sync_source text;

-- ------------------------------------------------------------
-- HELPER: detectar se já estamos dentro de uma sincronização
-- (evita loops trigger A → B → A)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_sync_in_progress()
RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=public
AS $$
BEGIN
  RETURN COALESCE(current_setting('app.sync_in_progress', true), 'off') = 'on';
END;
$$;

-- ------------------------------------------------------------
-- TRIGGER 1: products_master.name editado → propaga pra pos_products
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_master_to_pos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF is_sync_in_progress() THEN RETURN NEW; END IF;
  IF NEW.name IS NOT DISTINCT FROM OLD.name THEN RETURN NEW; END IF;

  PERFORM set_config('app.sync_in_progress', 'on', true);

  UPDATE pos_products pp SET
    name       = NEW.name,
    updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM product_variants v
    WHERE v.master_id = NEW.id
      AND (
        (v.tiny_variant_id IS NOT NULL AND v.tiny_variant_id = pp.tiny_id::text)
        OR (v.sku  IS NOT NULL AND v.sku  = pp.sku)
        OR (v.gtin IS NOT NULL AND v.gtin = pp.barcode)
      )
  );

  PERFORM set_config('app.sync_in_progress', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_master_name_to_pos ON public.products_master;
CREATE TRIGGER trg_master_name_to_pos
AFTER UPDATE OF name ON public.products_master
FOR EACH ROW
EXECUTE FUNCTION public.sync_master_to_pos();

-- ------------------------------------------------------------
-- TRIGGER 2: product_variants editado → propaga pra pos_products
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_variant_to_pos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF is_sync_in_progress() THEN RETURN NEW; END IF;
  IF NEW.last_sync_source = 'pos' THEN
    NEW.last_sync_source := NULL;
    RETURN NEW;
  END IF;

  PERFORM set_config('app.sync_in_progress', 'on', true);

  UPDATE pos_products pp SET
    color      = COALESCE(NEW.color, pp.color),
    size       = COALESCE(NEW.size,  pp.size),
    sku        = COALESCE(NEW.sku,   pp.sku),
    barcode    = COALESCE(NEW.gtin,  pp.barcode),
    updated_at = now()
  WHERE
    (NEW.tiny_variant_id IS NOT NULL AND pp.tiny_id::text = NEW.tiny_variant_id)
    OR (NEW.tiny_variant_id IS NULL AND OLD.sku  IS NOT NULL AND pp.sku     = OLD.sku)
    OR (NEW.tiny_variant_id IS NULL AND OLD.gtin IS NOT NULL AND pp.barcode = OLD.gtin);

  PERFORM set_config('app.sync_in_progress', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_variant_to_pos ON public.product_variants;
CREATE TRIGGER trg_variant_to_pos
AFTER UPDATE OF color, size, sku, gtin ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.sync_variant_to_pos();

-- ------------------------------------------------------------
-- TRIGGER 3: pos_products INSERT/UPDATE → garante que existe no catálogo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_pos_to_catalog()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_variant_id uuid;
  v_master_id  uuid;
  v_base_name  text;
  v_color      text;
  v_size       text;
BEGIN
  IF is_sync_in_progress() THEN RETURN NEW; END IF;

  -- Existe variante? Match por tiny → sku → barcode
  SELECT id, master_id INTO v_variant_id, v_master_id
  FROM product_variants
  WHERE (NEW.tiny_id IS NOT NULL AND tiny_variant_id = NEW.tiny_id::text)
     OR (NEW.sku     IS NOT NULL AND sku  = NEW.sku)
     OR (NEW.barcode IS NOT NULL AND gtin = NEW.barcode)
  LIMIT 1;

  IF v_variant_id IS NOT NULL THEN
    -- Já existe: só atualiza identificadores fracos (não sobrescreve cor/tamanho/SKU manuais)
    PERFORM set_config('app.sync_in_progress', 'on', true);
    UPDATE product_variants SET
      tiny_variant_id   = COALESCE(tiny_variant_id, NEW.tiny_id::text),
      sku               = COALESCE(NULLIF(sku,''),  NULLIF(NEW.sku,'')),
      gtin              = COALESCE(NULLIF(gtin,''), NULLIF(NEW.barcode,'')),
      last_sync_source  = 'pos',
      tiny_imported_at  = now(),
      updated_at        = now()
    WHERE id = v_variant_id;
    PERFORM set_config('app.sync_in_progress', 'off', true);
    RETURN NEW;
  END IF;

  -- Não existe: criar (apenas em INSERTs do PDV; UPDATE de stock não cria nada novo)
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  v_base_name := extract_base_product_name(NEW.name);
  v_color     := title_case_color(NULLIF(NEW.color,''));
  v_size      := NULLIF(btrim(NEW.size),'');

  -- Achar/criar master por nome-base
  SELECT id INTO v_master_id
  FROM products_master
  WHERE extract_base_product_name(name) = v_base_name
  ORDER BY (CASE WHEN tiny_product_id IS NOT NULL THEN 0 ELSE 1 END), created_at ASC
  LIMIT 1;

  PERFORM set_config('app.sync_in_progress', 'on', true);

  IF v_master_id IS NULL THEN
    INSERT INTO products_master(name, unidade, origem, is_active, tiny_imported_at)
    VALUES (v_base_name, 'PAR', '0', true, now())
    RETURNING id INTO v_master_id;
  END IF;

  INSERT INTO product_variants(
    master_id, color, size, sku, gtin, tiny_variant_id,
    is_active, last_sync_source, tiny_imported_at
  )
  VALUES (
    v_master_id, v_color, v_size,
    NULLIF(NEW.sku,''), NULLIF(NEW.barcode,''),
    NEW.tiny_id::text,
    true, 'pos', now()
  )
  ON CONFLICT DO NOTHING;

  PERFORM set_config('app.sync_in_progress', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_to_catalog ON public.pos_products;
CREATE TRIGGER trg_pos_to_catalog
AFTER INSERT ON public.pos_products
FOR EACH ROW
EXECUTE FUNCTION public.sync_pos_to_catalog();
