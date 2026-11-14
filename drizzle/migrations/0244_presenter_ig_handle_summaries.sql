CREATE OR REPLACE FUNCTION public.get_ig_handle_summaries(_event_id uuid, _handles text[])
RETURNS TABLE (
  handle text,
  customer_id uuid,
  whatsapp text,
  open_other integer,
  unconfirmed_other integer,
  paid_other integer,
  cancelled_other integer,
  paid_other_events text[],
  cancelled_other_events text[],
  purchases jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR NOT public.has_module_access(auth.uid(), 'events')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF coalesce(array_length(_handles, 1), 0) > 600 THEN
    RAISE EXCEPTION 'too_many_handles' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH req AS (
    SELECT DISTINCT public.ig_handle_norm(h) AS handle
    FROM unnest(coalesce(_handles, '{}'::text[])) AS h
    WHERE public.ig_handle_norm(h) IS NOT NULL
  ),
  resolved AS MATERIALIZED (
    SELECT r.customer_id, r.handle
    FROM public.resolve_ig_handles((SELECT array_agg(req.handle) FROM req)) AS r
  ),
  customer_base AS (
    SELECT
      req.handle,
      r.customer_id,
      coalesce(
        nullif(btrim(c.whatsapp), ''),
        nullif(btrim(reg.whatsapp), '')
      ) AS whatsapp
    FROM req
    LEFT JOIN resolved r ON r.handle = req.handle
    LEFT JOIN public.customers c ON c.id = r.customer_id
    LEFT JOIN LATERAL (
      SELECT cr.whatsapp
      FROM public.customer_registrations cr
      WHERE cr.customer_id = r.customer_id
        AND nullif(btrim(c.whatsapp), '') IS NULL
        AND nullif(btrim(cr.whatsapp), '') IS NOT NULL
      ORDER BY cr.created_at DESC
      LIMIT 1
    ) reg ON true
  ),
  relevant_orders AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.event_id, o.products, o.stage,
           o.is_paid, o.paid_externally, o.paid_at, o.created_at
    FROM public.orders o
    JOIN resolved r ON r.customer_id = o.customer_id
  ),
  classified_orders AS (
    SELECT o.*,
      (o.stage <> 'cancelled' AND (
        coalesce(o.is_paid, false) OR coalesce(o.paid_externally, false)
        OR o.stage IN ('paid', 'awaiting_shipping', 'awaiting_mototaxi', 'awaiting_pickup', 'shipped', 'completed')
      )) AS paid
    FROM relevant_orders o
  ),
  other_status AS (
    SELECT
      o.customer_id,
      count(*) FILTER (
        WHERE NOT o.paid AND o.stage IN (
          'new', 'contacted', 'no_response', 'awaiting_confirmation',
          'incomplete_order', 'awaiting_payment', 'endereco', 'confirmar_endereco',
          'dados_pessoais', 'forma_pagamento', 'aguardando_pix', 'aguardando_cartao', 'aguardando_boleto'
        )
      )::integer AS open_other,
      count(*) FILTER (
        WHERE NOT o.paid AND o.stage IN ('pre_sale', 'incomplete_order', 'awaiting_confirmation')
      )::integer AS unconfirmed_other,
      count(*) FILTER (WHERE o.paid)::integer AS paid_other,
      count(*) FILTER (WHERE o.stage = 'cancelled')::integer AS cancelled_other,
      coalesce(array_agg(DISTINCT coalesce(e.name, 'Evento anterior')) FILTER (WHERE o.paid), '{}'::text[]) AS paid_other_events,
      coalesce(array_agg(DISTINCT coalesce(e.name, 'Evento anterior')) FILTER (WHERE o.stage = 'cancelled'), '{}'::text[]) AS cancelled_other_events
    FROM classified_orders o
    LEFT JOIN public.events e ON e.id = o.event_id
    WHERE o.event_id IS DISTINCT FROM _event_id
    GROUP BY o.customer_id
  ),
  paid_orders AS (
    SELECT o.id AS order_id, o.customer_id,
           coalesce(o.paid_at, o.created_at) AS purchase_at,
           coalesce(e.name, 'Evento anterior') AS event_name,
           o.products
    FROM classified_orders o
    LEFT JOIN public.events e ON e.id = o.event_id
    WHERE o.paid
  ),
  purchase_rows AS (
    SELECT p.order_id, p.customer_id, p.purchase_at, p.event_name,
           coalesce(items.items, '[]'::jsonb) AS items
    FROM paid_orders p
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'title', left(coalesce(nullif(btrim(item.value->>'title'), ''), nullif(btrim(item.value->>'name'), ''), 'Produto'), 160),
          'variant', left(coalesce(item.value->>'variant', ''), 80),
          'quantity', greatest(coalesce(nullif(item.value->>'quantity', '')::numeric, 1), 0)
        ) ORDER BY item.ord
      ) AS items
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p.products) = 'array' THEN p.products ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS item(value, ord)
    ) items ON true
  ),
  purchases_by_customer AS (
    SELECT p.customer_id,
      jsonb_agg(
        jsonb_build_object(
          'order_id', p.order_id,
          'event_name', p.event_name,
          'paid_at', p.purchase_at,
          'items', p.items
        ) ORDER BY p.purchase_at DESC, p.order_id DESC
      ) AS purchases
    FROM purchase_rows p
    GROUP BY p.customer_id
  )
  SELECT
    cb.handle,
    cb.customer_id,
    cb.whatsapp,
    coalesce(s.open_other, 0),
    coalesce(s.unconfirmed_other, 0),
    coalesce(s.paid_other, 0),
    coalesce(s.cancelled_other, 0),
    coalesce(s.paid_other_events, '{}'::text[]),
    coalesce(s.cancelled_other_events, '{}'::text[]),
    coalesce(pc.purchases, '[]'::jsonb)
  FROM customer_base cb
  LEFT JOIN other_status s ON s.customer_id = cb.customer_id
  LEFT JOIN purchases_by_customer pc ON pc.customer_id = cb.customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ig_handle_summaries(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ig_handle_summaries(uuid, text[]) TO authenticated;
COMMENT ON FUNCTION public.get_ig_handle_summaries(uuid, text[]) IS 'Resumo em lote do histórico por Instagram para o painel da apresentadora; exige acesso ao módulo de eventos.';