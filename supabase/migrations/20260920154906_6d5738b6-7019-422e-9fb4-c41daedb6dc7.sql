ALTER TABLE public.pos_sales ADD COLUMN IF NOT EXISTS sales_channel text;
ALTER TABLE public.pos_sales DROP CONSTRAINT IF EXISTS pos_sales_sales_channel_chk;
ALTER TABLE public.pos_sales ADD CONSTRAINT pos_sales_sales_channel_chk CHECK (sales_channel IS NULL OR sales_channel IN ('presencial','whatsapp','live','site','link_online'));

CREATE OR REPLACE FUNCTION public.compute_pos_sale_channel(
  p_external_source text,
  p_source_order_id uuid,
  p_payment_details jsonb,
  p_shipping_address jsonb,
  p_shipping_carrier text,
  p_is_store_pickup boolean
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_origin text := NULLIF(p_payment_details->>'link_origin','');
  v_channel text;
BEGIN
  IF lower(coalesce(p_external_source,'')) = 'shopify' THEN
    RETURN 'site';
  END IF;

  IF p_source_order_id IS NOT NULL THEN
    SELECT e.channel::text INTO v_channel
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE o.id = p_source_order_id;
    IF v_channel = 'site' THEN RETURN 'site'; END IF;
    RETURN 'live';
  END IF;

  IF v_origin = 'whatsapp_chat' THEN RETURN 'whatsapp'; END IF;
  IF v_origin IN ('online_hub','custom_link') THEN RETURN 'link_online'; END IF;

  IF (p_shipping_address IS NOT NULL AND p_shipping_address <> 'null'::jsonb AND p_shipping_address <> '{}'::jsonb)
     OR NULLIF(btrim(coalesce(p_shipping_carrier,'')),'') IS NOT NULL
     OR coalesce(p_is_store_pickup,false) = true THEN
    RETURN 'link_online';
  END IF;

  RETURN 'presencial';
END; $$;

CREATE OR REPLACE FUNCTION public.set_pos_sale_channel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_new text;
BEGIN
  v_new := public.compute_pos_sale_channel(
    NEW.external_source, NEW.source_order_id, NEW.payment_details,
    NEW.shipping_address, NEW.shipping_carrier, NEW.is_store_pickup);
  IF NEW.sales_channel IS DISTINCT FROM v_new THEN
    NEW.sales_channel := v_new;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_set_pos_sale_channel ON public.pos_sales;
CREATE TRIGGER trg_set_pos_sale_channel
BEFORE INSERT OR UPDATE OF external_source, source_order_id, payment_details, shipping_address, shipping_carrier, is_store_pickup
ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.set_pos_sale_channel();

ALTER TABLE public.customers_unified ADD COLUMN IF NOT EXISTS purchased_channels text[];

CREATE OR REPLACE FUNCTION public.recalc_customer_payment_store_attrs(p_customer uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH agg AS (
    SELECT s.customer_unified_id AS cid,
      array_agg(DISTINCT st.name) FILTER (WHERE st.name IS NOT NULL) AS stores,
      array_agg(DISTINCT pm) FILTER (WHERE pm IS NOT NULL)           AS pays,
      array_agg(DISTINCT s.sales_channel) FILTER (WHERE s.sales_channel IS NOT NULL) AS channels
    FROM public.pos_sales s
    LEFT JOIN public.pos_stores st ON st.id = s.store_id
    LEFT JOIN LATERAL unnest(public.parse_payment_methods(s.payment_method)) AS pm ON true
    WHERE s.customer_unified_id IS NOT NULL
      AND coalesce(s.status,'') <> 'cancelled'
      AND (p_customer IS NULL OR s.customer_unified_id = p_customer)
    GROUP BY s.customer_unified_id
  )
  UPDATE public.customers_unified cu
     SET purchased_stores = agg.stores,
         payment_methods  = agg.pays,
         purchased_channels = agg.channels
  FROM agg
  WHERE cu.id = agg.cid;
END; $function$;

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
    COALESCE(NULLIF(btrim(region_type), ''::text), 'online'::text) AS region_type,
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
    purchased_sizes,
    purchased_stores,
    payment_methods,
    lead_temperature,
    legacy_orders,
    legacy_spent,
    purchased_channels
   FROM customers_unified cu
  WHERE is_archived = false AND merged_into_id IS NULL;