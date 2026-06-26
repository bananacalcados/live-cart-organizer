CREATE OR REPLACE FUNCTION public.campaign_dashboard_stats(p_campanha_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH envios AS (
  SELECT * FROM campanha_envios WHERE campanha_id = p_campanha_id
),
counts AS (
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE status IN ('enviado','entregue','lido')) AS enviados,
    count(*) FILTER (WHERE status IN ('entregue','lido')) AS entregues,
    count(*) FILTER (WHERE status = 'lido') AS lidos,
    count(*) FILTER (WHERE status = 'falhou') AS falhou,
    count(*) FILTER (WHERE status = 'nao_entregavel') AS nao_entregavel,
    count(*) FILTER (WHERE status = 'pendente') AS pendente,
    count(*) FILTER (WHERE status = 'capped') AS capped,
    count(*) FILTER (
      WHERE status = 'pendente'
        AND (erro ILIKE '%rate%' OR erro ILIKE '%throughput%' OR erro ILIKE '%too many%')
    ) AS rate_limit,
    count(*) FILTER (
      WHERE status = 'pendente'
        AND coalesce(tentativas,0) > 0
        AND NOT (erro ILIKE '%rate%' OR erro ILIKE '%throughput%' OR erro ILIKE '%too many%')
    ) AS aguardando_retry,
    count(*) FILTER (
      WHERE status = 'pendente' AND coalesce(tentativas,0) = 0
    ) AS enfileirados
  FROM envios
),
sent AS (
  SELECT id AS envio_id, cliente_id, phone_suffix8, enviado_em::date AS d,
         coalesce(cliente_id::text, phone_suffix8) AS rkey
  FROM envios
  WHERE status IN ('enviado','entregue','lido')
),
qsales AS (
  SELECT DISTINCT ON (ps.id) ps.id AS sale_id, s.rkey, ps.total
  FROM sent s
  JOIN pos_sales ps ON (
        (s.cliente_id IS NOT NULL AND ps.customer_unified_id = s.cliente_id)
     OR (s.phone_suffix8 IS NOT NULL
         AND right(regexp_replace(coalesce(ps.customer_phone, ''), '\D', '', 'g'), 8) = s.phone_suffix8)
  )
  WHERE ps.status IN ('completed','paid')
    AND coalesce(ps.paid_at, ps.created_at)::date >= s.d
    AND coalesce(ps.paid_at, ps.created_at)::date <= add_business_days(s.d, 7)
  ORDER BY ps.id, coalesce(ps.paid_at, ps.created_at)
),
conv AS (
  SELECT
    count(DISTINCT rkey) AS conversoes,
    coalesce(sum(total), 0) AS valor,
    (SELECT coalesce(sum(i.quantity), 0)
       FROM pos_sale_items i
      WHERE i.sale_id IN (SELECT sale_id FROM qsales)) AS itens
  FROM qsales
)
SELECT jsonb_build_object(
  'total', c.total,
  'enviados', c.enviados,
  'entregues', c.entregues,
  'lidos', c.lidos,
  'falhou', c.falhou,
  'nao_entregavel', c.nao_entregavel,
  'pendente', c.pendente,
  'capped', c.capped,
  'rate_limit', c.rate_limit,
  'aguardando_retry', c.aguardando_retry,
  'enfileirados', c.enfileirados,
  'pct_concluida', CASE WHEN c.total > 0 THEN round(((c.total - c.pendente)::numeric / c.total) * 100, 1) ELSE 0 END,
  'conversoes', cv.conversoes,
  'valor_conversao', cv.valor,
  'itens_vendidos', cv.itens,
  'custo_por_msg', 0.40,
  'custo', round(c.enviados * 0.40, 2),
  'roas', CASE WHEN c.enviados > 0 THEN round(cv.valor / (c.enviados * 0.40), 2) ELSE 0 END,
  'taxa_conversao', CASE WHEN c.enviados > 0 THEN round((cv.conversoes::numeric / c.enviados) * 100, 1) ELSE 0 END,
  'ticket_medio', CASE WHEN cv.conversoes > 0 THEN round(cv.valor / cv.conversoes, 2) ELSE 0 END
)
FROM counts c CROSS JOIN conv cv;
$function$;