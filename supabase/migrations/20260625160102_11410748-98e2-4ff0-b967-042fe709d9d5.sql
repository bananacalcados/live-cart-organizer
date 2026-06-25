
CREATE OR REPLACE FUNCTION public.add_business_days(p_start date, p_days int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d date := p_start;
  added int := 0;
BEGIN
  IF p_start IS NULL THEN RETURN NULL; END IF;
  WHILE added < p_days LOOP
    d := d + 1;
    IF extract(dow from d) NOT IN (0, 6) THEN
      added := added + 1;
    END IF;
  END LOOP;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.campaign_dashboard_stats(p_campanha_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    count(*) FILTER (WHERE status = 'pendente') AS pendente,
    count(*) FILTER (WHERE status = 'capped') AS capped
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
  'pendente', c.pendente,
  'capped', c.capped,
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
$$;

CREATE OR REPLACE FUNCTION public.campaign_envios_detail(p_campanha_id uuid)
RETURNS TABLE(
  envio_id uuid,
  phone text,
  nome text,
  status text,
  erro text,
  enviado_em timestamptz,
  converteu boolean,
  valor numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH base AS (
  SELECT ce.id, ce.phone, ce.cliente_id, ce.phone_suffix8, ce.status, ce.erro, ce.enviado_em,
         ce.enviado_em::date AS d
  FROM campanha_envios ce
  WHERE ce.campanha_id = p_campanha_id
),
conv AS (
  SELECT b.id AS envio_id,
         coalesce(sum(ps.total), 0) AS valor,
         count(DISTINCT ps.id) AS nsales
  FROM base b
  JOIN pos_sales ps ON (
        (b.cliente_id IS NOT NULL AND ps.customer_unified_id = b.cliente_id)
     OR (b.phone_suffix8 IS NOT NULL
         AND right(regexp_replace(coalesce(ps.customer_phone, ''), '\D', '', 'g'), 8) = b.phone_suffix8)
  )
  WHERE b.status IN ('enviado','entregue','lido')
    AND ps.status IN ('completed','paid')
    AND coalesce(ps.paid_at, ps.created_at)::date >= b.d
    AND coalesce(ps.paid_at, ps.created_at)::date <= add_business_days(b.d, 7)
  GROUP BY b.id
)
SELECT b.id, b.phone, cv.name, b.status, b.erro, b.enviado_em,
       coalesce(c.nsales, 0) > 0 AS converteu,
       coalesce(c.valor, 0) AS valor
FROM base b
LEFT JOIN crm_customers_v cv ON cv.id = b.cliente_id
LEFT JOIN conv c ON c.envio_id = b.id
ORDER BY b.enviado_em DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.add_business_days(date, int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_dashboard_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_envios_detail(uuid) TO authenticated, service_role;
