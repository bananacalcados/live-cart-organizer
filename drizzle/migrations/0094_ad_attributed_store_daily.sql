CREATE OR REPLACE VIEW public.v_ad_attributed_store_daily WITH (security_invoker=on) AS
WITH sales AS (
  SELECT DISTINCT ps.id, ((ps.created_at AT TIME ZONE 'America/Sao_Paulo'))::date AS date, COALESCE(ps.total,0) AS total
  FROM public.pos_sales ps
  JOIN public.mv_ad_contact_first_touch f
    ON COALESCE(ps.phone_suffix8, right(regexp_replace(ps.customer_phone,'\D','','g'),8)) = f.phone_key
   AND ps.created_at >= f.first_touch_at AND ps.created_at < f.first_touch_at + interval '14 days'
  WHERE ps.status_cancelamento = 'ativo' AND ps.sales_channel = 'presencial'
    AND ps.event_id IS NULL AND ps.source_order_id IS NULL
)
SELECT date, sum(total) AS rec_loja_attr, count(*) AS n_loja_attr FROM sales GROUP BY date;
GRANT SELECT ON public.v_ad_attributed_store_daily TO authenticated, service_role;