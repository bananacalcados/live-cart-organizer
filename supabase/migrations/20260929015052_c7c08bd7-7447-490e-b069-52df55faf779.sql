CREATE OR REPLACE FUNCTION public.automation_sales_results(p_days int DEFAULT 7)
RETURNS TABLE(flow_id uuid, recipients bigint, buyers bigint, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH touches AS (
    SELECT e.flow_id, right(regexp_replace(e.result->>'phone','\D','','g'),8) s8, e.executed_at t
      FROM automation_executions e
     WHERE e.status IN ('sent','success') AND e.flow_id IS NOT NULL AND e.result ? 'phone'
    UNION
    SELECT q.flow_id, right(regexp_replace(q.phone,'\D','','g'),8), coalesce(q.sent_at,q.updated_at)
      FROM automation_message_queue q WHERE q.status='sent' AND q.flow_id IS NOT NULL
    UNION
    SELECT d.flow_id, right(regexp_replace(d.phone,'\D','','g'),8), d.sent_at
      FROM automation_dispatch_sent d WHERE d.status='sent' AND d.flow_id IS NOT NULL
  ), t AS (SELECT * FROM touches WHERE length(s8)=8 AND t IS NOT NULL),
  sales AS (
    SELECT s.id, right(regexp_replace(s.customer_phone,'\D','','g'),8) s8,
           coalesce(s.paid_at,s.created_at) at, coalesce(s.total,0) total
      FROM pos_sales s
     WHERE s.status IN ('completed','paid','pending_pickup')
       AND s.status_cancelamento IS DISTINCT FROM 'cancelado'
       AND s.customer_phone IS NOT NULL
       AND coalesce(s.paid_at,s.created_at) >= (SELECT min(t) FROM t)
  ), attributed AS (
    -- venda fica com a automação recebida mais recentemente antes da compra, dentro da janela
    SELECT DISTINCT ON (sa.id) sa.id, sa.s8, sa.total, t.flow_id
      FROM sales sa JOIN t ON t.s8 = sa.s8
       AND t.t <= sa.at AND t.t >= sa.at - make_interval(days => p_days)
     ORDER BY sa.id, t.t DESC
  ), rec AS (SELECT flow_id, count(DISTINCT s8) n FROM t GROUP BY 1)
  SELECT r.flow_id, r.n, count(DISTINCT a.s8), count(a.id), coalesce(sum(a.total),0)
    FROM rec r LEFT JOIN attributed a ON a.flow_id = r.flow_id
   GROUP BY r.flow_id, r.n;
$$;
REVOKE ALL ON FUNCTION public.automation_sales_results(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.automation_sales_results(int) TO authenticated, service_role;