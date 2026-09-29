CREATE OR REPLACE FUNCTION public._automation_sale_attribution(p_days int)
RETURNS TABLE(flow_id uuid, sale_id uuid, s8 text, sale_at timestamptz, total numeric, touch_at timestamptz, touch_wa uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH t AS (
    SELECT * FROM (
      SELECT e.flow_id, right(regexp_replace(e.result->>'phone','\D','','g'),8) s8, e.executed_at t, NULL::uuid wa
        FROM automation_executions e
       WHERE e.status IN ('sent','success') AND e.flow_id IS NOT NULL AND e.result ? 'phone'
         AND coalesce(e.result->>'action','') <> 'queued'
      UNION ALL
      SELECT q.flow_id, right(regexp_replace(q.phone,'\D','','g'),8), coalesce(q.sent_at,q.updated_at), q.whatsapp_number_id
        FROM automation_message_queue q WHERE q.status='sent' AND q.flow_id IS NOT NULL
      UNION ALL
      SELECT d.flow_id, right(regexp_replace(d.phone,'\D','','g'),8), d.sent_at, NULL
        FROM automation_dispatch_sent d WHERE d.status='sent' AND d.flow_id IS NOT NULL
    ) x WHERE length(s8)=8 AND t IS NOT NULL
  ), sales AS (
    SELECT s.id, right(regexp_replace(s.customer_phone,'\D','','g'),8) s8,
           coalesce(s.paid_at,s.created_at) at, coalesce(s.total,0) total
      FROM pos_sales s
     WHERE s.status IN ('completed','paid','pending_pickup')
       AND s.status_cancelamento IS DISTINCT FROM 'cancelado'
       AND coalesce(s.sale_type,'') <> 'exchange'
       AND s.customer_phone IS NOT NULL
       AND coalesce(s.paid_at,s.created_at) >= (SELECT min(t) FROM t)
  )
  SELECT DISTINCT ON (sa.id) t.flow_id, sa.id, sa.s8, sa.at, sa.total, t.t, t.wa
    FROM sales sa JOIN t ON t.s8 = sa.s8
     AND t.t <= sa.at AND t.t >= sa.at - make_interval(days => p_days)
   ORDER BY sa.id, t.t DESC;
$$;

CREATE OR REPLACE FUNCTION public.automation_sales_results(p_days int DEFAULT 7)
RETURNS TABLE(flow_id uuid, recipients bigint, buyers bigint, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH rec AS (
    SELECT flow_id, count(DISTINCT s8) n FROM (
      SELECT e.flow_id, right(regexp_replace(e.result->>'phone','\D','','g'),8) s8 FROM automation_executions e
       WHERE e.status IN ('sent','success') AND e.flow_id IS NOT NULL AND e.result ? 'phone' AND coalesce(e.result->>'action','') <> 'queued'
      UNION ALL SELECT q.flow_id, right(regexp_replace(q.phone,'\D','','g'),8) FROM automation_message_queue q WHERE q.status='sent'
      UNION ALL SELECT d.flow_id, right(regexp_replace(d.phone,'\D','','g'),8) FROM automation_dispatch_sent d WHERE d.status='sent'
    ) x WHERE flow_id IS NOT NULL AND length(s8)=8 GROUP BY 1
  ), a AS (SELECT * FROM public._automation_sale_attribution(p_days))
  SELECT r.flow_id, r.n, count(DISTINCT a.s8), count(a.sale_id), coalesce(sum(a.total),0)
    FROM rec r LEFT JOIN a ON a.flow_id = r.flow_id GROUP BY r.flow_id, r.n;
$$;

CREATE OR REPLACE FUNCTION public.automation_sales_buyers(p_flow_id uuid, p_days int DEFAULT 7)
RETURNS TABLE(sale_id uuid, customer_name text, customer_phone text, total numeric, sale_at timestamptz,
              touch_at timestamptz, store_name text, sale_type text, sales_channel text, event_id uuid,
              whatsapp_number_id uuid, items text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT s.id, s.customer_name, s.customer_phone, a.total, a.sale_at, a.touch_at, st.name,
         s.sale_type, s.sales_channel, s.event_id, a.touch_wa,
         (SELECT string_agg(coalesce(i.quantity,1)::text || 'x ' || coalesce(i.product_name,''), ', ')
            FROM pos_sale_items i WHERE i.sale_id = s.id)
    FROM public._automation_sale_attribution(p_days) a
    JOIN pos_sales s ON s.id = a.sale_id
    LEFT JOIN pos_stores st ON st.id = s.store_id
   WHERE a.flow_id = p_flow_id
   ORDER BY a.sale_at DESC;
$$;

REVOKE ALL ON FUNCTION public._automation_sale_attribution(int), public.automation_sales_buyers(uuid,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._automation_sale_attribution(int), public.automation_sales_buyers(uuid,int), public.automation_sales_results(int) TO authenticated, service_role;