CREATE TABLE IF NOT EXISTS public.support_finalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_key text NOT NULL,
  whatsapp_number_id uuid,
  finished_at timestamptz NOT NULL DEFAULT now(),
  finished_by uuid,
  finished_by_name text,
  reason text CHECK (reason IS NULL OR length(reason)<=200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS support_finalizations_key ON public.support_finalizations (phone_key, coalesce(whatsapp_number_id,'00000000-0000-0000-0000-000000000000'::uuid));
REVOKE ALL ON public.support_finalizations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.support_finalizations TO service_role;
GRANT SELECT ON public.support_finalizations TO authenticated;
ALTER TABLE public.support_finalizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_finalizations_staff_read ON public.support_finalizations FOR SELECT TO authenticated USING (public._exchange_desk_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.support_finalization_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_key text NOT NULL, whatsapp_number_id uuid, finished_by uuid, finished_by_name text, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.support_finalization_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.support_finalization_log TO service_role;
GRANT SELECT ON public.support_finalization_log TO authenticated;
ALTER TABLE public.support_finalization_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_finalization_log_staff_read ON public.support_finalization_log FOR SELECT TO authenticated USING (public._exchange_desk_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.support_finish_conversation(p_phone text, p_whatsapp_number_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text := right(regexp_replace(coalesce(p_phone,''),'\D','','g'),8); v_name text; v_reason text := nullif(left(btrim(coalesce(p_reason,'')),200),'');
BEGIN
  IF auth.uid() IS NULL OR NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF length(k)<8 THEN RAISE EXCEPTION 'telefone inválido'; END IF;
  SELECT coalesce(nullif(p.display_name,''), u.email) INTO v_name FROM auth.users u LEFT JOIN public.profiles p ON p.user_id=u.id WHERE u.id=auth.uid();
  DELETE FROM public.chat_conversation_lanes WHERE phone_key=k AND lane='support'
    AND (whatsapp_number_id='' OR whatsapp_number_id=coalesce(p_whatsapp_number_id::text,''));
  INSERT INTO public.support_finalizations(phone_key,whatsapp_number_id,finished_at,finished_by,finished_by_name,reason)
  VALUES (k,p_whatsapp_number_id,now(),auth.uid(),v_name,v_reason)
  ON CONFLICT (phone_key, coalesce(whatsapp_number_id,'00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET finished_at=now(),finished_by=EXCLUDED.finished_by,finished_by_name=EXCLUDED.finished_by_name,reason=EXCLUDED.reason;
  INSERT INTO public.support_finalization_log(phone_key,whatsapp_number_id,finished_by,finished_by_name,reason) VALUES (k,p_whatsapp_number_id,auth.uid(),v_name,v_reason);
  RETURN jsonb_build_object('ok',true,'finished_by',v_name,'finished_at',now());
END $$;
REVOKE ALL ON FUNCTION public.support_finish_conversation(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_finish_conversation(text,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.support_central_link_options(p_phone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE k text := right(regexp_replace(coalesce(p_phone,''),'\D','','g'),8);
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'pos') OR has_module_access(auth.uid(),'expedition')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF length(k)<8 THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
    SELECT jsonb_build_object(
      'sale_id',ps.id,
      'order_ref',coalesce(nullif(ps.external_order_id,''),nullif(ps.tiny_order_number,''),left(ps.id::text,8)),
      'created_at',ps.created_at,'total',ps.total,'status',ps.status,
      'items',(SELECT string_agg(i.product_name,', ') FROM (SELECT product_name FROM public.pos_sale_items WHERE sale_id=ps.id LIMIT 3) i),
      'open_request',(SELECT jsonb_build_object('id',er.id,'type',er.request_type,'status',er.status,'created_at',er.created_at)
         FROM public.exchange_requests er WHERE er.sale_id=ps.id AND er.status::text NOT IN ('concluido','recusado','cancelado')
         ORDER BY er.created_at DESC LIMIT 1),
      'active_links',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'type',l.request_type,'created_at',l.created_at,'expires_at',l.expires_at) ORDER BY l.created_at DESC),'[]'::jsonb)
         FROM public.support_links l WHERE l.order_ref=ps.id::text AND l.revoked_at IS NULL AND l.used_at IS NULL AND l.expires_at>now() AND NOT coalesce(l.is_test,false))
    ) x
    FROM public.pos_sales ps
    WHERE ps.phone_suffix8=k AND ps.created_at>now()-interval '120 days' AND ps.status<>'cancelled'
    ORDER BY ps.created_at DESC LIMIT 10) t),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.support_central_link_options(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_central_link_options(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.support_staff_central_link(p_sale_id uuid, p_type text, p_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE er record; l jsonb; n int;
BEGIN
  IF auth.uid() IS NULL OR NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'pos') OR has_module_access(auth.uid(),'expedition')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF p_type NOT IN ('troca','devolucao') THEN RAISE EXCEPTION 'tipo inválido'; END IF;
  SELECT id,request_type,status INTO er FROM public.exchange_requests WHERE sale_id=p_sale_id AND status::text NOT IN ('concluido','recusado','cancelado') ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('blocked',true,'open_request',jsonb_build_object('id',er.id,'type',er.request_type,'status',er.status)); END IF;
  UPDATE public.support_links SET revoked_at=now() WHERE order_ref=p_sale_id::text AND request_type=p_type AND revoked_at IS NULL AND used_at IS NULL AND expires_at>now() AND NOT coalesce(is_test,false);
  GET DIAGNOSTICS n = ROW_COUNT;
  l := public.create_support_link(p_sale_id::text, p_type, 'agent', nullif(p_phone,''));
  RETURN l || jsonb_build_object('blocked',false,'replaced',n);
END $$;
REVOKE ALL ON FUNCTION public.support_staff_central_link(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_staff_central_link(uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.support_ai_failure_watchdog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tot int; bad int;
BEGIN
  IF NEW.kind<>'triagem' THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.support_settings WHERE auto_reply_mode='auto') THEN RETURN NEW; END IF;
  WITH s AS (
    SELECT suggestion_id, bool_or(ok) AS any_ok, max(attempt) AS max_att, min(created_at) AS first_at
    FROM public.support_ai_attempts WHERE kind='triagem' AND created_at>now()-interval '30 minutes' GROUP BY suggestion_id)
  SELECT count(*) FILTER (WHERE any_ok OR max_att>=2 OR first_at<now()-interval '1 minute'),
         count(*) FILTER (WHERE NOT any_ok AND (max_att>=2 OR first_at<now()-interval '1 minute'))
    INTO tot, bad FROM s;
  IF tot>=4 AND bad*2>tot THEN
    UPDATE public.support_settings SET auto_reply_mode='shadow',
      ai_pause_reason=left(format('IA do suporte com %s de %s triagens falhando em 30 min (>50%%). Voltou para sombra automaticamente.',bad,tot),500),
      ai_pause_until=NULL, updated_at=now()
    WHERE auto_reply_mode='auto';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_failure_watchdog() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_support_ai_failure_watchdog ON public.support_ai_attempts;
CREATE TRIGGER trg_support_ai_failure_watchdog AFTER INSERT ON public.support_ai_attempts FOR EACH ROW EXECUTE FUNCTION public.support_ai_failure_watchdog();

CREATE OR REPLACE FUNCTION public.exchange_support_conversations(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      ) AS is_finished,
      EXISTS(
        SELECT 1 FROM public.support_finalizations sf
        WHERE sf.phone_key=right(regexp_replace(c.phone,'\D','','g'),8)
          AND sf.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id
          AND sf.finished_at>=coalesce(c.last_incoming_at,'epoch'::timestamptz)
      ) AS support_finished
    FROM public.whatsapp_conversations c
    LEFT JOIN public.whatsapp_numbers n ON n.id=c.whatsapp_number_id
    WHERE c.channel='whatsapp' AND NOT c.is_group
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
END $function$;