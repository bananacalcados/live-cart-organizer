ALTER TABLE public.group_campaign_scheduled_messages ADD COLUMN IF NOT EXISTS sync_key text;
CREATE INDEX IF NOT EXISTS idx_gcsm_sync_key_draft ON public.group_campaign_scheduled_messages (sync_key)
  WHERE sync_key IS NOT NULL AND status = 'draft';

WITH msg AS (
  SELECT COALESCE(message_group_id, id) mk, campaign_id, draft_batch,
         string_agg(message_type||'::'||lower(btrim(regexp_replace(coalesce(message_content,''),'\s+',' ','g'))),
                    '||' ORDER BY coalesce(block_order,0)) sig,
         bool_or(btrim(coalesce(message_content,''))<>'') has_text
  FROM public.group_campaign_scheduled_messages
  WHERE status='draft' AND draft_batch IS NOT NULL
  GROUP BY 1,2,3),
ok AS (
  SELECT draft_batch, sig, gen_random_uuid() k FROM msg WHERE has_text
  GROUP BY draft_batch, sig
  HAVING count(DISTINCT campaign_id) >= 2 AND count(*) = count(DISTINCT campaign_id))
UPDATE public.group_campaign_scheduled_messages m
SET sync_key = ok.k::text||':'||coalesce(m.block_order,0)
FROM msg JOIN ok USING (draft_batch, sig)
WHERE COALESCE(m.message_group_id, m.id) = msg.mk AND m.status='draft' AND m.sync_key IS NULL;

CREATE OR REPLACE FUNCTION public._is_group_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'user'))
$$;

-- Mesmas validações da approve_group_drafts, para uma mensagem (bloco 0 ou única)
CREATE OR REPLACE FUNCTION public._validate_group_draft(p_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_msg record; v_group uuid;
BEGIN
  SELECT * INTO v_msg FROM group_campaign_scheduled_messages m WHERE m.id = p_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_msg.status <> 'draft' THEN RETURN 'not_draft'; END IF;
  v_group := v_msg.message_group_id;
  IF EXISTS (SELECT 1 FROM group_campaign_scheduled_messages b
     WHERE ((v_group IS NOT NULL AND b.message_group_id=v_group) OR (v_group IS NULL AND b.id=p_id))
       AND b.message_type IN ('image','video','audio','document') AND (b.media_url IS NULL OR btrim(b.media_url)='')) THEN RETURN 'missing_media'; END IF;
  IF EXISTS (SELECT 1 FROM group_campaign_scheduled_messages b
     WHERE ((v_group IS NOT NULL AND b.message_group_id=v_group) OR (v_group IS NULL AND b.id=p_id))
       AND b.message_type='poll' AND (b.poll_options IS NULL OR jsonb_array_length(b.poll_options)<2)) THEN RETURN 'poll_needs_2_options'; END IF;
  IF EXISTS (SELECT 1 FROM group_campaign_scheduled_messages b
     WHERE ((v_group IS NOT NULL AND b.message_group_id=v_group) OR (v_group IS NULL AND b.id=p_id))
       AND b.message_type='contact' AND (b.contact_phone IS NULL OR btrim(b.contact_phone)='')) THEN RETURN 'missing_contact_phone'; END IF;
  IF v_msg.scheduled_at IS NULL THEN RETURN 'missing_schedule'; END IF;
  IF v_msg.whatsapp_number_id IS NULL AND NOT EXISTS (SELECT 1 FROM group_campaigns c WHERE c.id=v_msg.campaign_id AND c.whatsapp_number_id IS NOT NULL) THEN RETURN 'missing_instance'; END IF;
  IF EXISTS (SELECT 1 FROM group_campaign_scheduled_messages b
     WHERE ((v_group IS NOT NULL AND b.message_group_id=v_group) OR (v_group IS NULL AND b.id=p_id))
       AND COALESCE(b.vip_link_mode,'none')='none' AND COALESCE(b.message_content,'') ILIKE '%{{link_atendimento}}%') THEN RETURN 'vip_link_without_mode'; END IF;
  RETURN NULL;
END $$;

-- Assinatura completa da mensagem (tipo+texto normalizado+mídia por bloco)
CREATE OR REPLACE FUNCTION public._group_draft_signature(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT string_agg(b.message_type||'::'||lower(btrim(regexp_replace(coalesce(b.message_content,''),'\s+',' ','g')))||'::'||coalesce(b.media_url,''),
                    '||' ORDER BY coalesce(b.block_order,0))
  FROM group_campaign_scheduled_messages a
  JOIN group_campaign_scheduled_messages b
    ON (a.message_group_id IS NOT NULL AND b.message_group_id=a.message_group_id) OR (a.message_group_id IS NULL AND b.id=a.id)
  WHERE a.id=p_id
$$;

CREATE OR REPLACE FUNCTION public.group_draft_sync_siblings(p_ids uuid[])
RETURNS TABLE(anchor_id uuid, id uuid, campaign_id uuid, campaign_name text, scheduled_at timestamptz, reason text, content_differs boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public._is_group_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT a.id, s.id, s.campaign_id, c.name::text, s.scheduled_at,
         public._validate_group_draft(s.id),
         public._group_draft_signature(s.id) IS DISTINCT FROM public._group_draft_signature(a.id)
  FROM group_campaign_scheduled_messages a
  JOIN group_campaign_scheduled_messages s
    ON s.sync_key = a.sync_key AND s.status='draft' AND s.campaign_id <> a.campaign_id
  LEFT JOIN group_campaigns c ON c.id = s.campaign_id
  WHERE a.id = ANY(p_ids[1:200]) AND a.sync_key IS NOT NULL AND a.status='draft'
  ORDER BY a.id, s.scheduled_at
  LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION public.approve_group_drafts_synced(p_anchor_ids uuid[], p_sibling_ids uuid[], p_approved_by text)
RETURNS TABLE(anchor_id uuid, id uuid, campaign_id uuid, ok boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_a uuid; v_s uuid; v_ok boolean; v_r text; v_key text; v_camp uuid;
  v_done uuid[] := '{}';
BEGIN
  IF NOT public._is_group_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOREACH v_a IN ARRAY coalesce(p_anchor_ids[1:200],'{}') LOOP
    SELECT m.sync_key, m.campaign_id INTO v_key, v_camp FROM group_campaign_scheduled_messages m WHERE m.id=v_a;
    SELECT x.ok, x.reason INTO v_ok, v_r FROM public._approve_one_group_draft(v_a, p_approved_by) x;
    RETURN QUERY SELECT v_a, v_a, v_camp, v_ok, v_r;
    IF NOT v_ok OR v_key IS NULL THEN CONTINUE; END IF;
    FOR v_s, v_camp IN
      SELECT s.id, s.campaign_id FROM group_campaign_scheduled_messages s
      WHERE s.id = ANY(coalesce(p_sibling_ids,'{}')) AND s.sync_key=v_key
        AND s.campaign_id <> (SELECT campaign_id FROM group_campaign_scheduled_messages WHERE id=v_a)
        AND NOT (s.id = ANY(v_done))
    LOOP
      v_done := v_done || v_s;
      SELECT x.ok, x.reason INTO v_ok, v_r FROM public._approve_one_group_draft(v_s, p_approved_by) x;
      RETURN QUERY SELECT v_a, v_s, v_camp, v_ok, v_r;
    END LOOP;
  END LOOP;
END $$;

-- Aprova uma mensagem de forma atômica (bloco 0 -> pending, irmãos -> grouped)
CREATE OR REPLACE FUNCTION public._approve_one_group_draft(p_id uuid, p_approved_by text)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_msg record; v_r text;
BEGIN
  SELECT * INTO v_msg FROM group_campaign_scheduled_messages m WHERE m.id=p_id FOR UPDATE;
  v_r := public._validate_group_draft(p_id);
  IF v_r IS NOT NULL THEN RETURN QUERY SELECT false, v_r; RETURN; END IF;
  BEGIN
    UPDATE group_campaign_scheduled_messages m SET status='pending', approved_at=now(), approved_by=p_approved_by
     WHERE m.id=p_id AND m.status='draft';
    IF v_msg.message_group_id IS NOT NULL THEN
      UPDATE group_campaign_scheduled_messages m SET status='grouped', approved_at=now(), approved_by=p_approved_by
       WHERE m.message_group_id=v_msg.message_group_id AND m.id<>p_id AND m.status='draft';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, 'error: '||SQLERRM; RETURN;
  END;
  RETURN QUERY SELECT true, CASE WHEN v_msg.scheduled_at < now() THEN 'past_schedule' ELSE 'ok' END;
END $$;

REVOKE ALL ON FUNCTION public._is_group_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._validate_group_draft(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._group_draft_signature(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approve_one_group_draft(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.group_draft_sync_siblings(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_group_drafts_synced(uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_group_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.group_draft_sync_siblings(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_group_drafts_synced(uuid[], uuid[], text) TO authenticated;