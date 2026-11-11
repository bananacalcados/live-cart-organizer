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
    SELECT r.card_key, min(r.ref_id::text)::uuid ref_id, min(r.draft_batch) draft_batch, min(r.created_by) created_by,
           min(r.scheduled_at) first_at,
           jsonb_agg(jsonb_build_object('id',r.id,'campaign_id',r.campaign_id,'campaign_name',c.name,
             'scheduled_at',r.scheduled_at,'reason',r.reason,'content_differs', r.sig IS DISTINCT FROM r.ref_sig,
             'has_instance', (c.whatsapp_number_id IS NOT NULL))
             ORDER BY r.scheduled_at NULLS LAST) copies,
           bool_or(r.reason IS NULL) any_ready, bool_or(r.reason IS NOT NULL) any_blocked,
           bool_or(r.sig IS DISTINCT FROM r.ref_sig) any_differs, bool_or(r.scheduled_at < now()) any_past,
           bool_or(p_day IS NULL OR (r.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date = p_day) day_ok
    FROM ranked r LEFT JOIN group_campaigns c ON c.id=r.campaign_id
    GROUP BY r.card_key),
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