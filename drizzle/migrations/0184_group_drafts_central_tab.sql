CREATE OR REPLACE FUNCTION public._can_review_group_drafts()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND (public._is_group_staff()
    OR 'marketing' = ANY(coalesce(public.get_user_allowed_modules(auth.uid()), ARRAY[]::text[])))
$$;
REVOKE ALL ON FUNCTION public._can_review_group_drafts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_review_group_drafts() TO authenticated;

-- Fase 1: mesma lógica, acesso também por módulo Marketing
CREATE OR REPLACE FUNCTION public.group_draft_sync_siblings(p_ids uuid[])
RETURNS TABLE(anchor_id uuid, id uuid, campaign_id uuid, campaign_name text, scheduled_at timestamptz, reason text, content_differs boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public._can_review_group_drafts() THEN RAISE EXCEPTION 'forbidden'; END IF;
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
#variable_conflict use_column
DECLARE v_a uuid; v_s uuid; v_ok boolean; v_r text; v_key text; v_camp uuid; v_acamp uuid;
  v_done uuid[] := '{}';
BEGIN
  IF NOT public._can_review_group_drafts() THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOREACH v_a IN ARRAY coalesce(p_anchor_ids[1:200],'{}') LOOP
    SELECT m.sync_key, m.campaign_id INTO v_key, v_acamp FROM group_campaign_scheduled_messages m WHERE m.id=v_a;
    SELECT x.ok, x.reason INTO v_ok, v_r FROM public._approve_one_group_draft(v_a, p_approved_by) x;
    RETURN QUERY SELECT v_a, v_a, v_acamp, v_ok, v_r;
    IF NOT v_ok OR v_key IS NULL THEN CONTINUE; END IF;
    FOR v_s, v_camp IN
      SELECT s.id, s.campaign_id FROM group_campaign_scheduled_messages s
      WHERE s.id = ANY(coalesce(p_sibling_ids,'{}')) AND s.sync_key=v_key
        AND s.campaign_id <> v_acamp AND NOT (s.id = ANY(v_done))
    LOOP
      v_done := v_done || v_s;
      SELECT x.ok, x.reason INTO v_ok, v_r FROM public._approve_one_group_draft(v_s, p_approved_by) x;
      RETURN QUERY SELECT v_a, v_s, v_camp, v_ok, v_r;
    END LOOP;
  END LOOP;
END $$;

-- 2b: chave nos blocos extras de mensagens em rascunho já vinculadas
UPDATE public.group_campaign_scheduled_messages g
SET sync_key = split_part(p.sync_key,':',1)||':'||coalesce(g.block_order,0)
FROM public.group_campaign_scheduled_messages p
WHERE p.message_group_id = g.message_group_id AND coalesce(p.block_order,0)=0
  AND p.status='draft' AND p.sync_key IS NOT NULL
  AND g.status='grouped' AND g.id<>p.id AND g.sync_key IS NULL;
CREATE INDEX IF NOT EXISTS idx_gcsm_sync_key_grouped ON public.group_campaign_scheduled_messages (sync_key)
  WHERE sync_key IS NOT NULL AND status='grouped';
CREATE INDEX IF NOT EXISTS idx_gcsm_status_draft ON public.group_campaign_scheduled_messages (scheduled_at)
  WHERE status='draft';

-- Bloco 0 (dono) de uma linha qualquer da mensagem
CREATE OR REPLACE FUNCTION public._group_draft_owner(p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(
    (SELECT o.id FROM group_campaign_scheduled_messages r
       JOIN group_campaign_scheduled_messages o ON o.message_group_id = r.message_group_id AND coalesce(o.block_order,0)=0
      WHERE r.id=p_id AND r.message_group_id IS NOT NULL LIMIT 1), p_id)
$$;
REVOKE ALL ON FUNCTION public._group_draft_owner(uuid) FROM PUBLIC, anon, authenticated;

-- Lista central: um card por mensagem lógica (só rascunhos)
CREATE OR REPLACE FUNCTION public.group_draft_cards(p_batch text DEFAULT NULL, p_status text DEFAULT NULL, p_day date DEFAULT NULL,
  p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb; v_lim int := least(greatest(coalesce(p_limit,50),1),200);
BEGIN
  IF NOT public._can_review_group_drafts() THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH a AS (
    SELECT m.id, m.campaign_id, m.scheduled_at, m.draft_batch, m.created_by, m.message_group_id,
           coalesce(nullif(split_part(m.sync_key,':',1),''), m.id::text) card_key,
           public._validate_group_draft(m.id) reason, public._group_draft_signature(m.id) sig
    FROM group_campaign_scheduled_messages m
    WHERE m.status='draft' AND (m.message_group_id IS NULL OR coalesce(m.block_order,0)=0)
      AND (p_batch IS NULL OR m.draft_batch = p_batch)),
  ranked AS (
    SELECT a.*, first_value(a.sig) OVER (PARTITION BY card_key ORDER BY a.scheduled_at NULLS LAST, a.id) ref_sig,
           first_value(a.id) OVER (PARTITION BY card_key ORDER BY a.scheduled_at NULLS LAST, a.id) ref_id
    FROM a),
  cards AS (
    SELECT card_key, min(ref_id::text)::uuid ref_id, min(draft_batch) draft_batch, min(created_by) created_by,
           min(scheduled_at) first_at,
           jsonb_agg(jsonb_build_object('id',r.id,'campaign_id',r.campaign_id,'campaign_name',c.name,
             'scheduled_at',r.scheduled_at,'reason',r.reason,'content_differs', r.sig IS DISTINCT FROM r.ref_sig,
             'has_instance', (c.whatsapp_number_id IS NOT NULL))
             ORDER BY r.scheduled_at NULLS LAST) copies,
           bool_or(r.reason IS NULL) any_ready, bool_or(r.reason IS NOT NULL) any_blocked,
           bool_or(r.sig IS DISTINCT FROM r.ref_sig) any_differs, bool_or(r.scheduled_at < now()) any_past,
           bool_or(p_day IS NULL OR (r.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date = p_day) day_ok
    FROM ranked r LEFT JOIN group_campaigns c ON c.id=r.campaign_id
    GROUP BY card_key),
  f AS (
    SELECT * FROM cards WHERE day_ok AND (p_status IS NULL
      OR (p_status='ready' AND any_ready) OR (p_status='blocked' AND any_blocked)
      OR (p_status='differs' AND any_differs) OR (p_status='past' AND any_past))),
  page AS (SELECT * FROM f ORDER BY first_at NULLS LAST, card_key LIMIT v_lim OFFSET greatest(coalesce(p_offset,0),0))
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'cards', coalesce((SELECT jsonb_agg(jsonb_build_object(
       'card_key', p.card_key, 'draft_batch', p.draft_batch, 'created_by', p.created_by,
       'copies', p.copies,
       'blocks', (SELECT jsonb_agg(jsonb_build_object('id',b.id,'block_order',coalesce(b.block_order,0),'message_type',b.message_type,
            'message_content',b.message_content,'media_url',b.media_url,'poll_options',b.poll_options,'poll_max_options',b.poll_max_options,
            'mention_all',b.mention_all,'contact_name',b.contact_name,'contact_phone',b.contact_phone,
            'disable_link_preview',b.disable_link_preview,'sync_key',b.sync_key) ORDER BY coalesce(b.block_order,0))
          FROM group_campaign_scheduled_messages o JOIN group_campaign_scheduled_messages b
            ON (o.message_group_id IS NOT NULL AND b.message_group_id=o.message_group_id) OR (o.message_group_id IS NULL AND b.id=o.id)
          WHERE o.id=p.ref_id)) ORDER BY p.first_at NULLS LAST, p.card_key) FROM page p), '[]'::jsonb),
    'batches', coalesce((SELECT jsonb_agg(DISTINCT m.draft_batch) FROM group_campaign_scheduled_messages m
       WHERE m.status='draft' AND m.draft_batch IS NOT NULL), '[]'::jsonb))
  INTO v;
  RETURN v;
END $$;

-- Edição sincronizada de conteúdo (só rascunhos, só colunas de conteúdo)
CREATE OR REPLACE FUNCTION public.update_group_drafts_synced(p_block_id uuid, p_patch jsonb, p_only_ids uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid, campaign_id uuid, ok boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
DECLARE v_key text; r record; v_owner_status text; v_k text; v_n int := 0;
  v_allowed text[] := ARRAY['message_content','media_url','poll_options','poll_max_options','mention_all','contact_name','contact_phone','disable_link_preview'];
  v_txt text; v_media text; v_poll jsonb;
BEGIN
  IF NOT public._can_review_group_drafts() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN RAISE EXCEPTION 'empty_patch'; END IF;
  FOR v_k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_k = ANY(v_allowed)) THEN RAISE EXCEPTION 'column_not_allowed: %', v_k; END IF;
  END LOOP;
  IF p_patch ? 'poll_options' AND (jsonb_typeof(p_patch->'poll_options')<>'array' OR jsonb_array_length(p_patch->'poll_options')<2) THEN
    RAISE EXCEPTION 'poll_needs_2_options'; END IF;
  SELECT m.sync_key INTO v_key FROM group_campaign_scheduled_messages m WHERE m.id=p_block_id;
  FOR r IN
    SELECT m.id, m.campaign_id, m.message_type, m.message_content, m.media_url, m.status
    FROM group_campaign_scheduled_messages m
    WHERE (m.id=p_block_id OR (v_key IS NOT NULL AND m.sync_key=v_key))
      AND m.status IN ('draft','grouped')
      AND (p_only_ids IS NULL OR m.id = ANY(p_only_ids) OR m.id=p_block_id)
    ORDER BY m.id LIMIT 200 FOR UPDATE
  LOOP
    v_n := v_n + 1;
    SELECT o.status INTO v_owner_status FROM group_campaign_scheduled_messages o WHERE o.id=public._group_draft_owner(r.id);
    IF coalesce(v_owner_status,'') <> 'draft' THEN
      RETURN QUERY SELECT r.id, r.campaign_id, false, 'not_draft'; CONTINUE; END IF;
    v_txt := CASE WHEN p_patch ? 'message_content' THEN p_patch->>'message_content' ELSE r.message_content END;
    v_media := CASE WHEN p_patch ? 'media_url' THEN p_patch->>'media_url' ELSE r.media_url END;
    IF r.message_type='text' AND btrim(coalesce(v_txt,''))='' THEN
      RETURN QUERY SELECT r.id, r.campaign_id, false, 'empty_text'; CONTINUE; END IF;
    IF r.message_type IN ('image','video','audio','document') AND p_patch ? 'media_url' AND btrim(coalesce(v_media,''))='' THEN
      RETURN QUERY SELECT r.id, r.campaign_id, false, 'empty_media'; CONTINUE; END IF;
    IF p_patch ? 'poll_options' AND r.message_type<>'poll' THEN
      RETURN QUERY SELECT r.id, r.campaign_id, false, 'not_poll'; CONTINUE; END IF;
    UPDATE group_campaign_scheduled_messages m SET
      message_content = v_txt,
      media_url = v_media,
      poll_options = CASE WHEN p_patch ? 'poll_options' THEN p_patch->'poll_options' ELSE m.poll_options END,
      poll_max_options = CASE WHEN p_patch ? 'poll_max_options' THEN (p_patch->>'poll_max_options')::int ELSE m.poll_max_options END,
      mention_all = CASE WHEN p_patch ? 'mention_all' THEN (p_patch->>'mention_all')::boolean ELSE m.mention_all END,
      contact_name = CASE WHEN p_patch ? 'contact_name' THEN p_patch->>'contact_name' ELSE m.contact_name END,
      contact_phone = CASE WHEN p_patch ? 'contact_phone' THEN p_patch->>'contact_phone' ELSE m.contact_phone END,
      disable_link_preview = CASE WHEN p_patch ? 'disable_link_preview' THEN (p_patch->>'disable_link_preview')::boolean ELSE m.disable_link_preview END
    WHERE m.id=r.id AND (
      m.message_content IS DISTINCT FROM v_txt OR m.media_url IS DISTINCT FROM v_media
      OR (p_patch ? 'poll_options' AND m.poll_options IS DISTINCT FROM p_patch->'poll_options')
      OR (p_patch ? 'poll_max_options' AND m.poll_max_options IS DISTINCT FROM (p_patch->>'poll_max_options')::int)
      OR (p_patch ? 'mention_all' AND m.mention_all IS DISTINCT FROM (p_patch->>'mention_all')::boolean)
      OR (p_patch ? 'contact_name' AND m.contact_name IS DISTINCT FROM p_patch->>'contact_name')
      OR (p_patch ? 'contact_phone' AND m.contact_phone IS DISTINCT FROM p_patch->>'contact_phone')
      OR (p_patch ? 'disable_link_preview' AND m.disable_link_preview IS DISTINCT FROM (p_patch->>'disable_link_preview')::boolean));
    RETURN QUERY SELECT r.id, r.campaign_id, true, CASE WHEN FOUND THEN 'ok' ELSE 'unchanged' END;
  END LOOP;
  IF v_n = 0 THEN RETURN QUERY SELECT p_block_id, NULL::uuid, false, 'not_draft'; END IF;
END $$;

-- Desvincular uma cópia (mensagem inteira daquela campanha)
CREATE OR REPLACE FUNCTION public.unlink_group_draft(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record;
BEGIN
  IF NOT public._can_review_group_drafts() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO o FROM group_campaign_scheduled_messages m WHERE m.id=public._group_draft_owner(p_id) FOR UPDATE;
  IF NOT FOUND OR o.status<>'draft' THEN RETURN false; END IF;
  UPDATE group_campaign_scheduled_messages m SET sync_key=NULL
   WHERE m.sync_key IS NOT NULL AND m.status IN ('draft','grouped')
     AND ((o.message_group_id IS NOT NULL AND m.message_group_id=o.message_group_id) OR m.id=o.id);
  RETURN true;
END $$;

-- Excluir rascunhos selecionados (nunca automático)
CREATE OR REPLACE FUNCTION public.delete_group_drafts(p_ids uuid[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; o record; v_n int := 0; v_c int;
BEGIN
  IF NOT public._can_review_group_drafts() THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOREACH v_id IN ARRAY coalesce(p_ids[1:200],'{}') LOOP
    SELECT * INTO o FROM group_campaign_scheduled_messages m WHERE m.id=public._group_draft_owner(v_id) FOR UPDATE;
    IF NOT FOUND OR o.status<>'draft' THEN CONTINUE; END IF;
    DELETE FROM group_campaign_scheduled_messages m
     WHERE m.status IN ('draft','grouped') AND m.sent_at IS NULL
       AND ((o.message_group_id IS NOT NULL AND m.message_group_id=o.message_group_id) OR m.id=o.id);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n + CASE WHEN v_c>0 THEN 1 ELSE 0 END;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.group_draft_cards(text,text,date,int,int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_group_drafts_synced(uuid,jsonb,uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_group_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_group_drafts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.group_draft_cards(text,text,date,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_group_drafts_synced(uuid,jsonb,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_group_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_group_drafts(uuid[]) TO authenticated;