ALTER TABLE public.whatsapp_group_responsible ADD COLUMN IF NOT EXISTS manual_instance_id uuid;
UPDATE public.whatsapp_group_responsible SET manual_instance_id = instance_id WHERE mode='manual' AND manual_instance_id IS NULL AND instance_id IS NOT NULL;
ALTER TABLE public.whatsapp_group_responsible_alerts ADD COLUMN IF NOT EXISTS acknowledged_by uuid;
CREATE INDEX IF NOT EXISTS whatsapp_group_responsible_alerts_open ON public.whatsapp_group_responsible_alerts (created_at DESC) WHERE acknowledged_at IS NULL;

CREATE OR REPLACE FUNCTION public.recompute_group_responsible(p_base text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  cur whatsapp_group_responsible;
  cand_id uuid; cand_admin boolean; v_health text; v_mode text; v_reason text;
  manual_id uuid; manual_present boolean; manual_admin boolean;
  v_name text; old_label text; new_label text; v_msg text; v_kind text;
BEGIN
  IF p_base IS NULL OR p_base = '' THEN RETURN NULL; END IF;
  SELECT * INTO cur FROM whatsapp_group_responsible WHERE group_jid_base = p_base FOR UPDATE;
  SELECT name INTO v_name FROM whatsapp_groups WHERE group_jid_base = p_base ORDER BY is_active DESC, last_synced_at DESC NULLS LAST LIMIT 1;

  SELECT instance_id, is_admin INTO cand_id, cand_admin FROM group_instance_presence(p_base)
   WHERE present ORDER BY is_admin DESC, ord, label LIMIT 1;
  v_mode := 'auto';
  manual_id := cur.manual_instance_id;

  IF manual_id IS NOT NULL THEN
    SELECT present, is_admin INTO manual_present, manual_admin FROM group_instance_presence(p_base) WHERE instance_id = manual_id;
    IF coalesce(manual_present,false) THEN
      cand_id := manual_id; cand_admin := coalesce(manual_admin,false); v_mode := 'manual';
    ELSE
      manual_id := NULL; -- escolhida saiu do grupo: volta para automático
    END IF;
  END IF;

  v_health := CASE WHEN cand_id IS NULL THEN 'sem_responsavel' WHEN cand_admin THEN 'ok' ELSE 'sem_admin' END;
  v_reason := CASE WHEN v_mode='manual' THEN 'definida manualmente'
                   WHEN cand_id IS NULL THEN 'nenhuma instância no grupo'
                   WHEN cand_admin THEN 'primeira da ordem que é admin'
                   ELSE 'primeira da ordem no grupo (sem admin)' END;

  IF cur.group_jid_base IS NULL THEN
    INSERT INTO whatsapp_group_responsible(group_jid_base, instance_id, mode, health, reason)
    VALUES (p_base, cand_id, v_mode, v_health, v_reason);
    RETURN v_health;
  END IF;

  IF cur.instance_id IS NOT DISTINCT FROM cand_id THEN
    UPDATE whatsapp_group_responsible SET health=v_health, mode=v_mode, reason=v_reason, manual_instance_id=manual_id,
      pending_instance_id=NULL, pending_reason=NULL, pending_since=NULL, updated_at=now()
    WHERE group_jid_base=p_base
      AND (health IS DISTINCT FROM v_health OR mode IS DISTINCT FROM v_mode OR reason IS DISTINCT FROM v_reason
           OR manual_instance_id IS DISTINCT FROM manual_id OR pending_instance_id IS NOT NULL OR pending_since IS NOT NULL);
    RETURN v_health;
  END IF;

  IF group_send_in_progress(p_base) THEN
    UPDATE whatsapp_group_responsible SET pending_instance_id=cand_id, pending_reason=v_reason,
      pending_since=coalesce(pending_since, now()), updated_at=now()
    WHERE group_jid_base=p_base AND (pending_instance_id IS DISTINCT FROM cand_id OR pending_since IS NULL);
    RETURN 'aguardando_envio';
  END IF;

  SELECT label INTO old_label FROM whatsapp_numbers WHERE id = cur.instance_id;
  SELECT label INTO new_label FROM whatsapp_numbers WHERE id = cand_id;
  IF cand_id IS NULL THEN
    v_kind := 'sem_responsavel';
    v_msg := format('Grupo %s ficou sem responsável', coalesce(v_name, p_base));
  ELSIF v_mode='manual' THEN
    v_kind := 'troca_manual';
    v_msg := format('Troca manual no grupo %s: %s → %s', coalesce(v_name,p_base), coalesce(old_label,'(nenhuma)'), new_label);
  ELSE
    v_kind := CASE WHEN cur.mode='manual' AND cur.manual_instance_id IS NOT NULL THEN 'manual_revertido' ELSE 'troca' END;
    v_msg := format('%s saiu do grupo %s ou perdeu admin — %s assumiu%s',
      coalesce(old_label,'(nenhuma)'), coalesce(v_name,p_base), new_label,
      CASE WHEN v_kind='manual_revertido' THEN ' (escolha manual voltou para automático)' ELSE '' END);
    IF cur.instance_id IS NULL THEN v_msg := format('%s assumiu o grupo %s', new_label, coalesce(v_name,p_base)); END IF;
  END IF;

  UPDATE whatsapp_group_responsible SET instance_id=cand_id, mode=v_mode, health=v_health, reason=v_reason,
    manual_instance_id=manual_id, since=now(), pending_instance_id=NULL, pending_reason=NULL, pending_since=NULL, updated_at=now()
  WHERE group_jid_base=p_base;
  INSERT INTO whatsapp_group_responsible_alerts(group_jid_base, group_name, kind, old_instance_id, new_instance_id, message)
  VALUES (p_base, v_name, v_kind, cur.instance_id, cand_id, v_msg);
  RETURN v_health;
END $$;

-- Estado do chat de grupo para a lista do PDV: normal | mirror | archived
CREATE OR REPLACE FUNCTION public.wa_group_chat_state(p_phone text, p_number uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM whatsapp_groups g WHERE g.group_jid_base = p_phone) THEN 'normal'
    WHEN NOT EXISTS (SELECT 1 FROM whatsapp_groups g WHERE g.group_jid_base = p_phone AND g.is_active) THEN 'archived'
    WHEN EXISTS (SELECT 1 FROM whatsapp_group_responsible r WHERE r.group_jid_base = p_phone
                 AND r.instance_id IS NOT NULL AND r.instance_id IS DISTINCT FROM p_number) THEN 'mirror'
    ELSE 'normal' END
$$;
REVOKE ALL ON FUNCTION public.wa_group_chat_state(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_group_chat_state(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_conversations_multi(p_number_ids uuid[] DEFAULT NULL::uuid[], p_dispatch_only boolean DEFAULT NULL::boolean, p_include_unassigned boolean DEFAULT false, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text, has_incoming boolean, last_is_mass_dispatch boolean)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT c.*, (now() - interval '14 days') AS cutoff
    FROM public.whatsapp_conversations c
    WHERE c.last_message_at > now() - interval '14 days'
      AND (p_number_ids IS NULL OR c.whatsapp_number_id = ANY (p_number_ids) OR (p_include_unassigned AND c.whatsapp_number_id IS NULL))
      AND (NOT c.is_group OR public.wa_group_chat_state(c.phone, c.whatsapp_number_id) = 'normal')
  ),
  r AS (
    SELECT b.phone,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message ELSE b.last_message END AS last_message,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message_at ELSE b.last_message_at END AS last_message_at,
      b.unread_count::bigint AS unread_count,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_direction ELSE b.last_direction END AS direction,
      b.is_group, b.whatsapp_number_id, b.sender_name,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_status ELSE b.last_status END AS status,
      COALESCE(CASE WHEN p_dispatch_only = false THEN b.nm_last_outgoing_at > b.cutoff ELSE b.last_outgoing_at > b.cutoff END, false) AS has_outgoing,
      COALESCE(b.last_incoming_at > b.cutoff, false) AS has_incoming,
      b.channel,
      CASE WHEN p_dispatch_only = false THEN false ELSE b.last_is_mass_dispatch END AS last_is_mass_dispatch
    FROM base b
    WHERE p_dispatch_only IS DISTINCT FROM false OR b.nm_last_message_at > b.cutoff
  ),
  r2 AS (
    SELECT r.*, ((r.last_is_mass_dispatch AND r.direction = 'outgoing')
        OR (r.direction = 'outgoing' AND NOT r.has_incoming AND (r.channel IS NULL OR r.channel NOT IN ('instagram', 'messenger')))) AS is_dispatch_only
    FROM r
  )
  SELECT phone, last_message, last_message_at, unread_count, direction, is_group, whatsapp_number_id,
         sender_name, status, has_outgoing, is_dispatch_only, channel, has_incoming, last_is_mass_dispatch
  FROM r2
  WHERE CASE WHEN p_dispatch_only = true THEN is_dispatch_only WHEN p_dispatch_only = false THEN NOT is_dispatch_only ELSE true END
  ORDER BY last_message_at DESC, phone, whatsapp_number_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1000), 5000))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_conversations_since(p_number_id uuid DEFAULT NULL::uuid, p_dispatch_only boolean DEFAULT NULL::boolean, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, unread_count bigint, direction text, is_group boolean, whatsapp_number_id uuid, sender_name text, status text, has_outgoing boolean, is_dispatch_only boolean, channel text, has_incoming boolean, last_is_mass_dispatch boolean, updated_at timestamp with time zone)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT c.* FROM public.whatsapp_conversations c
    WHERE p_since IS NULL AND c.last_message_at > now() - interval '14 days'
      AND (p_number_id IS NULL OR c.whatsapp_number_id = p_number_id)
    UNION ALL
    SELECT u.* FROM (
      SELECT c.* FROM public.whatsapp_conversations c
      WHERE p_since IS NOT NULL AND c.updated_at > p_since
      OFFSET 0
    ) u
    WHERE u.last_message_at > now() - interval '14 days'
      AND (p_number_id IS NULL OR u.whatsapp_number_id = p_number_id)
  ),
  base AS (
    SELECT s.*, (now() - interval '14 days') AS cutoff FROM src s
    WHERE NOT s.is_group OR public.wa_group_chat_state(s.phone, s.whatsapp_number_id) = 'normal'
  ),
  r AS (
    SELECT b.phone,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message ELSE b.last_message END AS last_message,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_message_at ELSE b.last_message_at END AS last_message_at,
      b.unread_count::bigint AS unread_count,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_direction ELSE b.last_direction END AS direction,
      b.is_group, b.whatsapp_number_id, b.sender_name,
      CASE WHEN p_dispatch_only = false THEN b.nm_last_status ELSE b.last_status END AS status,
      COALESCE(CASE WHEN p_dispatch_only = false THEN b.nm_last_outgoing_at > b.cutoff ELSE b.last_outgoing_at > b.cutoff END, false) AS has_outgoing,
      COALESCE(b.last_incoming_at > b.cutoff, false) AS has_incoming,
      b.channel,
      CASE WHEN p_dispatch_only = false THEN false ELSE b.last_is_mass_dispatch END AS last_is_mass_dispatch,
      b.updated_at
    FROM base b
    WHERE p_dispatch_only IS DISTINCT FROM false OR b.nm_last_message_at > b.cutoff
  ),
  r2 AS (
    SELECT r.*, ((r.last_is_mass_dispatch AND r.direction = 'outgoing')
        OR (r.direction = 'outgoing' AND NOT r.has_incoming AND (r.channel IS NULL OR r.channel NOT IN ('instagram', 'messenger')))) AS is_dispatch_only
    FROM r
  )
  SELECT phone, last_message, last_message_at, unread_count, direction, is_group, whatsapp_number_id,
         sender_name, status, has_outgoing, is_dispatch_only, channel, has_incoming, last_is_mass_dispatch, updated_at
  FROM r2
  WHERE CASE WHEN p_dispatch_only = true THEN is_dispatch_only WHEN p_dispatch_only = false THEN NOT is_dispatch_only ELSE true END
  ORDER BY last_message_at DESC, phone, whatsapp_number_id
  LIMIT 5000;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_conversation_heads()
 RETURNS TABLE(phone text, last_message text, last_message_at timestamp with time zone, last_direction text, sender_name text, whatsapp_number_id uuid, unread_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (c.phone) c.phone, c.last_message, c.last_message_at, c.last_direction, c.sender_name, c.whatsapp_number_id,
         sum(coalesce(c.unread_count,0)) OVER (PARTITION BY c.phone)
  FROM public.whatsapp_conversations c
  WHERE c.is_group AND public.wa_group_chat_state(c.phone, c.whatsapp_number_id) = 'normal'
  ORDER BY c.phone, c.last_message_at DESC NULLS LAST
$function$;

-- Chats de grupo escondidos (espelhos e arquivados), para o filtro "mostrar espelhos"
CREATE OR REPLACE FUNCTION public.get_hidden_group_conversations(p_number_ids uuid[] DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.last_message_at DESC), '[]'::jsonb) FROM (
    SELECT c.phone, coalesce(c.nm_last_message, c.last_message) AS last_message,
           coalesce(c.nm_last_message_at, c.last_message_at) AS last_message_at,
           c.unread_count::bigint AS unread_count, coalesce(c.nm_last_direction, c.last_direction) AS direction,
           true AS is_group, c.whatsapp_number_id, c.sender_name, c.last_status AS status,
           (c.last_outgoing_at IS NOT NULL) AS has_outgoing, false AS is_dispatch_only, c.channel,
           (c.last_incoming_at IS NOT NULL) AS has_incoming, false AS last_is_mass_dispatch,
           public.wa_group_chat_state(c.phone, c.whatsapp_number_id) AS group_state
    FROM public.whatsapp_conversations c
    WHERE c.is_group AND (p_number_ids IS NULL OR c.whatsapp_number_id = ANY(p_number_ids))
      AND public.wa_group_chat_state(c.phone, c.whatsapp_number_id) <> 'normal'
    ORDER BY c.last_message_at DESC
    LIMIT LEAST(GREATEST(coalesce(p_limit,200),1),200)
  ) t
$$;
REVOKE ALL ON FUNCTION public.get_hidden_group_conversations(uuid[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hidden_group_conversations(uuid[], int) TO authenticated, service_role;

-- Tela de Grupos: uma linha por grupo lógico
CREATE OR REPLACE FUNCTION public.group_logical_overview(p_include_archived boolean DEFAULT false, p_limit int DEFAULT 200, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb; v_total int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  WITH g AS (
    SELECT group_jid_base AS base,
           (array_agg(name ORDER BY is_active DESC, last_synced_at DESC NULLS LAST))[1] AS name,
           bool_or(is_active) AS active, bool_or(coalesce(is_vip,false)) AS vip,
           jsonb_agg(jsonb_build_object('id',id,'instance_id',instance_id,'name',name,'is_active',is_active,'is_admin',is_admin,
             'participant_count',participant_count,'last_synced_at',last_synced_at) ORDER BY last_synced_at DESC NULLS LAST) AS rows
    FROM whatsapp_groups WHERE coalesce(group_jid_base,'') <> '' GROUP BY group_jid_base
  ), f AS (SELECT * FROM g WHERE p_include_archived OR active),
  sel AS (SELECT * FROM f ORDER BY vip DESC, name NULLS LAST, base
          LIMIT LEAST(GREATEST(coalesce(p_limit,200),1),200) OFFSET GREATEST(coalesce(p_offset,0),0))
  SELECT (SELECT count(*) FROM f),
    coalesce(jsonb_agg(jsonb_build_object(
      'base', s.base, 'name', s.name, 'active', s.active, 'is_vip', s.vip, 'rows', s.rows,
      'responsible_id', r.instance_id, 'responsible_label', rn.label, 'mode', coalesce(r.mode,'auto'),
      'health', coalesce(r.health,'sem_responsavel'), 'reason', r.reason,
      'pending_id', r.pending_instance_id, 'pending_label', pn.label, 'pending_since', r.pending_since,
      'unique_members', coalesce(mc.c,0), 'open_alerts', coalesce(al.c,0), 'presence', coalesce(pr.pres,'[]'::jsonb)
    ) ORDER BY s.vip DESC, s.name NULLS LAST, s.base), '[]'::jsonb)
  INTO v_total, v
  FROM sel s
  LEFT JOIN whatsapp_group_responsible r ON r.group_jid_base = s.base
  LEFT JOIN whatsapp_numbers rn ON rn.id = r.instance_id
  LEFT JOIN whatsapp_numbers pn ON pn.id = r.pending_instance_id
  LEFT JOIN LATERAL (SELECT count(DISTINCT m.phone) AS c FROM whatsapp_group_members m
                     WHERE m.group_jid_base = s.base AND m.status = 'member' AND NOT coalesce(m.is_internal,false)) mc ON true
  LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('instance_id',p.instance_id,'label',p.label,'present',p.present,'is_admin',p.is_admin) ORDER BY p.ord, p.label) AS pres
                     FROM group_instance_presence(s.base) p) pr ON true
  LEFT JOIN LATERAL (SELECT count(*) AS c FROM whatsapp_group_responsible_alerts a
                     WHERE a.group_jid_base = s.base AND a.acknowledged_at IS NULL) al ON true;
  RETURN jsonb_build_object('total', coalesce(v_total,0), 'rows', coalesce(v,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.group_logical_overview(boolean,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_logical_overview(boolean,int,int) TO authenticated, service_role;

-- Trocar responsável manualmente (NULL = voltar ao automático)
CREATE OR REPLACE FUNCTION public.set_group_responsible_manual(p_base text, p_instance uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ok boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;
  IF p_instance IS NOT NULL THEN
    SELECT present INTO ok FROM group_instance_presence(p_base) WHERE instance_id = p_instance;
    IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'essa instância não está no grupo'; END IF;
  END IF;
  PERFORM recompute_group_responsible(p_base); -- garante a linha
  UPDATE whatsapp_group_responsible
     SET manual_instance_id = p_instance, mode = CASE WHEN p_instance IS NULL THEN 'auto' ELSE mode END, updated_at = now()
   WHERE group_jid_base = p_base;
  RETURN recompute_group_responsible(p_base);
END $$;
REVOKE ALL ON FUNCTION public.set_group_responsible_manual(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_responsible_manual(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ack_group_responsible_alert(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  UPDATE whatsapp_group_responsible_alerts SET acknowledged_at = now(), acknowledged_by = auth.uid()
   WHERE id = p_id AND acknowledged_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.ack_group_responsible_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_group_responsible_alert(uuid) TO authenticated, service_role;