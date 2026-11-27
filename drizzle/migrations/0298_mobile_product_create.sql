CREATE TABLE public.mobile_product_requests (
  request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('create','add_variants')),
  master_id uuid,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mobile_product_requests TO authenticated;
GRANT ALL ON public.mobile_product_requests TO service_role;
ALTER TABLE public.mobile_product_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own mobile product requests" ON public.mobile_product_requests FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public._mobile_name_key(p text) RETURNS text
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT lower(public.unaccent(regexp_replace(btrim(coalesce(p,'')), '\s+', ' ', 'g')))
$$;
REVOKE EXECUTE ON FUNCTION public._mobile_name_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mobile_name_key(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._mobile_can_create() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'))
$$;
REVOKE EXECUTE ON FUNCTION public._mobile_can_create() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mobile_can_create() TO authenticated, service_role;

-- Nomes parecidos (aviso) e igual (bloqueio)
CREATE OR REPLACE FUNCTION public.mobile_product_name_hints(p_term text, p_limit int DEFAULT 5)
RETURNS TABLE(id uuid, name text, sku_root text, exact boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE k text := public._mobile_name_key(p_term);
BEGIN
  IF NOT public._mobile_can_create() OR length(k) < 3 THEN RETURN; END IF;
  RETURN QUERY
    SELECT m.id, m.name, m.sku_root, public._mobile_name_key(m.name) = k
    FROM public.products_master m
    WHERE public._mobile_name_key(m.name) LIKE '%' || k || '%'
       OR similarity(public._mobile_name_key(m.name), k) > 0.45
    ORDER BY (public._mobile_name_key(m.name) = k) DESC, similarity(public._mobile_name_key(m.name), k) DESC, m.name
    LIMIT least(greatest(coalesce(p_limit,5),1),5);
END $$;
REVOKE EXECUTE ON FUNCTION public.mobile_product_name_hints(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_product_name_hints(text,int) TO authenticated, service_role;

-- Cópia em SQL do que create-master-product-pos / pos-add-variants fazem no PDV.
CREATE OR REPLACE FUNCTION public._mobile_pos_sync(p_master_id uuid, p_variant_ids uuid[], p_store_id uuid, p_write_pmd boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  m public.products_master%ROWTYPE;
  v record; s record;
  v_parent text; v_color text; v_size text; v_variant text; v_name text;
  v_cost numeric; v_sale numeric; v_entry int; v_existing uuid; v_new uuid;
  v_reasons text[] := ARRAY[]::text[]; v_stores int;
  v_stock_store uuid := CASE WHEN p_store_id = '2bd2c08d-321c-47ee-98a9-e27e936818ab' THEN '1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2'::uuid ELSE p_store_id END;
BEGIN
  SELECT * INTO m FROM public.products_master WHERE id = p_master_id;
  v_parent := coalesce(m.sku_root, 'PMSTR-' || m.id::text);
  IF p_write_pmd THEN
    IF m.ncm IS NULL OR length(m.ncm) < 8 THEN v_reasons := v_reasons || 'NCM ausente/inválido'; END IF;
    IF coalesce(m.cost_price,0) <= 0 THEN v_reasons := v_reasons || 'Custo ausente'; END IF;
    IF coalesce(m.sale_price,0) <= 0 THEN v_reasons := v_reasons || 'Preço de venda ausente'; END IF;
    INSERT INTO public.product_master_data (parent_sku,name,description,brand,category,classe_produto,ncm,cest,cfop,origem,unidade,
      cost_price,sale_price,weight_kg,height_cm,width_cm,length_cm,images,shopify_product_id,tiny_product_id,is_active,needs_review,review_reason)
    VALUES (v_parent,m.name,m.description,m.brand,m.category,m.classe_produto,m.ncm,m.cest,NULL,m.origem,coalesce(m.unidade,'PC'),
      m.cost_price,m.sale_price,m.weight_kg,m.height_cm,m.width_cm,m.length_cm,coalesce(m.images,ARRAY[]::text[]),m.shopify_product_id,m.tiny_product_id,true,
      cardinality(v_reasons) > 0, CASE WHEN cardinality(v_reasons) > 0 THEN array_to_string(v_reasons,'; ') END)
    ON CONFLICT (parent_sku) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, brand=EXCLUDED.brand, category=EXCLUDED.category,
      classe_produto=EXCLUDED.classe_produto, ncm=EXCLUDED.ncm, cest=EXCLUDED.cest, cfop=EXCLUDED.cfop, origem=EXCLUDED.origem, unidade=EXCLUDED.unidade,
      cost_price=EXCLUDED.cost_price, sale_price=EXCLUDED.sale_price, weight_kg=EXCLUDED.weight_kg, height_cm=EXCLUDED.height_cm, width_cm=EXCLUDED.width_cm,
      length_cm=EXCLUDED.length_cm, images=EXCLUDED.images, shopify_product_id=EXCLUDED.shopify_product_id, tiny_product_id=EXCLUDED.tiny_product_id,
      is_active=EXCLUDED.is_active, needs_review=EXCLUDED.needs_review, review_reason=EXCLUDED.review_reason;
  END IF;
  SELECT count(*) INTO v_stores FROM public.pos_stores WHERE is_active AND is_simulation = false;
  IF v_stores = 0 THEN RAISE EXCEPTION 'Nenhuma loja PDV ativa cadastrada.'; END IF;
  FOR s IN SELECT id FROM public.pos_stores WHERE is_active AND is_simulation = false ORDER BY name LOOP
    FOR v IN SELECT * FROM public.product_variants WHERE id = ANY(p_variant_ids) ORDER BY id LOOP
      v_cost := coalesce(v.cost_price_override, m.cost_price);
      v_sale := coalesce(v.sale_price_override, m.sale_price);
      v_color := btrim(coalesce(v.color,'')); v_size := btrim(coalesce(v.size,''));
      v_variant := regexp_replace(btrim(v_color || ' ' || v_size), '\s+', ' ', 'g');
      v_name := regexp_replace(btrim(m.name || ' - ' || v_color || ' ' || v_size), '\s+', ' ', 'g');
      v_entry := CASE WHEN s.id = v_stock_store THEN greatest(coalesce(v.initial_stock,0),0) ELSE 0 END;
      SELECT id INTO v_existing FROM public.pos_products WHERE store_id = s.id AND barcode = v.gtin LIMIT 1;
      IF v_existing IS NOT NULL THEN
        UPDATE public.pos_products SET name=v_name, sku=v.sku, parent_sku=v_parent, color=nullif(v_color,''), size=nullif(v_size,''),
          variant=v_variant, cost_price=v_cost, price=v_sale, is_active=true WHERE id = v_existing;
      ELSE
        INSERT INTO public.pos_products (store_id,name,sku,parent_sku,barcode,color,size,variant,cost_price,price,stock,is_active)
        VALUES (s.id,v_name,v.sku,v_parent,v.gtin,nullif(v_color,''),nullif(v_size,''),v_variant,v_cost,v_sale,v_entry,true)
        RETURNING id INTO v_new;
        IF v_entry > 0 THEN
          INSERT INTO public.pos_stock_adjustments (store_id,product_id,sku,barcode,product_name,direction,quantity,previous_stock,new_stock,movement_type,reason,user_id)
          VALUES (s.id,v_new,v.sku,v.gtin,v_name,'in',v_entry,0,v_entry,'entrada','Entrada inicial do cadastro do produto',auth.uid());
        END IF;
      END IF;
      v_existing := NULL;
    END LOOP;
  END LOOP;
  IF p_write_pmd THEN
    UPDATE public.products_master SET tiny_product_id = 'pdv-all-' || v_stores WHERE id = p_master_id;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public._mobile_pos_sync(uuid,uuid[],uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mobile_pos_sync(uuid,uuid[],uuid,boolean) TO service_role;

-- Conferência final: código de etiqueta, linha em cada loja ativa e preço certo.
CREATE OR REPLACE FUNCTION public._mobile_check_created(p_master_id uuid, p_variant_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_bad int; v_out jsonb;
BEGIN
  SELECT count(*) INTO v_bad FROM public.product_variants v
   WHERE v.id = ANY(p_variant_ids) AND NOT EXISTS (SELECT 1 FROM public.product_variant_codes c WHERE c.variant_id = v.id);
  IF v_bad > 0 THEN RAISE EXCEPTION 'Variação sem código de etiqueta; nada foi gravado.'; END IF;
  SELECT count(*) INTO v_bad FROM public.product_variants v CROSS JOIN public.pos_stores s
   JOIN public.products_master m ON m.id = v.master_id
   WHERE v.id = ANY(p_variant_ids) AND s.is_active AND s.is_simulation = false
     AND NOT EXISTS (SELECT 1 FROM public.pos_products p WHERE p.store_id = s.id AND p.barcode = v.gtin
        AND p.price IS NOT DISTINCT FROM coalesce(v.sale_price_override, m.sale_price));
  IF v_bad > 0 THEN RAISE EXCEPTION 'Variação sem linha no PDV ou com preço diferente; nada foi gravado.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',v.id,'color',v.color,'size',v.size,'gtin',v.gtin,'sku',v.sku,'code',c.code,'qty',coalesce(v.initial_stock,0)) ORDER BY v.color, v.size)
    INTO v_out FROM public.product_variants v JOIN public.product_variant_codes c ON c.variant_id = v.id WHERE v.id = ANY(p_variant_ids);
  RETURN coalesce(v_out,'[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public._mobile_check_created(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mobile_check_created(uuid,uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public._mobile_check_payload(p_variants jsonb, p_store_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v_n int; v_d int;
BEGIN
  IF p_store_id NOT IN ('4ade7b44-5043-4ab1-a124-7a6ab5468e29','1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2') THEN
    RAISE EXCEPTION 'Escolha a Loja Centro ou a Loja Pérola para o saldo inicial.'; END IF;
  IF jsonb_typeof(p_variants) <> 'array' OR jsonb_array_length(p_variants) = 0 THEN RAISE EXCEPTION 'Adicione pelo menos uma variação.'; END IF;
  IF jsonb_array_length(p_variants) > 200 THEN RAISE EXCEPTION 'No máximo 200 variações por vez.'; END IF;
  SELECT count(*), count(DISTINCT public._mobile_name_key(e->>'color') || '|' || public._mobile_name_key(e->>'size')) INTO v_n, v_d FROM jsonb_array_elements(p_variants) e;
  IF v_n <> v_d THEN RAISE EXCEPTION 'Há cor e tamanho repetidos na lista.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_variants) e WHERE btrim(coalesce(e->>'color','')) = '' OR btrim(coalesce(e->>'size','')) = ''
      OR coalesce((e->>'initial_stock')::int,0) < 0 OR coalesce((e->>'initial_stock')::int,0) > 9999) THEN
    RAISE EXCEPTION 'Todas as variações precisam de cor, tamanho e saldo entre 0 e 9999.'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public._mobile_check_payload(jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mobile_check_payload(jsonb,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mobile_create_product(p_request_id uuid, p_master jsonb, p_variants jsonb, p_store_id uuid, p_gender text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prev jsonb; v_got uuid; v_dup uuid; v_master uuid; v_ids uuid[]; v_brand text; v_out jsonb;
BEGIN
  IF NOT public._mobile_can_create() THEN RAISE EXCEPTION 'Sem permissão para criar produtos'; END IF;
  INSERT INTO public.mobile_product_requests(request_id,user_id,kind) VALUES (p_request_id, auth.uid(), 'create')
    ON CONFLICT (request_id) DO NOTHING RETURNING request_id INTO v_got;
  IF v_got IS NULL THEN
    SELECT result INTO v_prev FROM public.mobile_product_requests WHERE request_id = p_request_id AND user_id = auth.uid();
    IF v_prev IS NULL THEN RAISE EXCEPTION 'Pedido de criação repetido.'; END IF;
    RETURN v_prev || jsonb_build_object('replayed', true);
  END IF;
  IF btrim(coalesce(p_master->>'name','')) = '' THEN RAISE EXCEPTION 'Informe o nome do produto.'; END IF;
  SELECT id INTO v_dup FROM public.products_master WHERE public._mobile_name_key(name) = public._mobile_name_key(p_master->>'name') LIMIT 1;
  IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'NOME_DUPLICADO:%', v_dup; END IF;
  PERFORM public._mobile_check_payload(p_variants, p_store_id);
  v_brand := btrim(coalesce(p_master->>'brand',''));
  IF v_brand <> '' AND NOT EXISTS (SELECT 1 FROM public.product_brands WHERE lower(name) = lower(v_brand)) THEN
    INSERT INTO public.product_brands(name, slug) VALUES (v_brand, btrim(regexp_replace(lower(v_brand), '[^a-z0-9]+', '-', 'g'), '-'));
  END IF;
  v_master := public.create_product_with_variants(p_master, p_variants);
  IF coalesce(p_gender,'') <> '' THEN
    UPDATE public.products_master SET gender = p_gender, gender_source = 'manual' WHERE id = v_master;
  END IF;
  SELECT array_agg(id) INTO v_ids FROM public.product_variants WHERE master_id = v_master;
  PERFORM public._mobile_pos_sync(v_master, v_ids, p_store_id, true);
  v_out := jsonb_build_object('master_id', v_master, 'store_id', p_store_id, 'variants', public._mobile_check_created(v_master, v_ids));
  UPDATE public.mobile_product_requests SET master_id = v_master, result = v_out WHERE request_id = p_request_id;
  RETURN v_out;
END $$;
REVOKE EXECUTE ON FUNCTION public.mobile_create_product(uuid,jsonb,jsonb,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_create_product(uuid,jsonb,jsonb,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mobile_add_variants(p_request_id uuid, p_master_id uuid, p_variants jsonb, p_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prev jsonb; v_got uuid; v_root text; e jsonb; v_ids uuid[] := ARRAY[]::uuid[]; v_id uuid; v_base text; v_out jsonb;
BEGIN
  IF NOT public._mobile_can_create() THEN RAISE EXCEPTION 'Sem permissão para criar produtos'; END IF;
  INSERT INTO public.mobile_product_requests(request_id,user_id,kind,master_id) VALUES (p_request_id, auth.uid(), 'add_variants', p_master_id)
    ON CONFLICT (request_id) DO NOTHING RETURNING request_id INTO v_got;
  IF v_got IS NULL THEN
    SELECT result INTO v_prev FROM public.mobile_product_requests WHERE request_id = p_request_id AND user_id = auth.uid();
    IF v_prev IS NULL THEN RAISE EXCEPTION 'Pedido repetido.'; END IF;
    RETURN v_prev || jsonb_build_object('replayed', true);
  END IF;
  SELECT sku_root INTO v_root FROM public.products_master WHERE id = p_master_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  PERFORM public._mobile_check_payload(p_variants, p_store_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_variants) x JOIN public.product_variants v ON v.master_id = p_master_id
      AND public._mobile_name_key(v.color) = public._mobile_name_key(x->>'color') AND public._mobile_name_key(v.size) = public._mobile_name_key(x->>'size')) THEN
    RAISE EXCEPTION 'Essa cor e tamanho já existem neste produto.'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    v_base := v_root || '-' || COALESCE(NULLIF(upper(regexp_replace(e->>'color', '[^A-Za-z0-9]', '', 'g')), ''), 'UN')
                     || '-' || COALESCE(NULLIF(regexp_replace(e->>'size', '[^A-Za-z0-9]', '', 'g'), ''), 'U');
    INSERT INTO public.product_variants (master_id, sku, gtin, color, size, cost_price_override, sale_price_override, weight_kg_override, initial_stock, is_active)
    VALUES (p_master_id,
      coalesce(nullif(btrim(e->>'sku'),''), public.gen_unique_variant_sku(v_base)),
      coalesce(nullif(btrim(e->>'gtin'),''), public.gen_unique_ean13()),
      btrim(e->>'color'), btrim(e->>'size'),
      NULLIF(e->>'cost_price_override','')::numeric, NULLIF(e->>'sale_price_override','')::numeric, NULLIF(e->>'weight_kg_override','')::numeric,
      COALESCE((e->>'initial_stock')::int,0), true)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  PERFORM public._mobile_pos_sync(p_master_id, v_ids, p_store_id, false);
  v_out := jsonb_build_object('master_id', p_master_id, 'store_id', p_store_id, 'variants', public._mobile_check_created(p_master_id, v_ids));
  UPDATE public.mobile_product_requests SET result = v_out WHERE request_id = p_request_id;
  RETURN v_out;
END $$;
REVOKE EXECUTE ON FUNCTION public.mobile_add_variants(uuid,uuid,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_add_variants(uuid,uuid,jsonb,uuid) TO authenticated, service_role;