CREATE OR REPLACE FUNCTION public.mobile_pdv_expedition_ids_v2(p_store_id uuid, p_stage text, p_search text DEFAULT '', p_shipping text DEFAULT 'all', p_origin text DEFAULT 'all', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $function$
WITH eligible AS (
 SELECT s.id, s.created_at, s.is_sedex, s.shipping_type,
  lower(coalesce(s.shipping_carrier, CASE WHEN o.is_pickup THEN 'Retirada na loja' ELSE o.delivery_method END, s.tracking_carrier, '')) AS dm,
  CASE WHEN s.sale_type='live' THEN 'live' WHEN s.payment_details->>'link_origin' IN ('whatsapp_chat','chat') THEN 'whatsapp' ELSE 'online' END AS origin
 FROM public.pos_sales s LEFT JOIN public.orders o ON o.id = s.source_order_id
 WHERE EXISTS (SELECT 1 FROM public.pos_stores st WHERE st.id=s.store_id AND st.is_active IS TRUE AND st.is_simulation IS FALSE)
 AND (p_store_id IS NULL OR s.store_id=p_store_id) AND s.sale_type IN ('live','online') AND s.status<>'cancelled'
 AND ((s.status NOT IN ('online_pending','pending','pending_pickup','payment_failed') AND (s.paid_at IS NOT NULL OR s.status IN ('completed','paid','pending_sync'))) OR s.payment_on_delivery IS TRUE)
 AND ((p_stage IN ('novo','preparacao','concluido') AND s.expedition_stage=p_stage) OR (p_stage IN ('separacao','aguardando','conferencia') AND s.expedition_stage IN ('separacao','aguardando','conferencia') AND EXISTS(SELECT 1 FROM public.pos_sale_items i WHERE i.sale_id=s.id AND CASE p_stage WHEN 'separacao' THEN greatest(0,coalesce(i.quantity,0)-coalesce(i.expedition_conference_qty,0)-coalesce(i.expedition_waiting_qty,0)-coalesce(i.expedition_completed_qty,0)) WHEN 'aguardando' THEN coalesce(i.expedition_waiting_qty,0) WHEN 'conferencia' THEN coalesce(i.expedition_conference_qty,0) ELSE 0 END>0)))
 AND (coalesce(p_search,'')='' OR s.customer_name ILIKE '%'||p_search||'%' OR s.id::text LIKE lower(p_search)||'%')
), filtered AS (
 SELECT * FROM eligible e WHERE (coalesce(p_origin,'all')='all' OR e.origin=p_origin)
 AND (coalesce(p_shipping,'all')='all'
  OR (p_shipping='pickup' AND e.dm LIKE '%retirada%')
  OR (p_shipping='moto' AND e.dm LIKE '%moto%')
  OR (p_shipping='carrier' AND e.dm<>'' AND e.dm NOT LIKE '%retirada%' AND e.dm NOT LIKE '%moto%')
  OR (p_shipping='none' AND e.dm=''))
)
SELECT coalesce(array_agg(id ORDER BY rk, ca_asc, ca_desc DESC, id),'{}'::uuid[]) FROM (
 SELECT id, CASE WHEN coalesce(is_sedex,false) OR shipping_type='sedex' OR dm LIKE '%sedex%' OR dm LIKE '%moto%' THEN 0 ELSE 1 END rk,
  CASE WHEN p_stage='concluido' THEN NULL ELSE created_at END ca_asc, CASE WHEN p_stage='concluido' THEN created_at ELSE NULL END ca_desc
 FROM filtered ORDER BY 2, 3 ASC, 4 DESC, id
 LIMIT greatest(1,least(coalesce(p_limit,50),100)) OFFSET greatest(0,coalesce(p_offset,0))) page;
$function$;
REVOKE EXECUTE ON FUNCTION public.mobile_pdv_expedition_ids_v2(uuid,text,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_pdv_expedition_ids_v2(uuid,text,text,text,text,integer,integer) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.mobile_pdv_expedition_counts(p_store_id uuid DEFAULT NULL)
RETURNS TABLE(stage text,total bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $function$
 SELECT c.stage,sum(c.total)::bigint FROM public.pos_stores st CROSS JOIN LATERAL public.pos_expedition_stage_counts(st.id) c
 WHERE st.is_active IS TRUE AND st.is_simulation IS FALSE AND (p_store_id IS NULL OR st.id=p_store_id) GROUP BY c.stage;
$function$;
REVOKE EXECUTE ON FUNCTION public.mobile_pdv_expedition_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_pdv_expedition_counts(uuid) TO authenticated, service_role;