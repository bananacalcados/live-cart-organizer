-- Gera EAN-13 (prefixo 789) válido e único entre product_variants.gtin e pos_products.barcode
CREATE OR REPLACE FUNCTION public.gen_unique_ean13()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_code text;
  v_sum int;
  v_check int;
  v_i int;
  v_digit int;
  v_tries int := 0;
BEGIN
  LOOP
    v_tries := v_tries + 1;
    v_base := '789' || lpad((floor(random()*1000000000))::bigint::text, 9, '0');
    v_sum := 0;
    FOR v_i IN 1..12 LOOP
      v_digit := substr(v_base, v_i, 1)::int;
      IF v_i % 2 = 1 THEN
        v_sum := v_sum + v_digit;
      ELSE
        v_sum := v_sum + v_digit * 3;
      END IF;
    END LOOP;
    v_check := (10 - (v_sum % 10)) % 10;
    v_code := v_base || v_check::text;
    IF NOT EXISTS (SELECT 1 FROM product_variants WHERE gtin = v_code)
       AND NOT EXISTS (SELECT 1 FROM pos_products WHERE barcode = v_code) THEN
      RETURN v_code;
    END IF;
    IF v_tries > 50 THEN
      RAISE EXCEPTION 'Não foi possível gerar GTIN único';
    END IF;
  END LOOP;
END;
$$;

-- Gera SKU único, anexando sufixo numérico se já existir em product_variants.sku ou pos_products.sku
CREATE OR REPLACE FUNCTION public.gen_unique_variant_sku(p_base text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sku text := p_base;
  v_n int := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM product_variants WHERE sku = v_sku)
        OR EXISTS (SELECT 1 FROM pos_products WHERE sku = v_sku) LOOP
    v_n := v_n + 1;
    v_sku := p_base || '-' || v_n::text;
  END LOOP;
  RETURN v_sku;
END;
$$;

-- Atualiza criação de produto com variações: SKU único + GTIN único + category_id
CREATE OR REPLACE FUNCTION public.create_product_with_variants(p_master jsonb, p_variants jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_master_id uuid;
  v_variant jsonb;
  v_sku_root text;
  v_sku text;
  v_base_sku text;
  v_gtin text;
BEGIN
  IF NOT (public.has_module_access(auth.uid(), 'inventory') OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Sem permissão para criar produtos';
  END IF;

  INSERT INTO public.products_master (
    name, description, brand, category, category_id, ncm, cest, origem, unidade,
    cost_price, sale_price, weight_kg, height_cm, width_cm, length_cm,
    images, is_active, created_by
  )
  VALUES (
    p_master->>'name',
    p_master->>'description',
    p_master->>'brand',
    p_master->>'category',
    NULLIF(p_master->>'category_id', '')::uuid,
    COALESCE(p_master->>'ncm', '64039900'),
    p_master->>'cest',
    COALESCE(p_master->>'origem', '0'),
    COALESCE(p_master->>'unidade', 'UN'),
    COALESCE((p_master->>'cost_price')::numeric, 0),
    COALESCE((p_master->>'sale_price')::numeric, 0),
    NULLIF(p_master->>'weight_kg', '')::numeric,
    NULLIF(p_master->>'height_cm', '')::numeric,
    NULLIF(p_master->>'width_cm', '')::numeric,
    NULLIF(p_master->>'length_cm', '')::numeric,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_master->'images')), ARRAY[]::text[]),
    COALESCE((p_master->>'is_active')::boolean, true),
    auth.uid()
  )
  RETURNING id, sku_root INTO v_master_id, v_sku_root;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    v_base_sku := v_sku_root
      || '-' || COALESCE(NULLIF(upper(regexp_replace(v_variant->>'color', '[^A-Za-z0-9]', '', 'g')), ''), 'UN')
      || '-' || COALESCE(NULLIF(regexp_replace(v_variant->>'size', '[^A-Za-z0-9]', '', 'g'), ''), 'U');

    v_sku := public.gen_unique_variant_sku(v_base_sku);
    v_gtin := public.gen_unique_ean13();

    INSERT INTO public.product_variants (
      master_id, sku, gtin, color, size,
      cost_price_override, sale_price_override, weight_kg_override,
      initial_stock, is_active
    )
    VALUES (
      v_master_id,
      v_sku,
      v_gtin,
      v_variant->>'color',
      v_variant->>'size',
      NULLIF(v_variant->>'cost_price_override', '')::numeric,
      NULLIF(v_variant->>'sale_price_override', '')::numeric,
      NULLIF(v_variant->>'weight_kg_override', '')::numeric,
      COALESCE((v_variant->>'initial_stock')::int, 0),
      COALESCE((v_variant->>'is_active')::boolean, true)
    );
  END LOOP;

  RETURN v_master_id;
END;
$function$;