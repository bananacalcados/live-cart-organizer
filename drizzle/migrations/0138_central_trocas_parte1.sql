-- 1) Origem da entrega no rastreio
ALTER TABLE public.shipment_simulations
  ADD COLUMN IF NOT EXISTS delivered_source text;
ALTER TABLE public.shipment_simulations
  ADD CONSTRAINT shipment_simulations_delivered_source_chk
  CHECK (delivered_source IS NULL OR delivered_source IN ('carrier','customer_informed','manual'));

CREATE TABLE IF NOT EXISTS public.shipment_unmapped_last_events (
  simulation_id uuid PRIMARY KEY,
  real_carrier text,
  last_description text,
  last_at timestamptz,
  logged_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.shipment_unmapped_last_events TO service_role;
GRANT SELECT ON public.shipment_unmapped_last_events TO authenticated;
ALTER TABLE public.shipment_unmapped_last_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read unmapped tracking events" ON public.shipment_unmapped_last_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Backfill único e idempotente (J&T e Transportadora), mesmo mapeamento do rastreio
WITH hits AS (
  SELECT s.id, max((e->>'at')::timestamptz) AS at
  FROM public.shipment_simulations s
  CROSS JOIN LATERAL jsonb_array_elements(s.real_events) e
  WHERE s.delivered_at IS NULL
    AND (
      (s.real_carrier ILIKE 'J&T%' AND e->>'description' ~* '^\s*(\[[^\]]*\]\s*)?o pacote foi assinado')
      OR (s.real_carrier ILIKE 'Transportadora%' AND e->>'description' ~* '^\s*entrega realizada')
    )
  GROUP BY s.id
)
UPDATE public.shipment_simulations s
   SET delivered_at = h.at, status = 'delivered', stage = 'entregue', delivered_source = 'carrier'
  FROM hits h WHERE s.id = h.id;

UPDATE public.shipment_simulations
   SET delivered_source = 'carrier'
 WHERE delivered_at IS NOT NULL AND delivered_source IS NULL AND real_carrier ILIKE 'Correios%';

CREATE OR REPLACE FUNCTION public.log_unmapped_delivery_events()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.shipment_unmapped_last_events (simulation_id, real_carrier, last_description, last_at)
  SELECT s.id, s.real_carrier, l.d, l.at
  FROM public.shipment_simulations s
  CROSS JOIN LATERAL (
    SELECT e->>'description' d, (e->>'at')::timestamptz at
    FROM jsonb_array_elements(s.real_events) e ORDER BY (e->>'at')::timestamptz DESC LIMIT 1
  ) l
  WHERE s.delivered_at IS NULL AND s.merged_into_id IS NULL
    AND jsonb_array_length(s.real_events) > 0
    AND s.posted_at < now() - interval '12 days'
  ON CONFLICT (simulation_id) DO UPDATE
    SET last_description = EXCLUDED.last_description, last_at = EXCLUDED.last_at, logged_at = now()
    WHERE shipment_unmapped_last_events.last_description IS DISTINCT FROM EXCLUDED.last_description;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_unmapped_delivery_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_unmapped_delivery_events() TO authenticated, service_role;

-- 2) Configurações
CREATE TABLE public.support_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  exchange_window_days integer NOT NULL DEFAULT 7,
  return_window_days integer NOT NULL DEFAULT 7,
  ship_replacement_when text NOT NULL DEFAULT 'on_first_scan' CHECK (ship_replacement_when IN ('on_code','on_first_scan')),
  max_offer_attempts integer NOT NULL DEFAULT 1,
  central_base_url text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.support_settings TO authenticated;
GRANT ALL ON public.support_settings TO service_role;
ALTER TABLE public.support_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read support settings" ON public.support_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins update support settings" ON public.support_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.support_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- 3) Solicitações (tabela existente)
ALTER TYPE public.exchange_status ADD VALUE IF NOT EXISTS 'escalado';
ALTER TABLE public.exchange_requests
  ADD COLUMN IF NOT EXISTS order_ref text,
  ADD COLUMN IF NOT EXISTS request_type text CHECK (request_type IS NULL OR request_type IN ('troca','devolucao')),
  ADD COLUMN IF NOT EXISTS channel_origin text CHECK (channel_origin IS NULL OR channel_origin IN ('instagram','whatsapp','site','agent')),
  ADD COLUMN IF NOT EXISTS delivered_at_used timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_source text CHECK (delivered_source IS NULL OR delivered_source IN ('carrier','customer_informed','manual')),
  ADD COLUMN IF NOT EXISTS customer_reported_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS eligibility text NOT NULL DEFAULT 'not_checked' CHECK (eligibility IN ('eligible','needs_human','not_checked')),
  ADD COLUMN IF NOT EXISTS eligibility_reason text,
  ADD COLUMN IF NOT EXISTS new_sku text,
  ADD COLUMN IF NOT EXISTS new_variant_id text,
  ADD COLUMN IF NOT EXISTS purchase_order_status text,
  ADD COLUMN IF NOT EXISTS reverse_shipment_id uuid,
  ADD COLUMN IF NOT EXISTS trocas_devolucoes_id uuid,
  ADD COLUMN IF NOT EXISTS escalated_reason text,
  ADD COLUMN IF NOT EXISTS sale_id uuid;
CREATE INDEX IF NOT EXISTS exchange_requests_order_ref_idx ON public.exchange_requests (order_ref);
CREATE INDEX IF NOT EXISTS exchange_requests_phone_idx ON public.exchange_requests (phone);
CREATE INDEX IF NOT EXISTS exchange_requests_status_idx ON public.exchange_requests (status);

-- 4) Links únicos
CREATE TABLE public.support_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  order_ref text NOT NULL,
  customer_phone text,
  request_type text NOT NULL CHECK (request_type IN ('troca','devolucao')),
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('ai','agent','system')),
  created_by_user uuid,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.support_links TO service_role;
ALTER TABLE public.support_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX support_links_order_ref_idx ON public.support_links (order_ref);

CREATE OR REPLACE FUNCTION public.create_support_link(p_order_ref text, p_request_type text, p_created_by_kind text, p_customer_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_token text; v_base text; v_id uuid; v_exp timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce(trim(p_order_ref),'') = '' OR length(p_order_ref) > 100 THEN RAISE EXCEPTION 'order_ref inválido'; END IF;
  IF p_request_type NOT IN ('troca','devolucao') THEN RAISE EXCEPTION 'request_type inválido'; END IF;
  IF p_created_by_kind NOT IN ('ai','agent','system') THEN RAISE EXCEPTION 'created_by_kind inválido'; END IF;
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  INSERT INTO public.support_links (token_hash, order_ref, customer_phone, request_type, created_by_kind, created_by_user)
  VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), trim(p_order_ref), p_customer_phone, p_request_type, p_created_by_kind, auth.uid())
  RETURNING id, expires_at INTO v_id, v_exp;
  SELECT central_base_url INTO v_base FROM public.support_settings LIMIT 1;
  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp,
    'url', CASE WHEN coalesce(v_base,'') = '' THEN NULL ELSE rtrim(v_base,'/') || '/' || v_token END);
END $$;
REVOKE EXECUTE ON FUNCTION public.create_support_link(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_link(text,text,text,text) TO authenticated, service_role;

-- 5) Elegibilidade
CREATE OR REPLACE FUNCTION public.check_exchange_eligibility(p_order_ref text, p_request_type text, p_customer_reported_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r text := trim(coalesce(p_order_ref,''));
  v_sale uuid; v_channel text; v_join text; v_sim record; v_days int; v_est int; v_deadline timestamptz;
  v_deliv timestamptz; v_src text; v_track text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_request_type NOT IN ('troca','devolucao') THEN RAISE EXCEPTION 'request_type inválido'; END IF;
  SELECT CASE WHEN p_request_type='troca' THEN exchange_window_days ELSE return_window_days END INTO v_days FROM support_settings LIMIT 1;
  v_days := coalesce(v_days, 7);

  IF r ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_sale FROM pos_sales WHERE id = r::uuid;
    IF v_sale IS NOT NULL THEN v_join := 'pos_sales.id'; ELSE
      SELECT id INTO v_sale FROM pos_sales WHERE source_order_id = r::uuid ORDER BY created_at DESC LIMIT 1;
      IF v_sale IS NOT NULL THEN v_join := 'orders.id→pos_sales.source_order_id'; END IF;
    END IF;
  END IF;
  IF v_sale IS NULL AND r ~* '^[0-9a-f]{8}$' THEN
    SELECT sale_id INTO v_sale FROM shipment_simulations WHERE order_reference = upper(r) AND sale_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'shipment_simulations.order_reference'; END IF;
  END IF;
  IF v_sale IS NULL AND r <> '' THEN
    SELECT id INTO v_sale FROM pos_sales WHERE external_order_id = r OR tiny_order_number = r ORDER BY created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'pos_sales.external_order_id/tiny_order_number'; END IF;
  END IF;
  IF v_sale IS NULL AND r <> '' THEN
    SELECT ps.id INTO v_sale FROM orders o JOIN pos_sales ps ON ps.source_order_id = o.id
     WHERE o.shopify_order_id = r OR o.shopify_order_name IN (r, '#'||ltrim(r,'#')) ORDER BY ps.created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'orders.shopify_order→pos_sales.source_order_id'; END IF;
  END IF;
  IF v_sale IS NULL AND r <> '' THEN
    SELECT eo.freight_tracking_code INTO v_track FROM expedition_orders eo
     WHERE eo.shopify_order_id = r OR eo.shopify_order_number = ltrim(r,'#') OR eo.shopify_order_name IN (r, '#'||ltrim(r,'#'))
     ORDER BY eo.created_at DESC LIMIT 1;
    IF v_track IS NULL THEN v_track := r; END IF;
    SELECT sale_id INTO v_sale FROM shipment_simulations WHERE upper(real_tracking_code) = upper(v_track) AND sale_id IS NOT NULL ORDER BY created_at DESC LIMIT 1;
    IF v_sale IS NOT NULL THEN v_join := 'tracking_code→shipment_simulations'; END IF;
  END IF;

  IF v_sale IS NOT NULL THEN SELECT sales_channel INTO v_channel FROM pos_sales WHERE id = v_sale; END IF;
  IF v_sale IS NULL OR coalesce(v_channel,'presencial') NOT IN ('site','live','link_online','whatsapp') THEN
    RETURN jsonb_build_object('eligible','needs_human','reason','pedido_nao_encontrado_ou_fisico','delivered_at',NULL,
      'delivered_source',NULL,'deadline_at',NULL,'window_days',v_days,'carrier',NULL,'join_used',v_join,'sale_id',v_sale,'sales_channel',v_channel);
  END IF;

  SELECT id, delivered_at, delivered_source, real_carrier, real_tracking_code, posted_at INTO v_sim
    FROM shipment_simulations WHERE sale_id = v_sale AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  v_join := v_join || ' + shipment_simulations.sale_id';

  IF v_sim.delivered_at IS NOT NULL THEN
    v_deadline := v_sim.delivered_at + make_interval(days => v_days);
    RETURN jsonb_build_object('eligible', CASE WHEN now() <= v_deadline THEN 'eligible' ELSE 'needs_human' END,
      'reason', CASE WHEN now() <= v_deadline THEN 'dentro_do_prazo' ELSE 'fora_do_prazo' END,
      'delivered_at', v_sim.delivered_at, 'delivered_source', coalesce(v_sim.delivered_source,'carrier'),
      'deadline_at', v_deadline, 'window_days', v_days, 'carrier', v_sim.real_carrier, 'join_used', v_join, 'sale_id', v_sale);
  END IF;

  IF p_customer_reported_date IS NOT NULL THEN
    v_deliv := (p_customer_reported_date::timestamp AT TIME ZONE 'America/Sao_Paulo');
    v_deadline := v_deliv + make_interval(days => v_days);
    SELECT q.delivery_days INTO v_est FROM expedition_orders eo JOIN expedition_freight_quotes q ON q.expedition_order_id = eo.id AND q.is_selected
      WHERE v_sim.real_tracking_code IS NOT NULL AND upper(eo.freight_tracking_code) = upper(v_sim.real_tracking_code) ORDER BY q.quoted_at DESC LIMIT 1;
    RETURN jsonb_build_object(
      'eligible', CASE WHEN p_customer_reported_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date OR now() > v_deadline
                       OR (v_est IS NOT NULL AND v_sim.posted_at IS NOT NULL
                           AND abs(p_customer_reported_date - (v_sim.posted_at + make_interval(days => v_est))::date) > 3)
                  THEN 'needs_human' ELSE 'eligible' END,
      'reason','data_informada_pelo_cliente','delivered_at',v_deliv,'delivered_source','customer_informed',
      'deadline_at',v_deadline,'window_days',v_days,'carrier',v_sim.real_carrier,'estimated_delivery_days',v_est,'join_used',v_join,'sale_id',v_sale);
  END IF;

  RETURN jsonb_build_object('eligible','needs_human','reason','sem_data_de_entrega','delivered_at',NULL,'delivered_source',NULL,
    'deadline_at',NULL,'window_days',v_days,'carrier',v_sim.real_carrier,'join_used',v_join,'sale_id',v_sale);
END $$;
REVOKE EXECUTE ON FUNCTION public.check_exchange_eligibility(text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_exchange_eligibility(text,text,date) TO authenticated, service_role;

-- 6) Marcador de reposição
CREATE TABLE public.product_restock_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE,
  shopify_product_id text UNIQUE,
  restock_mode text NOT NULL DEFAULT 'garantida' CHECK (restock_mode IN ('garantida','sob_consulta')),
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sku IS NOT NULL OR shopify_product_id IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_restock_flags TO authenticated;
GRANT ALL ON public.product_restock_flags TO service_role;
ALTER TABLE public.product_restock_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read restock flags" ON public.product_restock_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage restock flags" ON public.product_restock_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_restock_mode(p_sku text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT restock_mode FROM product_restock_flags WHERE sku = p_sku OR shopify_product_id = p_sku LIMIT 1), 'garantida')
$$;
REVOKE EXECUTE ON FUNCTION public.get_restock_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_restock_mode(text) TO authenticated, service_role;