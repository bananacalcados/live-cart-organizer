CREATE OR REPLACE FUNCTION public.pos_expedition_stage_counts(p_store_id uuid DEFAULT NULL)
RETURNS TABLE(stage text, total bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
WITH eligible AS (
 SELECT s.id,s.expedition_stage FROM public.pos_sales s
 WHERE (p_store_id IS NULL OR s.store_id=p_store_id)
 AND s.sale_type IN ('live','online')
 AND s.expedition_stage IN ('novo','preparacao','separacao','aguardando','conferencia','concluido')
 AND s.status <> 'cancelled'
 AND ((s.status NOT IN ('online_pending','pending','pending_pickup','payment_failed') AND (s.paid_at IS NOT NULL OR s.status IN ('completed','paid','pending_sync'))) OR s.payment_on_delivery IS TRUE)
), memberships AS (
 SELECT e.id,e.expedition_stage AS stage FROM eligible e WHERE e.expedition_stage IN ('novo','preparacao','concluido')
 UNION
 SELECT e.id,v.stage FROM eligible e JOIN public.pos_sale_items i ON i.sale_id=e.id
 CROSS JOIN LATERAL (VALUES
 ('separacao'::text, GREATEST(0,COALESCE(i.quantity,0)-COALESCE(i.expedition_conference_qty,0)-COALESCE(i.expedition_waiting_qty,0)-COALESCE(i.expedition_completed_qty,0))),
 ('aguardando'::text,COALESCE(i.expedition_waiting_qty,0)),
 ('conferencia'::text,COALESCE(i.expedition_conference_qty,0))) v(stage,qty)
 WHERE e.expedition_stage IN ('separacao','aguardando','conferencia') AND v.qty>0
)
SELECT m.stage,count(DISTINCT m.id) FROM memberships m GROUP BY m.stage;
$$;
REVOKE ALL ON FUNCTION public.pos_expedition_stage_counts(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pos_expedition_stage_counts(uuid) TO authenticated,service_role;