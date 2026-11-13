CREATE OR REPLACE FUNCTION public.support_cost_keywords(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT public.support_normalize_text(p) ~ '\m(troca\w*|devolver|devolucao|reembolso\w*|estorno\w*|rastreio|rastrear|cade|entrega\w*|defeito\w*|cancelar|codigo|postagem|numeracao)\M|nao chegou|ficou (pequeno|grande)|nao (me )?serviu|minha compra|meu pedido|compra.*aparec|pedido.*aparec'
$$;

CREATE OR REPLACE FUNCTION public.support_auto_detect_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  BEGIN
    IF NEW.channel='instagram' AND coalesce(NEW.message,'') LIKE '💬 Comentário%' THEN RETURN NULL; END IF;
    IF coalesce(NEW.media_type,'') !~* '^(sticker|reaction|reacao|figurinha)$' THEN
      PERFORM public.support_ai_enqueue(NEW.id,NEW.phone,NEW.whatsapp_number_id,NEW.channel,NEW.message);
    END IF;
  EXCEPTION WHEN others THEN RAISE WARNING 'support_auto_detect: %',SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.support_auto_route(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; st record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT auto_route_support_line, auto_reply_mode INTO st FROM public.support_settings WHERE id = true;
  IF NOT coalesce(st.auto_route_support_line,false) OR st.auto_reply_mode <> 'auto' THEN RETURN false; END IF;
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT s.would_route_support OR s.routed_at IS NOT NULL OR s.channel NOT IN ('whatsapp','instagram') THEN RETURN false; END IF;
  IF NOT public._support_move_to_support_line(s.phone, s.whatsapp_number_id, NULL) THEN RETURN false; END IF;
  UPDATE public.support_auto_suggestions SET routed_at = now(), routed_auto = true WHERE id = p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.support_auto_route(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_auto_route(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.support_suggestion_route(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.support_shadow_action_guard(p_id);
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugestão não encontrada'; END IF;
  IF s.channel NOT IN ('whatsapp','instagram') THEN RAISE EXCEPTION 'Canal não suportado na linha de Suporte'; END IF;
  IF NOT public._support_move_to_support_line(s.phone,s.whatsapp_number_id,auth.uid()) THEN RAISE EXCEPTION 'Telefone inválido'; END IF;
  UPDATE public.support_auto_suggestions SET routed_at=now(),routed_by=auth.uid(),routed_auto=false WHERE id=p_id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.support_suggestion_route(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.support_suggestion_route(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.support_outbox_claim(p_limit integer DEFAULT 30)
RETURNS SETOF public.support_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_left integer; r public.support_outbox%ROWTYPE; n record; c record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF (SELECT auto_reply_mode FROM public.support_settings WHERE id=true)<>'auto' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(81726351);
  SELECT 30-count(*) INTO v_left FROM public.support_outbox WHERE status='sent' AND sent_at>=now()-interval '1 hour';
  IF v_left<=0 THEN RETURN; END IF;
  FOR r IN SELECT * FROM public.support_outbox
    WHERE status='pending' AND claimed_at IS NULL AND available_at<=now()
      AND whatsapp_number_id IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','ae453235-50e1-4ef6-8a87-8c8a77b2b440','1f715932-e118-4e88-8051-85a5c14f5a4b','c01d2777-df4c-4746-9433-d8c97c57d529','531883b0-b8bc-48b9-a094-edb04a7a0478')
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT least(greatest(coalesce(p_limit,30),1),30,v_left)
  LOOP
    SELECT provider INTO n FROM public.whatsapp_numbers WHERE id=r.whatsapp_number_id AND is_active;
    IF NOT FOUND THEN
      UPDATE public.support_outbox SET status='failed',error='Instância inativa ou não permitida' WHERE id=r.id;
    ELSIF n.provider IN ('meta','instagram') AND NOT EXISTS(
      SELECT 1 FROM public.whatsapp_messages m
      WHERE m.phone=r.phone AND m.whatsapp_number_id=r.whatsapp_number_id AND m.direction='incoming' AND m.created_at>=now()-interval '24 hours'
        AND (n.provider<>'instagram' OR (
          m.channel='instagram' AND coalesce(m.message,'') NOT LIKE '💬 Comentário%'
          AND NOT EXISTS(SELECT 1 FROM public.live_comments lc WHERE lc.comment_id=m.message_id)
          AND NOT EXISTS(SELECT 1 FROM public.ig_comment_moderation cm WHERE cm.comment_id=m.message_id)
        ))
    ) THEN
      UPDATE public.support_outbox SET status='failed',error='Fora da janela de 24 horas da Meta: é necessária uma mensagem recente da cliente' WHERE id=r.id;
    ELSE
      IF r.suggestion_id IS NOT NULL THEN
        SELECT * INTO c FROM public.whatsapp_conversations
        WHERE phone=r.phone AND whatsapp_number_id=r.whatsapp_number_id
          AND channel=CASE WHEN n.provider='instagram' THEN 'instagram' ELSE 'whatsapp' END AND NOT is_group LIMIT 1;
        IF (n.provider<>'instagram' AND NOT FOUND) OR (FOUND AND coalesce(c.last_incoming_at,'epoch'::timestamptz)<=coalesce(c.nm_last_outgoing_at,c.last_outgoing_at,'epoch'::timestamptz)) THEN
          UPDATE public.support_outbox SET status='cancelled',error='Cliente já recebeu resposta antes do envio automático' WHERE id=r.id;
          UPDATE public.support_auto_suggestions SET status='ignorada',reason='respondida_antes_do_envio' WHERE id=r.suggestion_id AND status='nova';
          CONTINUE;
        END IF;
      END IF;
      UPDATE public.support_outbox SET claimed_at=now(),error=NULL WHERE id=r.id RETURNING * INTO r;
      RETURN NEXT r;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.support_outbox_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_outbox_claim(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.exchange_support_conversations(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
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
      c.phone,c.channel,c.instance_key,c.whatsapp_number_id,c.sender_name,
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
      ) AS is_finished,
      EXISTS(
        SELECT 1 FROM public.support_finalizations sf
        WHERE sf.phone_key=right(regexp_replace(c.phone,'\D','','g'),8)
          AND sf.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id
          AND sf.finished_at>=coalesce(c.last_incoming_at,'epoch'::timestamptz)
      ) AS support_finished
    FROM public.whatsapp_conversations c
    LEFT JOIN public.whatsapp_numbers n ON n.id=c.whatsapp_number_id
    WHERE c.channel IN ('whatsapp','instagram') AND NOT c.is_group
  ), filtered AS (
    SELECT b.*,
      (b.last_incoming_at IS NOT NULL AND b.last_incoming_at>coalesce(b.last_outgoing_at,'epoch'::timestamptz)) AS waiting
    FROM base b
    WHERE (b.manual_support OR (b.has_ticket AND NOT b.is_finished)) AND NOT b.support_finished
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
            OR left(ps.id::text,8) ILIKE '%'||s||'%'
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
      'channel',p.channel,
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

UPDATE public.support_settings st
SET auto_reply_instance_ids=CASE
      WHEN '531883b0-b8bc-48b9-a094-edb04a7a0478'::uuid=ANY(st.auto_reply_instance_ids) THEN st.auto_reply_instance_ids
      ELSE array_append(st.auto_reply_instance_ids,'531883b0-b8bc-48b9-a094-edb04a7a0478'::uuid)
    END,
    support_whatsapp_phone=coalesce(nullif(st.support_whatsapp_phone,''),(
      SELECT CASE WHEN length(regexp_replace(coalesce(n.phone_display,''),'\D','','g'))=11
        THEN '55'||regexp_replace(n.phone_display,'\D','','g')
        ELSE regexp_replace(n.phone_display,'\D','','g') END
      FROM public.whatsapp_numbers n WHERE n.id='0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c'
    ))
WHERE st.id=true;