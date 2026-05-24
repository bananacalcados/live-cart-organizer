
-- 1) Corrige extract_base_product_name para sufixos "Cor Tamanho" e "Cor Tam/Tam"
CREATE OR REPLACE FUNCTION public.extract_base_product_name(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  parts text[];
  n int;
  last_part text;
  prev_part text;
BEGIN
  IF p_name IS NULL THEN RETURN NULL; END IF;
  parts := string_to_array(p_name, ' - ');
  n := array_length(parts, 1);
  IF n IS NULL OR n < 2 THEN RETURN btrim(p_name); END IF;
  last_part := btrim(parts[n]);

  -- caso "... - Cor Tamanho" ou "... - Cor Tam/Tam" (ex: "Marrom 33/34", "Cobre 39/40")
  IF last_part ~* '^[a-zà-ÿ]+( [a-zà-ÿ]+){0,2} \d{1,2}([,\.]\d)?(/\d{1,2})?$' THEN
    RETURN btrim(array_to_string(parts[1:n-1], ' - '));
  END IF;

  -- caso "... - Cor - Tamanho" (cor na penúltima, tamanho na última)
  IF n >= 3 THEN
    prev_part := btrim(parts[n-1]);
    IF prev_part ~ '^\d{1,2}([,\.]\d)?(/\d{1,2})?$' THEN
      RETURN btrim(array_to_string(parts[1:n-2], ' - '));
    END IF;
  END IF;

  -- caso só tamanho na última: "27", "33/34"
  IF last_part ~ '^\d{1,2}([,\.]\d)?(/\d{1,2})?$' THEN
    RETURN btrim(array_to_string(parts[1:n-1], ' - '));
  END IF;

  -- caso só cor: texto puro curto (até 3 palavras)
  IF last_part ~* '^[a-zà-ÿ]+( [a-zà-ÿ]+){0,2}$' THEN
    RETURN btrim(array_to_string(parts[1:n-1], ' - '));
  END IF;

  RETURN btrim(p_name);
END $function$;

-- 2) Apaga os 78 duplicados em product_master_data
--    Critério: parent_sku no formato "ROOT-COR-TAM" + zero pos_products + pai existente
DELETE FROM public.product_master_data pmd
WHERE pmd.parent_sku ~ '^[0-9]+-[A-Z]+-[0-9/]+$'
  AND NOT EXISTS (
    SELECT 1 FROM public.pos_products pp WHERE pp.parent_sku = pmd.parent_sku
  )
  AND EXISTS (
    SELECT 1 FROM public.product_master_data pmd2
    WHERE pmd2.parent_sku = split_part(pmd.parent_sku, '-', 1)
  );

-- 3) Apaga os masters duplicados em products_master que tenham zero variantes
--    Critério: sku_root no formato "ROOT-COR-TAM" + zero product_variants
DELETE FROM public.products_master pm
WHERE pm.sku_root ~ '^[0-9]+-[A-Z]+-[0-9/]+$'
  AND NOT EXISTS (
    SELECT 1 FROM public.product_variants pv WHERE pv.master_id = pm.id
  );
