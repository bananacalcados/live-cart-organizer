CREATE OR REPLACE FUNCTION public.exchange_support_conversations(p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_limit int := least(greatest(coalesce(p_limit,50),1),100); v_offset int := greatest(coalesce(p_offset,0),0);
  v_search text := nullif(btrim(coalesce(p_search,'')),''); v_digits text := nullif(regexp_replace(coalesce(p_search,''),'\D','','g'),'');
  v_rows jsonb; v_total bigint; v_suffixes text[];
BEGIN
  IF v_uid IS NULL OR NOT public._exchange_desk_staff(v_uid) THEN RAISE EXCEPTION 'Sem permissão para consultar a fila de suporte' USING ERRCODE='42501'; END IF;
  CREATE TEMP TABLE _support_queue ON COMMIT DROP AS
  SELECT c.phone,c.whatsapp_number_id,c.customer_name,c.customer_instagram,c.nm_last_message,c.nm_last_message_at,
    c.nm_last_incoming_at,c.nm_last_outgoing_at,c.nm_unread_count,w.label AS instance_label,w.phone_display AS instance_phone,
    EXISTS(SELECT 1 FROM public.support_tickets t WHERE t.customer_phone=c.phone AND t.status<>'resolvido' AND t.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id) AS has_ticket,
    l.id IS NOT NULL AS manual_support
  FROM public.whatsapp_conversations c
  JOIN public.whatsapp_numbers w ON w.id=c.whatsapp_number_id AND w.provider IN ('uazapi','wasender','zapi')
  JOIN public.chat_conversation_lanes l ON l.phone=c.phone AND l.whatsapp_number_id=c.whatsapp_number_id AND l.lane='support'
  WHERE EXISTS(SELECT 1 FROM public.pos_sellers s WHERE s.auth_user_id=v_uid AND s.store_id=ANY(w.store_ids))
    OR EXISTS(SELECT 1 FROM public.pos_sellers s WHERE s.auth_user_id=v_uid AND w.store_ids IS NULL);
  INSERT INTO _support_queue
  SELECT c.phone,c.whatsapp_number_id,c.customer_name,c.customer_instagram,c.nm_last_message,c.nm_last_message_at,
    c.nm_last_incoming_at,c.nm_last_outgoing_at,c.nm_unread_count,w.label,w.phone_display,true,false
  FROM public.whatsapp_conversations c
  JOIN public.whatsapp_numbers w ON w.id=c.whatsapp_number_id AND w.provider IN ('uazapi','wasender','zapi')
  WHERE EXISTS(SELECT 1 FROM public.support_tickets t WHERE t.customer_phone=c.phone AND t.status<>'resolvido' AND t.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id)
    AND NOT EXISTS(SELECT 1 FROM _support_queue q WHERE q.phone=c.phone AND q.whatsapp_number_id=c.whatsapp_number_id)
    AND (EXISTS(SELECT 1 FROM public.pos_sellers s WHERE s.auth_user_id=v_uid AND s.store_id=ANY(w.store_ids))
      OR EXISTS(SELECT 1 FROM public.pos_sellers s WHERE s.auth_user_id=v_uid AND w.store_ids IS NULL));
  SELECT array_agg(DISTINCT right(regexp_replace(q.phone,'\D','','g'),8)) INTO v_suffixes FROM _support_queue q;
  CREATE TEMP TABLE _support_sales ON COMMIT DROP AS
  SELECT right(regexp_replace(ps.customer_phone,'\D','','g'),8) AS suffix,
    jsonb_build_object('id',ps.id,'order_ref',coalesce(ps.external_order_id,left(ps.id::text,8)),'status',ps.status,'total_price',ps.total_price,'created_at',ps.created_at,'store_name',st.name) AS sale
  FROM public.pos_sales ps LEFT JOIN public.pos_stores st ON st.id=ps.store_id
  WHERE right(regexp_replace(ps.customer_phone,'\D','','g'),8)=ANY(coalesce(v_suffixes,ARRAY[]::text[]))
  ORDER BY ps.created_at DESC;
  CREATE TEMP TABLE _support_exchange ON COMMIT DROP AS
  SELECT right(regexp_replace(er.customer_phone,'\D','','g'),8) AS suffix,
    jsonb_build_object('id',er.id,'type',er.type,'status',er.status,'created_at',er.created_at,'order_ref',coalesce(er.order_id::text,left(er.pos_sale_id::text,8))) AS request
  FROM public.exchange_requests er
  WHERE right(regexp_replace(er.customer_phone,'\D','','g'),8)=ANY(coalesce(v_suffixes,ARRAY[]::text[]))
  ORDER BY er.created_at DESC;
  CREATE TEMP TABLE _support_td ON COMMIT DROP AS
  SELECT right(regexp_replace(td.customer_phone,'\D','','g'),8) AS suffix,
    jsonb_build_object('id',td.id,'numero',td.numero,'tipo',td.tipo,'status',td.status,'created_at',td.created_at,'link_publico',td.link_publico,'motivo',td.motivo) AS reverse
  FROM public.trocas_devolucoes td
  WHERE right(regexp_replace(td.customer_phone,'\D','','g'),8)=ANY(coalesce(v_suffixes,ARRAY[]::text[]))
  ORDER BY td.created_at DESC;
  CREATE TEMP TABLE _support_refunds ON COMMIT DROP AS
  SELECT right(regexp_replace(coalesce(gr.metadata->>'customer_phone',ps.customer_phone),'\D','','g'),8) AS suffix,
    jsonb_build_object('id',gr.id,'status',gr.status,'amount',gr.amount,'created_at',gr.created_at,'motivo',gr.motivo) AS refund
  FROM public.gateway_refunds gr LEFT JOIN public.pos_sales ps ON ps.id=gr.pos_sale_id
  WHERE right(regexp_replace(coalesce(gr.metadata->>'customer_phone',ps.customer_phone),'\D','','g'),8)=ANY(coalesce(v_suffixes,ARRAY[]::text[]))
  ORDER BY gr.created_at DESC;
  WITH filtered AS (
    SELECT q.* FROM _support_queue q
    WHERE v_search IS NULL OR coalesce(q.customer_name,'') ILIKE '%'||v_search||'%' OR coalesce(q.customer_instagram,'') ILIKE '%'||v_search||'%'
      OR (v_digits IS NOT NULL AND regexp_replace(q.phone,'\D','','g') LIKE '%'||v_digits)
      OR EXISTS(SELECT 1 FROM _support_sales s WHERE s.suffix=right(regexp_replace(q.phone,'\D','','g'),8) AND (coalesce(s.sale->>'order_ref','') ILIKE '%'||v_search||'%' OR s.sale->>'id'=v_search OR left(s.sale->>'id',8) ILIKE '%'||v_search||'%'))
  ), counted AS (SELECT count(*) AS total FROM filtered), ranked AS (
    SELECT f.*,greatest(f.nm_last_incoming_at,f.nm_last_outgoing_at,f.nm_last_message_at) AS last_at,
      f.nm_last_incoming_at>coalesce(f.nm_last_outgoing_at,'epoch'::timestamptz) AS waiting,
      CASE WHEN f.nm_last_incoming_at>coalesce(f.nm_last_outgoing_at,'epoch'::timestamptz) THEN f.nm_last_incoming_at ELSE NULL END AS waiting_since
    FROM filtered f
  )
  SELECT (SELECT total FROM counted),coalesce(jsonb_agg(to_jsonb(r)-'last_at' ORDER BY r.waiting DESC,r.waiting_since ASC NULLS LAST,r.last_at ASC),'[]'::jsonb)
  INTO v_total,v_rows FROM (SELECT * FROM ranked ORDER BY waiting DESC,waiting_since ASC NULLS LAST,last_at ASC LIMIT v_limit OFFSET v_offset) r;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.waiting_since ASC NULLS LAST,x.last_at ASC),'[]'::jsonb) INTO v_rows
  FROM (
    SELECT r.phone,r.whatsapp_number_id,r.customer_name,r.customer_instagram,r.nm_last_message,r.nm_last_message_at,r.nm_last_incoming_at,r.nm_last_outgoing_at,r.nm_unread_count,
      r.instance_label,r.instance_phone,r.has_ticket,r.manual_support,r.waiting,r.waiting_since,r.last_at,
      coalesce((SELECT jsonb_agg(s.sale) FROM (SELECT sale FROM _support_sales WHERE suffix=right(regexp_replace(r.phone,'\D','','g'),8) LIMIT 3) s),'[]'::jsonb) AS recent_sales,
      coalesce((SELECT jsonb_agg(e.request) FROM (SELECT request FROM _support_exchange WHERE suffix=right(regexp_replace(r.phone,'\D','','g'),8) LIMIT 3) e),'[]'::jsonb) AS exchange_requests,
      coalesce((SELECT jsonb_agg(t.reverse) FROM (SELECT reverse FROM _support_td WHERE suffix=right(regexp_replace(r.phone,'\D','','g'),8) LIMIT 3) t),'[]'::jsonb) AS reverses,
      coalesce((SELECT jsonb_agg(g.refund) FROM (SELECT refund FROM _support_refunds WHERE suffix=right(regexp_replace(r.phone,'\D','','g'),8) LIMIT 3) g),'[]'::jsonb) AS refunds
    FROM ranked r ORDER BY r.waiting DESC,r.waiting_since ASC NULLS LAST,r.last_at ASC LIMIT v_limit OFFSET v_offset
  ) x;
  RETURN jsonb_build_object('total',v_total,'rows',v_rows,'limit',v_limit,'offset',v_offset);
END;
$fn$;