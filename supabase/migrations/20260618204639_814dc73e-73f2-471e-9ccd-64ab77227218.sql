-- ============================================================
-- Filtros de Marca / Categoria / Tamanho na Matriz RFM
-- ============================================================

-- 1) Colunas denormalizadas por cliente (o que ele comprou)
ALTER TABLE public.customers_unified
  ADD COLUMN IF NOT EXISTS purchased_brands     text[],
  ADD COLUMN IF NOT EXISTS purchased_categories text[],
  ADD COLUMN IF NOT EXISTS purchased_sizes      text[];

-- 2) Marca no cadastro de produtos do PDV (pedido do usuário)
ALTER TABLE public.pos_products
  ADD COLUMN IF NOT EXISTS brand text;

-- 3) Normalizador (lower + sem acentos)
CREATE OR REPLACE FUNCTION public.bc_norm_txt(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(translate(coalesce(t,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;

-- 4) Marca a partir do nome (lista oficial do cliente; sem marca = Banana Calçados)
CREATE OR REPLACE FUNCTION public.parse_brand_from_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n text := public.bc_norm_txt(p_name);
BEGIN
  IF n IS NULL OR n = '' THEN RETURN 'Banana Calçados'; END IF;
  IF n LIKE '%beira rio%'  THEN RETURN 'Beira Rio'; END IF;
  IF n LIKE '%renata melo%' THEN RETURN 'Renata Melo'; END IF;
  IF n LIKE '%hugo boss%'  THEN RETURN 'Hugo Boss'; END IF;
  IF n LIKE '%jota pe%' OR n LIKE '%jotape%' THEN RETURN 'Jota Pê'; END IF;
  IF n LIKE '%on cloud%' OR n LIKE '%on claude%' OR n LIKE '%on running%' THEN RETURN 'On'; END IF;
  IF n LIKE '%banana%'     THEN RETURN 'Banana Calçados'; END IF;
  IF n LIKE '%molekinha%'  THEN RETURN 'Molekinha'; END IF;
  IF n LIKE '%moleca%'     THEN RETURN 'Moleca'; END IF;
  IF n LIKE '%modare%'     THEN RETURN 'Modare'; END IF;
  IF n LIKE '%vizzano%'    THEN RETURN 'Vizzano'; END IF;
  IF n LIKE '%mississipi%' OR n LIKE '%mississippi%' THEN RETURN 'Mississipi'; END IF;
  IF n LIKE '%dakota%'     THEN RETURN 'Dakota'; END IF;
  IF n LIKE '%usaflex%'    THEN RETURN 'Usaflex'; END IF;
  IF n LIKE '%pegada%'     THEN RETURN 'Pegada'; END IF;
  IF n LIKE '%nike%'       THEN RETURN 'Nike'; END IF;
  IF n LIKE '%adidas%'     THEN RETURN 'Adidas'; END IF;
  IF n LIKE '%grendha%'    THEN RETURN 'Grendha'; END IF;
  IF n LIKE '%grendene%'   THEN RETURN 'Grendene'; END IF;
  IF n LIKE '%piccadilly%' OR n LIKE '%picadilly%' THEN RETURN 'Piccadilly'; END IF;
  IF n LIKE '%cartago%'    THEN RETURN 'Cartago'; END IF;
  IF n LIKE '%rider%'      THEN RETURN 'Rider'; END IF;
  IF n LIKE '%havaianas%'  THEN RETURN 'Havaianas'; END IF;
  IF n LIKE '%ferracini%'  THEN RETURN 'Ferracini'; END IF;
  RETURN 'Banana Calçados';
END; $$;

-- 5) Categoria/tipo a partir do nome
CREATE OR REPLACE FUNCTION public.parse_category_from_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n text := public.bc_norm_txt(p_name);
BEGIN
  IF n IS NULL OR n = '' THEN RETURN NULL; END IF;
  IF n LIKE '%sapatenis%' THEN RETURN 'Sapatênis'; END IF;
  IF n LIKE '%tenis%' AND (n LIKE '%esportiv%' OR n LIKE '%corrida%' OR n LIKE '%running%' OR n LIKE '%caminhada%' OR n LIKE '%academia%' OR n LIKE '%treino%') THEN RETURN 'Tênis Esportivo'; END IF;
  IF n LIKE '%tenis%' AND (n LIKE '%casual%' OR n LIKE '%sneaker%' OR n LIKE '%samba%') THEN RETURN 'Tênis Casual'; END IF;
  IF n LIKE '%tenis%'     THEN RETURN 'Tênis'; END IF;
  IF n LIKE '%scarpin%'   THEN RETURN 'Scarpin'; END IF;
  IF n LIKE '%salto%'     THEN RETURN 'Salto'; END IF;
  IF n LIKE '%anabela%'   THEN RETURN 'Anabela'; END IF;
  IF n LIKE '%plataforma%' THEN RETURN 'Plataforma'; END IF;
  IF n LIKE '%rasteir%'   THEN RETURN 'Rasteirinha'; END IF;
  IF n LIKE '%papete%'    THEN RETURN 'Papete'; END IF;
  IF n LIKE '%tamanco%'   THEN RETURN 'Tamanco'; END IF;
  IF n LIKE '%mule%'      THEN RETURN 'Mule'; END IF;
  IF n LIKE '%coturno%'   THEN RETURN 'Coturno'; END IF;
  IF n LIKE '%bota%'      THEN RETURN 'Bota'; END IF;
  IF n LIKE '%sapatilha%' THEN RETURN 'Sapatilha'; END IF;
  IF n LIKE '%mocassim%' OR n LIKE '%mocass%' THEN RETURN 'Mocassim'; END IF;
  IF n LIKE '%babuche%'   THEN RETURN 'Babuche'; END IF;
  IF n LIKE '%chinelo%'   THEN RETURN 'Chinelo'; END IF;
  IF n LIKE '%slide%'     THEN RETURN 'Slide'; END IF;
  IF n LIKE '%sandalia%'  THEN RETURN 'Sandália'; END IF;
  IF n LIKE '%sapato%'    THEN RETURN 'Sapato'; END IF;
  IF n LIKE '%bolsa%'     THEN RETURN 'Bolsa'; END IF;
  IF n LIKE '%meia%'      THEN RETURN 'Meia'; END IF;
  RETURN 'Outros';
END; $$;

-- 6) Tamanho (número 25-45 delimitado por espaço/barra/hífen)
CREATE OR REPLACE FUNCTION public.parse_size_from_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (regexp_match(coalesce(p_name,''), '(?:^|[ /-])(2[5-9]|3[0-9]|4[0-5])(?:[ /-]|$)'))[1];
$$;

-- 7) Recalcula arrays de marca/categoria/tamanho por cliente
CREATE OR REPLACE FUNCTION public.recalc_customer_product_attributes(p_customer uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH src AS (
    -- Itens de venda do PDV / online / live / shopify
    SELECT s.customer_unified_id AS cid,
           public.parse_brand_from_name(i.product_name) AS brand,
           public.parse_category_from_name(i.product_name) AS category,
           COALESCE(public.parse_size_from_name(i.size),
                    public.parse_size_from_name(i.variant_name),
                    public.parse_size_from_name(i.product_name)) AS size
    FROM public.pos_sale_items i
    JOIN public.pos_sales s ON s.id = i.sale_id
    WHERE s.customer_unified_id IS NOT NULL
      AND coalesce(s.status,'') <> 'cancelled'
      AND (p_customer IS NULL OR s.customer_unified_id = p_customer)

    UNION ALL
    -- Pedidos legados da Zoppy com detalhe de itens (casados por telefone)
    SELECT cu.id AS cid,
           public.parse_brand_from_name(li->'product'->>'name') AS brand,
           public.parse_category_from_name(li->'product'->>'name') AS category,
           public.parse_size_from_name(li->'product'->>'name') AS size
    FROM public.zoppy_sales z
    CROSS JOIN LATERAL jsonb_array_elements(z.line_items) li
    JOIN public.customers_unified cu
      ON cu.phone_suffix8 = right(regexp_replace(coalesce(z.customer_phone,''), '\D', '', 'g'), 8)
    WHERE z.line_items IS NOT NULL
      AND jsonb_typeof(z.line_items) = 'array'
      AND length(regexp_replace(coalesce(z.customer_phone,''), '\D', '', 'g')) >= 10
      AND cu.is_archived = false
      AND (p_customer IS NULL OR cu.id = p_customer)
  ),
  agg AS (
    SELECT cid,
      array_agg(DISTINCT brand)    FILTER (WHERE brand    IS NOT NULL)                       AS brands,
      array_agg(DISTINCT category) FILTER (WHERE category IS NOT NULL AND category <> 'Outros') AS cats,
      array_agg(DISTINCT size)     FILTER (WHERE size     IS NOT NULL)                       AS sizes
    FROM src
    GROUP BY cid
  )
  UPDATE public.customers_unified cu
     SET purchased_brands     = agg.brands,
         purchased_categories = agg.cats,
         purchased_sizes      = agg.sizes
  FROM agg
  WHERE cu.id = agg.cid;
END; $$;

-- 8) Trigger: mantém atualizado a cada novo item de venda
CREATE OR REPLACE FUNCTION public.trg_recalc_customer_attrs_on_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid uuid;
BEGIN
  SELECT customer_unified_id INTO v_cid FROM public.pos_sales WHERE id = NEW.sale_id;
  IF v_cid IS NOT NULL THEN
    PERFORM public.recalc_customer_product_attributes(v_cid);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_pos_sale_item_customer_attrs ON public.pos_sale_items;
CREATE TRIGGER trg_pos_sale_item_customer_attrs
AFTER INSERT ON public.pos_sale_items
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_customer_attrs_on_item();

-- 9) View RFM expõe os novos campos
CREATE OR REPLACE VIEW public.crm_customers_v AS
SELECT id,
    customer_code AS zoppy_id,
    NULLIF(split_part(COALESCE(name, ''::text), ' '::text, 1), ''::text) AS first_name,
    NULLIF(btrim(SUBSTRING(COALESCE(name, ''::text) FROM POSITION((' '::text) IN (COALESCE(name, ''::text))) + 1)), ''::text) AS last_name,
    name,
    phone_e164 AS phone,
    phone_e164,
    phone_suffix8,
    email,
    cpf,
    city,
    state,
    COALESCE(region_type, 'Online'::text) AS region_type,
    ddd,
    rfm_r AS rfm_recency_score,
    rfm_f AS rfm_frequency_score,
    rfm_m AS rfm_monetary_score,
    rfm_total AS rfm_total_score,
    rfm_segment,
    total_orders,
    total_spent,
    avg_ticket,
    last_purchase_at,
    first_purchase_at,
    tags,
    opt_out_mass_dispatch,
    is_archived,
    created_at,
    updated_at,
    gender,
    purchased_brands,
    purchased_categories,
    purchased_sizes
   FROM customers_unified cu
  WHERE is_archived = false;