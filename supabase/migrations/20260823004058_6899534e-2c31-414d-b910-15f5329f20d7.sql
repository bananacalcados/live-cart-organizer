CREATE OR REPLACE FUNCTION public.get_member_area_origin_breakdown(
  p_start timestamptz,
  p_end timestamptz,
  p_lookback_days integer DEFAULT 7,
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH s AS (
  SELECT right(regexp_replace(ms.phone, '\D', '', 'g'), 8) AS suf,
         min(ms.created_at) AS first_session,
         (array_agg(ms.name ORDER BY ms.created_at DESC))[1] AS nome,
         (array_agg(ms.phone ORDER BY ms.created_at))[1] AS phone
  FROM public.live_member_sessions ms
  WHERE ms.phone IS NOT NULL
    AND length(regexp_replace(ms.phone, '\D', '', 'g')) >= 8
    AND ms.created_at >= p_start
    AND ms.created_at < p_end
    AND (p_event_id IS NULL OR ms.event_id = p_event_id)
  GROUP BY 1
),
op AS (
  SELECT o.id,
         o.created_at,
         o.is_paid,
         right(regexp_replace(COALESCE(NULLIF(c.whatsapp, ''), cr.whatsapp, ''), '\D', '', 'g'), 8) AS suf,
         (
           SELECT COALESCE(sum(
             COALESCE((i->>'price')::numeric, 0) * COALESCE(NULLIF(i->>'quantity', '')::int, 1)
           ), 0)
           FROM jsonb_array_elements(COALESCE(o.products, '[]'::jsonb)) i
         ) AS total
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.customer_registrations cr ON cr.order_id = o.id
  WHERE o.created_at >= p_start - make_interval(days => GREATEST(COALESCE(p_lookback_days, 7), 0))
    AND o.created_at < p_end
    AND o.merged_into_order_id IS NULL
),
o AS (
  SELECT suf,
         min(created_at) AS first_order,
         bool_or(is_paid) AS paid,
         count(*) FILTER (WHERE is_paid) AS pedidos_pagos,
         COALESCE(sum(total) FILTER (WHERE is_paid), 0) AS faturamento
  FROM op
  WHERE suf <> ''
  GROUP BY 1
),
j AS (
  SELECT s.suf, s.nome, s.phone, s.first_session, o.first_order,
         COALESCE(o.paid, false) AS paid,
         COALESCE(o.pedidos_pagos, 0) AS pedidos_pagos,
         COALESCE(o.faturamento, 0) AS faturamento,
         CASE
           WHEN o.suf IS NULL THEN 'sem_pedido'
           WHEN o.first_order > s.first_session THEN 'cadastro_primeiro'
           ELSE 'pedido_primeiro'
         END AS origem,
         CASE WHEN o.first_order > s.first_session
              THEN round(extract(epoch FROM (o.first_order - s.first_session)) / 60)::int
         END AS minutos_ate_pedido
  FROM s
  LEFT JOIN o ON o.suf = s.suf
)
SELECT jsonb_build_object(
  'period_start', p_start,
  'period_end', p_end,
  'total_cadastros', (SELECT count(*) FROM j),
  'groups', (
    SELECT COALESCE(jsonb_agg(g ORDER BY g->>'origem'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'origem', origem,
        'pessoas', count(*),
        'compraram', count(*) FILTER (WHERE paid),
        'pedidos_pagos', COALESCE(sum(pedidos_pagos), 0),
        'faturamento', round(COALESCE(sum(faturamento) FILTER (WHERE paid), 0), 2)
      ) AS g
      FROM j GROUP BY origem
    ) x
  ),
  'compradores_cadastro_primeiro', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'nome', nome,
             'phone', phone,
             'first_session', first_session,
             'first_order', first_order,
             'minutos_ate_pedido', minutos_ate_pedido,
             'pedidos_pagos', pedidos_pagos,
             'faturamento', round(faturamento, 2)
           ) ORDER BY minutos_ate_pedido DESC NULLS LAST), '[]'::jsonb)
    FROM j WHERE paid AND origem = 'cadastro_primeiro'
  ),
  'sem_pedido_amostra', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'nome', nome, 'phone', phone, 'first_session', first_session
           ) ORDER BY first_session DESC), '[]'::jsonb)
    FROM (SELECT * FROM j WHERE origem = 'sem_pedido' ORDER BY first_session DESC LIMIT 200) z
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.get_member_area_origin_breakdown(timestamptz, timestamptz, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_area_origin_breakdown(timestamptz, timestamptz, integer, uuid) TO service_role;