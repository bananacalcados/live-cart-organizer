-- 1) Novas colunas agregadas por cliente
ALTER TABLE public.customers_unified
  ADD COLUMN IF NOT EXISTS purchased_stores text[],
  ADD COLUMN IF NOT EXISTS payment_methods  text[];

-- 2) Normalizador de forma de pagamento (texto livre -> rótulos canônicos)
CREATE OR REPLACE FUNCTION public.parse_payment_methods(p_text text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n text := public.bc_norm_txt(p_text);
  r text[] := '{}';
BEGIN
  IF n IS NULL OR n = '' THEN RETURN r; END IF;
  IF n LIKE '%pix%'        THEN r := array_append(r, 'Pix'); END IF;
  IF n LIKE '%credito%'    THEN r := array_append(r, 'Cartão de crédito'); END IF;
  IF n LIKE '%debito%'     THEN r := array_append(r, 'Cartão de débito'); END IF;
  IF n LIKE '%crediario%' OR n LIKE '%tidas%' OR n LIKE '%multicredito%'
                           THEN r := array_append(r, 'Crediário'); END IF;
  IF n LIKE '%vps%' OR n LIKE '%vale-presente%' OR n LIKE '%vale presente%' OR n = 'vp'
                           THEN r := array_append(r, 'VP'); END IF;
  IF n LIKE '%vale-troca%' OR n LIKE '%vale troca%'
                           THEN r := array_append(r, 'Vale-troca'); END IF;
  IF n LIKE '%dinheiro%'   THEN r := array_append(r, 'Dinheiro'); END IF;
  IF n LIKE '%shopify%' OR n LIKE '%mercadopago%' OR n LIKE '%checkout%'
     OR n LIKE '%vindi%' OR n LIKE '%appmax%' OR n LIKE '%pagar.me%' OR n LIKE '%pagarme%'
     OR n LIKE '%venda online%' OR n LIKE '%boleto%'
                           THEN r := array_append(r, 'Online'); END IF;
  RETURN r;
END; $$;

-- 3) Recalcula loja + forma de pagamento por cliente (a partir de pos_sales)
CREATE OR REPLACE FUNCTION public.recalc_customer_payment_store_attrs(p_customer uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH agg AS (
    SELECT s.customer_unified_id AS cid,
      array_agg(DISTINCT st.name) FILTER (WHERE st.name IS NOT NULL) AS stores,
      array_agg(DISTINCT pm) FILTER (WHERE pm IS NOT NULL)           AS pays
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
         payment_methods  = agg.pays
  FROM agg
  WHERE cu.id = agg.cid;
END; $$;

-- 4) Trigger: mantém atualizado a cada nova venda (insert/update de pagamento ou loja)
CREATE OR REPLACE FUNCTION public.trg_recalc_customer_pay_store_on_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_unified_id IS NOT NULL THEN
    PERFORM public.recalc_customer_payment_store_attrs(NEW.customer_unified_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_pos_sale_pay_store_attrs ON public.pos_sales;
CREATE TRIGGER trg_pos_sale_pay_store_attrs
AFTER INSERT OR UPDATE OF payment_method, store_id, customer_unified_id ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_customer_pay_store_on_sale();

-- 5) Backfill único de toda a base
SELECT public.recalc_customer_payment_store_attrs(NULL);

-- 6) View do CRM expõe os novos campos
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
    purchased_sizes,
    purchased_stores,
    payment_methods
   FROM customers_unified cu
  WHERE is_archived = false;