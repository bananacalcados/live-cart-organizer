CREATE OR REPLACE FUNCTION public.update_group_drafts_synced(p_block_id uuid, p_patch jsonb, p_only_ids uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid, campaign_id uuid, ok boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
DECLARE v_key text; r record; v_owner_status text; v_k text; v_n int := 0;
  v_allowed text[] := ARRAY['message_content','media_url','poll_options','poll_max_options','mention_all','contact_name','contact_phone','disable_link_preview'];
  v_txt text; v_media text;
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
    SELECT m.id, m.campaign_id, m.message_type, m.message_content, m.media_url
    FROM group_campaign_scheduled_messages m
    WHERE (m.id=p_block_id OR (v_key IS NOT NULL AND m.sync_key=v_key))
      AND m.status IN ('draft','grouped')
      AND (p_only_ids IS NULL OR m.id=p_block_id OR m.id = ANY(p_only_ids) OR m.campaign_id = ANY(p_only_ids))
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