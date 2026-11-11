CREATE OR REPLACE FUNCTION public.approve_group_drafts_synced(p_anchor_ids uuid[], p_sibling_ids uuid[], p_approved_by text)
RETURNS TABLE(anchor_id uuid, id uuid, campaign_id uuid, ok boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
DECLARE v_a uuid; v_s uuid; v_ok boolean; v_r text; v_key text; v_camp uuid; v_acamp uuid;
  v_done uuid[] := '{}';
BEGIN
  IF NOT public._is_group_staff() THEN RAISE EXCEPTION 'forbidden'; END IF;
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
REVOKE ALL ON FUNCTION public.approve_group_drafts_synced(uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_group_drafts_synced(uuid[], uuid[], text) TO authenticated;