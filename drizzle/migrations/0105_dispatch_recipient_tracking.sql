ALTER TABLE public.dispatch_history ADD COLUMN IF NOT EXISTS track_clicks boolean NOT NULL DEFAULT true;
ALTER TABLE public.dispatch_recipients ADD COLUMN IF NOT EXISTS tracking_code text;
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_recipients_tracking_code_uq ON public.dispatch_recipients (tracking_code) WHERE tracking_code IS NOT NULL;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatch_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatch_recipient_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS dispatch_clicked_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS attribution jsonb;
CREATE INDEX IF NOT EXISTS orders_dispatch_id_idx ON public.orders (dispatch_id) WHERE dispatch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS live_selfservice_accesses_dispatch_idx ON public.live_selfservice_accesses ((metadata->>'dispatch_id')) WHERE metadata ? 'dispatch_id';

CREATE TABLE IF NOT EXISTS public.dispatch_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  phone text,
  phone_key text,
  code text NOT NULL,
  page text,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip text,
  first_click boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.dispatch_link_clicks TO authenticated;
GRANT ALL ON public.dispatch_link_clicks TO service_role;
ALTER TABLE public.dispatch_link_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read dispatch clicks" ON public.dispatch_link_clicks FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role) OR has_module_access(auth.uid(), 'marketing'::text) OR has_module_access(auth.uid(), 'management'::text));
CREATE INDEX IF NOT EXISTS dispatch_link_clicks_dispatch_idx ON public.dispatch_link_clicks (dispatch_id, recipient_id);
CREATE INDEX IF NOT EXISTS dispatch_link_clicks_phone_idx ON public.dispatch_link_clicks (phone_key, clicked_at DESC);

-- Códigos curtos por destinatário (idempotente: mantém o existente).
CREATE OR REPLACE FUNCTION public.dispatch_assign_tracking_codes(p_ids uuid[])
RETURNS TABLE(id uuid, code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; c text; i int;
BEGIN
  FOR r IN SELECT dr.id, dr.tracking_code FROM dispatch_recipients dr WHERE dr.id = ANY(p_ids) ORDER BY dr.id LOOP
    c := r.tracking_code;
    IF c IS NULL THEN
      FOR i IN 1..8 LOOP
        c := lower(substr(lpad(to_hex((random()*2147483647)::bigint), 8, '0') || to_hex((random()*65535)::int), 1, 0)); -- placeholder
        c := (SELECT string_agg(substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + floor(random()*36)::int, 1), '') FROM generate_series(1,7));
        BEGIN
          UPDATE dispatch_recipients SET tracking_code = c WHERE dispatch_recipients.id = r.id AND tracking_code IS NULL;
          EXIT;
        EXCEPTION WHEN unique_violation THEN c := NULL;
        END;
      END LOOP;
      SELECT dr.tracking_code INTO c FROM dispatch_recipients dr WHERE dr.id = r.id;
    END IF;
    id := r.id; code := c; RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_assign_tracking_codes(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_assign_tracking_codes(uuid[]) TO service_role;

-- Registro do clique (público: só aceita código existente, nunca devolve telefone).
CREATE OR REPLACE FUNCTION public.dispatch_link_click(p_code text, p_page text DEFAULT NULL, p_ua text DEFAULT NULL, p_ip text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_first boolean; v_n int; h json; v_ua text := p_ua; v_ip text := p_ip;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z0-9]{6,8}$' THEN RETURN NULL; END IF;
  SELECT dr.id, dr.dispatch_id, dr.phone INTO r FROM dispatch_recipients dr WHERE dr.tracking_code = p_code;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_n FROM dispatch_link_clicks WHERE dispatch_id = r.dispatch_id AND recipient_id = r.id;
  IF v_n < 30 THEN
    BEGIN h := current_setting('request.headers', true)::json; EXCEPTION WHEN others THEN h := NULL; END;
    IF v_ua IS NULL AND h IS NOT NULL THEN v_ua := h->>'user-agent'; END IF;
    IF v_ip IS NULL AND h IS NOT NULL THEN v_ip := split_part(coalesce(h->>'x-forwarded-for', h->>'cf-connecting-ip', ''), ',', 1); END IF;
    INSERT INTO dispatch_link_clicks (dispatch_id, recipient_id, phone, phone_key, code, page, user_agent, ip, first_click)
    VALUES (r.dispatch_id, r.id, r.phone, right(regexp_replace(coalesce(r.phone,''), '\D', '', 'g'), 8), p_code,
            left(p_page, 40), left(v_ua, 400), nullif(left(v_ip, 60), ''), v_n = 0);
  END IF;
  RETURN jsonb_build_object('dispatch_id', r.dispatch_id, 'recipient_id', r.id);
END $$;
REVOKE ALL ON FUNCTION public.dispatch_link_click(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_link_click(text, text, text, text) TO anon, authenticated, service_role;

-- Liga o acesso do autoatendimento ao disparo e carimba os pedidos do acesso.
CREATE OR REPLACE FUNCTION public.dispatch_link_access(p_access_id uuid, p_code text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; r record; v_clicked timestamptz; v_source text := 'code'; v_key text; v_touch jsonb; v_ad jsonb;
BEGIN
  SELECT id, event_id, entered_phone, order_ids, metadata, advertising_signals INTO a FROM live_selfservice_accesses WHERE id = p_access_id;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  IF a.metadata ? 'dispatch_id' THEN
    SELECT dr.id, dr.dispatch_id, a.metadata->>'dispatch_code' AS tracking_code INTO r FROM dispatch_recipients dr WHERE dr.id = (a.metadata->>'dispatch_recipient_id')::uuid;
    v_clicked := (a.metadata->>'dispatch_clicked_at')::timestamptz;
  ELSIF p_code ~ '^[a-z0-9]{6,8}$' THEN
    SELECT dr.id, dr.dispatch_id, dr.tracking_code INTO r FROM dispatch_recipients dr WHERE dr.tracking_code = p_code;
    SELECT min(clicked_at) INTO v_clicked FROM dispatch_link_clicks WHERE recipient_id = r.id;
  ELSE
    -- Sem código: casa o telefone digitado com quem clicou num disparo nas últimas 48h.
    v_key := right(regexp_replace(coalesce(a.entered_phone,''), '\D', '', 'g'), 8);
    IF length(v_key) = 8 THEN
      SELECT c.recipient_id AS id, c.dispatch_id, c.code AS tracking_code, c.clicked_at INTO r
      FROM dispatch_link_clicks c WHERE c.phone_key = v_key AND c.clicked_at > now() - interval '48 hours'
      ORDER BY c.clicked_at DESC LIMIT 1;
      v_clicked := r.clicked_at; v_source := 'phone_match';
    END IF;
  END IF;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  v_clicked := coalesce(v_clicked, now());
  IF NOT (a.metadata ? 'dispatch_id') THEN
    UPDATE live_selfservice_accesses SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'dispatch_code', r.tracking_code, 'dispatch_id', r.dispatch_id, 'dispatch_recipient_id', r.id,
      'dispatch_clicked_at', v_clicked, 'dispatch_match', v_source)
    WHERE id = a.id;
  END IF;
  v_touch := jsonb_build_object('dispatch_id', r.dispatch_id, 'recipient_id', r.id, 'code', r.tracking_code, 'clicked_at', v_clicked, 'match', v_source);
  v_ad := CASE WHEN coalesce(a.advertising_signals->>'fbc', a.advertising_signals->>'fbclid') IS NOT NULL
    THEN jsonb_build_object('fbc', a.advertising_signals->>'fbc', 'fbclid', a.advertising_signals->>'fbclid') END;
  IF coalesce(array_length(a.order_ids, 1), 0) > 0 THEN
    UPDATE orders o SET dispatch_id = r.dispatch_id, dispatch_recipient_id = r.id, dispatch_clicked_at = v_clicked,
      attribution = coalesce(o.attribution, '{}'::jsonb) || jsonb_build_object('dispatch_touch', v_touch)
        || CASE WHEN v_ad IS NOT NULL AND NOT (coalesce(o.attribution,'{}'::jsonb) ? 'ad_touch') THEN jsonb_build_object('ad_touch', v_ad) ELSE '{}'::jsonb END
    WHERE o.id = ANY(a.order_ids) AND o.event_id = a.event_id AND o.dispatch_id IS NULL;
  END IF;
  RETURN v_touch;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_link_access(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_link_access(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public._dispatch_can_read() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
      OR has_module_access(auth.uid(), 'marketing') OR has_module_access(auth.uid(), 'management')
$$;

-- Funil por disparo.
CREATE OR REPLACE FUNCTION public.dispatch_tracking_funnel(p_dispatch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT _dispatch_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH acc AS (
    SELECT id, registered_at, order_ids FROM live_selfservice_accesses WHERE metadata->>'dispatch_id' = p_dispatch_id::text
  ), ord AS (
    SELECT o.id, o.is_paid, o.stage, bc_order_total(o.products, o.discount_type, o.discount_value) - coalesce(o.cashback_amount, 0) AS net
    FROM orders o WHERE o.dispatch_id = p_dispatch_id
       OR o.id IN (SELECT unnest(order_ids) FROM acc)
  )
  SELECT jsonb_build_object(
    'tracked', (SELECT count(*) FROM dispatch_recipients WHERE dispatch_id = p_dispatch_id AND tracking_code IS NOT NULL),
    'sent', (SELECT count(*) FROM dispatch_recipients WHERE dispatch_id = p_dispatch_id AND status IN ('sent','delivered','read')),
    'delivered', (SELECT count(*) FROM dispatch_recipients WHERE dispatch_id = p_dispatch_id AND status IN ('delivered','read')),
    'clicks_total', (SELECT count(*) FROM dispatch_link_clicks WHERE dispatch_id = p_dispatch_id),
    'clicks_unique', (SELECT count(DISTINCT recipient_id) FROM dispatch_link_clicks WHERE dispatch_id = p_dispatch_id),
    'registrations', (SELECT count(*) FROM acc WHERE registered_at IS NOT NULL),
    'orders', (SELECT count(*) FROM ord WHERE stage IS DISTINCT FROM 'cancelled'),
    'paid', (SELECT count(*) FROM ord WHERE is_paid),
    'revenue', (SELECT coalesce(round(sum(greatest(net,0)), 2), 0) FROM ord WHERE is_paid)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_tracking_funnel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_tracking_funnel(uuid) TO authenticated, service_role;

-- Quem clicou e não comprou (paginado, teto 200).
CREATE OR REPLACE FUNCTION public.dispatch_clicked_not_bought(p_dispatch_id uuid, p_limit int DEFAULT 200, p_offset int DEFAULT 0)
RETURNS TABLE(phone text, recipient_name text, first_clicked_at timestamptz, clicks bigint, registered boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _dispatch_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  WITH c AS (
    SELECT recipient_id, min(clicked_at) AS first_at, count(*) AS n FROM dispatch_link_clicks WHERE dispatch_id = p_dispatch_id GROUP BY recipient_id
  ), acc AS (
    SELECT (metadata->>'dispatch_recipient_id')::uuid AS rid, bool_or(registered_at IS NOT NULL) AS reg, array_agg(DISTINCT oid) FILTER (WHERE oid IS NOT NULL) AS oids
    FROM live_selfservice_accesses LEFT JOIN LATERAL unnest(order_ids) oid ON true
    WHERE metadata->>'dispatch_id' = p_dispatch_id::text GROUP BY 1
  ), paid AS (
    SELECT DISTINCT coalesce(o.dispatch_recipient_id, acc.rid) AS rid FROM orders o
    LEFT JOIN acc ON o.id = ANY(acc.oids)
    WHERE o.is_paid AND (o.dispatch_id = p_dispatch_id OR acc.rid IS NOT NULL)
  )
  SELECT dr.phone, dr.recipient_name, c.first_at, c.n, coalesce(acc.reg, false)
  FROM c JOIN dispatch_recipients dr ON dr.id = c.recipient_id
  LEFT JOIN acc ON acc.rid = c.recipient_id
  WHERE c.recipient_id NOT IN (SELECT rid FROM paid WHERE rid IS NOT NULL)
  ORDER BY c.first_at
  LIMIT least(greatest(coalesce(p_limit, 200), 1), 200) OFFSET greatest(coalesce(p_offset, 0), 0);
END $$;
REVOKE ALL ON FUNCTION public.dispatch_clicked_not_bought(uuid, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_clicked_not_bought(uuid, int, int) TO authenticated, service_role;

-- Receita atribuída a disparo por dia (data do pagamento, horário de Brasília).
CREATE OR REPLACE FUNCTION public.dispatch_attributed_revenue_daily(p_from date, p_to date)
RETURNS TABLE(date date, revenue numeric, orders bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _dispatch_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  WITH acc_orders AS (
    SELECT DISTINCT unnest(order_ids) AS oid FROM live_selfservice_accesses WHERE metadata ? 'dispatch_id'
  )
  SELECT (o.paid_at AT TIME ZONE 'America/Sao_Paulo')::date,
         round(sum(greatest(bc_order_total(o.products, o.discount_type, o.discount_value) - coalesce(o.cashback_amount, 0), 0)), 2),
         count(*)
  FROM orders o
  WHERE o.is_paid AND o.paid_at >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND o.paid_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND (o.dispatch_id IS NOT NULL OR o.id IN (SELECT oid FROM acc_orders))
  GROUP BY 1 ORDER BY 1;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_attributed_revenue_daily(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_attributed_revenue_daily(date, date) TO authenticated, service_role;