CREATE OR REPLACE FUNCTION public.exchange_support_conversations(p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  s text := trim(coalesce(p_search,''));
  d text := regexp_replace(coalesce(p_search,''),'\D','','g');
  r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(s) > 100 OR coalesce(p_offset,0) < 0 OR coalesce(p_offset,0) > 10000 THEN
    RETURN jsonb_build_object('total',0,'rows','[]'::jsonb);
  END IF;
  WITH base AS (
    SELECT
      c.phone,c.instance_key,c.whatsapp_number_id,c.sender_name,
      right(regexp_replace(c.phone,'\D','','g'),8) AS phone_key,
      coalesce(c.nm_last_message,c.last_message) AS last_message,
      coalesce(c.nm_last_message_at,c.last_message_at) AS last_message_at,
      coalesce(c.nm_last_direction,c.last_direction) AS last_direction,
      c.last_incoming_at,
      coalesce(c.nm_last_outgoing_at,c.last_outgoing_at) AS last_outgoing_at,
      n.label AS instance_label,n.phone_display AS instance_phone,
      EXISTS(
        SELECT 1 FROM public.chat_conversation_lanes l
        WHERE l.lane='support' AND l.phone_key=right(regexp_replace(c.phone,'\D','','g'),8)
          AND (l.whatsapp_number_id='' OR l.whatsapp_number_id=c.whatsapp_number_id::text)
      ) AS manual_support,
      EXISTS(
        SELECT 1 FROM public.support_tickets t
        WHERE t.status<>'resolved'
          AND right(regexp_replace(t.customer_phone,'\D','','g'),8)=right(regexp_replace(c.phone,'\D','','g'),8)
      ) AS has_ticket,
      EXISTS(
        SELECT 1 FROM public.chat_finished_conversations f
        WHERE f.phone=c.phone AND f.instance_key=c.instance_key
      ) AS is_finished
    FROM public.whatsapp_conversations c
    LEFT JOIN public.whatsapp_numbers n ON n.id=c.whatsapp_number_id
    WHERE c.channel='whatsapp' AND NOT c.is_group
  ), filtered AS (
    SELECT b.*,
      (b.last_incoming_at IS NOT NULL AND b.last_incoming_at>coalesce(b.last_outgoing_at,'epoch'::timestamptz)) AS waiting
    FROM base b
    WHERE (b.manual_support OR (b.has_ticket AND NOT b.is_finished))
      AND (
        s='' OR b.sender_name ILIKE '%'||s||'%'
        OR (length(d)>=4 AND regexp_replace(b.phone,'\D','','g') LIKE '%'||d||'%')
        OR EXISTS(
          SELECT 1 FROM public.pos_sales ps
          WHERE ps.phone_suffix8=b.phone_key AND (
            coalesce(ps.external_order_id,'') ILIKE '%'||s||'%'
            OR coalesce(ps.tiny_order_number,'') ILIKE '%'||s||'%'
            OR coalesce(ps.tiny_order_id,'') ILIKE '%'||s||'%'
            OR ps.id::text=s
          )
        )
      )
  ), paged AS (
    SELECT * FROM filtered
    ORDER BY waiting DESC,
      CASE WHEN waiting THEN last_incoming_at END ASC NULLS LAST,
      last_message_at DESC NULLS LAST,phone,whatsapp_number_id
    LIMIT least(greatest(coalesce(p_limit,50),1),100) OFFSET greatest(coalesce(p_offset,0),0)
  )
  SELECT jsonb_build_object(
    'total',(SELECT count(*) FROM filtered),
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'phone',p.phone,
      'phone_suffix',right(regexp_replace(p.phone,'\D','','g'),4),
      'customer_name',coalesce(nullif(p.sender_name,''),'Cliente'),
      'whatsapp_number_id',p.whatsapp_number_id,
      'instance_label',p.instance_label,
      'instance_phone',p.instance_phone,
      'last_message',p.last_message,
      'last_message_at',p.last_message_at,
      'last_direction',p.last_direction,
      'last_incoming_at',p.last_incoming_at,
      'last_outgoing_at',p.last_outgoing_at,
      'waiting',p.waiting,
      'waiting_since',CASE WHEN p.waiting THEN p.last_incoming_at END,
      'manual_support',p.manual_support,
      'has_ticket',p.has_ticket,
      'recent_orders',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id',o.id,'order_ref',o.order_ref,'status',o.status,'expedition_stage',o.expedition_stage,
          'created_at',o.created_at,'total',o.total,'store_name',o.store_name
        ) ORDER BY o.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT ps.id,coalesce(nullif(ps.external_order_id,''),nullif(ps.tiny_order_number,''),nullif(ps.tiny_order_id,''),left(ps.id::text,8)) AS order_ref,
            ps.status,ps.expedition_stage,ps.created_at,ps.total,st.name AS store_name
          FROM public.pos_sales ps LEFT JOIN public.pos_stores st ON st.id=ps.store_id
          WHERE ps.phone_suffix8=p.phone_key ORDER BY ps.created_at DESC LIMIT 3
        ) o
      ),
      'requests',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id',q.id,'request_type',q.request_type,'status',q.status,'order_ref',q.order_ref,'created_at',q.created_at
        ) ORDER BY q.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT er.id,er.request_type,er.status::text AS status,coalesce(er.order_number,er.order_ref) AS order_ref,er.created_at
          FROM public.exchange_requests er
          WHERE right(regexp_replace(er.phone,'\D','','g'),8)=p.phone_key
          ORDER BY er.created_at DESC LIMIT 5
        ) q
      ),
      'exchanges',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id',x.id,'code',x.code,'type',x.type,'status',x.status,'created_at',x.created_at
        ) ORDER BY x.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT td.id,td.codigo_devolucao AS code,td.tipo::text AS type,td.status::text AS status,td.created_at
          FROM public.trocas_devolucoes td JOIN public.pos_sales ps ON ps.id=td.pedido_original_id
          WHERE ps.phone_suffix8=p.phone_key ORDER BY td.created_at DESC LIMIT 5
        ) x
      ),
      'reverses',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id',v.id,'code',v.code,'status',v.status,'created_at',v.created_at
        ) ORDER BY v.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT rv.id,rv.codigo_objeto AS code,rv.status,rv.created_at
          FROM public.correios_reverse_shipments rv
          WHERE rv.phone_key=p.phone_key ORDER BY rv.created_at DESC LIMIT 5
        ) v
      ),
      'refunds',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id',g.id,'status',g.status,'amount',g.amount,'reason',g.reason,'created_at',g.created_at
        ) ORDER BY g.created_at DESC),'[]'::jsonb)
        FROM (
          SELECT gr.id,gr.status,gr.amount,gr.reason,gr.created_at
          FROM public.gateway_refunds gr JOIN public.pos_sales ps ON ps.id=gr.source_id OR ps.source_order_id=gr.source_id
          WHERE ps.phone_suffix8=p.phone_key ORDER BY gr.created_at DESC LIMIT 5
        ) g
      )
    ) ORDER BY p.waiting DESC,CASE WHEN p.waiting THEN p.last_incoming_at END ASC NULLS LAST,p.last_message_at DESC NULLS LAST,p.phone,p.whatsapp_number_id),'[]'::jsonb)
  ) INTO r FROM paged p;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_support_conversations(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_support_conversations(text,integer,integer) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.exchange_desk_list(p_tab text, p_type text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE d text := regexp_replace(coalesce(p_search,''),'\D','','g'); s text := trim(coalesce(p_search,'')); r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(s) > 100 OR p_offset < 0 OR p_offset > 10000 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO r FROM (
    SELECT e.id, e.request_type, split_part(coalesce(e.customer_name,''),' ',1) AS first_name, e.customer_name, e.phone, e.whatsapp_number_id, e.order_ref, e.order_number,
      e.product_name, e.product_size, e.desired_size, e.requested_quantity, e.reason_category::text AS reason, e.status::text AS status,
      e.escalated_reason, e.created_at, e.assigned_to, e.reverse_shipping_code, e.trocas_devolucoes_id, e.is_test
    FROM exchange_requests e
    WHERE CASE p_tab
        WHEN 'precisa' THEN e.status = 'escalado' OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NULL)
        WHEN 'andamento' THEN e.status IN ('solicitado','aguardando_postagem','em_transito','recebido') OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NOT NULL)
        WHEN 'concluidas' THEN e.status IN ('concluido','recusado','cancelado')
        ELSE false END
      AND (p_type IS NULL OR e.request_type = p_type)
      AND (p_reason IS NULL OR e.reason_category::text = p_reason)
      AND (p_assignee IS NULL OR e.assigned_to = p_assignee)
      AND (s = '' OR e.customer_name ILIKE '%'||s||'%' OR e.order_ref ILIKE '%'||s||'%' OR e.order_number ILIKE '%'||s||'%'
           OR (length(d) >= 4 AND regexp_replace(e.phone,'\D','','g') LIKE '%'||d||'%'))
    ORDER BY e.created_at, e.id
    LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET p_offset) x;
  RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) TO authenticated,service_role;