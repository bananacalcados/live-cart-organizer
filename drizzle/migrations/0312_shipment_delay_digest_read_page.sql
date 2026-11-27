CREATE FUNCTION public.shipment_delay_digest_page(p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, customer_name text, real_carrier text, real_tracking_code text, tracking_code text, real_events jsonb, real_post_base timestamptz, delivery_estimate jsonb, stage_history jsonb, own_correios boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO public
AS $fn$
 WITH page AS MATERIALIZED (
 SELECT ss.id, coalesce(nullif(btrim(s.customer_name),''), ss.customer_name) customer_name,
 ss.real_carrier, ss.real_tracking_code, ss.tracking_code, ss.real_events, ss.delivery_estimate, ss.stage_history, ss.created_at
 FROM public.shipment_simulations ss JOIN public.pos_sales s ON s.id=ss.sale_id
 WHERE ss.kind='order' AND ss.status='active' AND ss.delivered_at IS NULL AND ss.merged_into_id IS NULL
 AND ss.created_at >= now()-interval '45 days'
 AND s.status IS DISTINCT FROM 'cancelled' AND s.status IS DISTINCT FROM 'cancelado'
 AND s.status_cancelamento IS DISTINCT FROM 'cancelado'::public.pedido_status_cancelamento
 ORDER BY ss.created_at, ss.id LIMIT greatest(1,least(coalesce(p_limit,200),200)) OFFSET greatest(0,coalesce(p_offset,0))
 ), native_codes AS MATERIALIZED (SELECT DISTINCT c.codigo_objeto FROM public.correios_shipments c WHERE c.codigo_objeto IS NOT NULL)
 SELECT p.id,p.customer_name,p.real_carrier,p.real_tracking_code,p.tracking_code,p.real_events,
 public.shipment_real_post_base(p.real_events),p.delivery_estimate,p.stage_history,n.codigo_objeto IS NOT NULL
 FROM page p LEFT JOIN native_codes n ON n.codigo_objeto=p.real_tracking_code ORDER BY p.created_at,p.id;
$fn$;
REVOKE ALL ON FUNCTION public.shipment_delay_digest_page(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.shipment_delay_digest_page(integer,integer) TO service_role;
COMMENT ON FUNCTION public.shipment_delay_digest_page(integer,integer) IS 'Read-only internal digest; paged 45-day open shipments, existing real-post rule, no sale/shipment mutations.';