
ALTER TABLE public.group_campaign_scheduled_messages
  ADD COLUMN created_by text NOT NULL DEFAULT 'user',
  ADD COLUMN draft_batch text,
  ADD COLUMN media_brief text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by text,
  ADD COLUMN draft_notes text;

-- Valores existentes conferidos antes: sent, cancelled, grouped, failed, pending.
ALTER TABLE public.group_campaign_scheduled_messages
  ADD CONSTRAINT group_scheduled_messages_status_check
  CHECK (status IN ('draft','pending','grouped','sending','sent','failed','cancelled'));

-- NOTA: get_dispatchable_scheduled_messages e try_claim_scheduled_message NÃO selecionam
-- status 'draft' (só pending/grouped/sending). Rascunhos nunca entram no fluxo de envio
-- sem passar por approve_group_drafts. Não regredir isso.

CREATE OR REPLACE FUNCTION public.approve_group_drafts(p_ids uuid[], p_approved_by text)
RETURNS TABLE(id uuid, ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  v_id uuid;
  v_msg record;
  v_group uuid;
  v_reason text;
  v_past boolean;
BEGIN
  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT * INTO v_msg FROM group_campaign_scheduled_messages m WHERE m.id = v_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT v_id, false, 'not_found'; CONTINUE;
    END IF;
    IF v_msg.status <> 'draft' THEN
      RETURN QUERY SELECT v_id, false, 'not_draft'; CONTINUE;
    END IF;

    v_group := v_msg.message_group_id;
    v_reason := NULL;

    -- Validações sobre TODOS os blocos da mensagem (mesmo message_group_id, ou só o próprio id)
    IF v_group IS NULL THEN
      IF v_msg.message_type IN ('image','video','audio','document') AND (v_msg.media_url IS NULL OR btrim(v_msg.media_url) = '') THEN
        v_reason := 'missing_media';
      ELSIF v_msg.message_type = 'poll' AND (v_msg.poll_options IS NULL OR jsonb_array_length(v_msg.poll_options) < 2) THEN
        v_reason := 'poll_needs_2_options';
      ELSIF v_msg.message_type = 'contact' AND (v_msg.contact_phone IS NULL OR btrim(v_msg.contact_phone) = '') THEN
        v_reason := 'missing_contact_phone';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM group_campaign_scheduled_messages b WHERE b.message_group_id = v_group AND b.message_type IN ('image','video','audio','document') AND (b.media_url IS NULL OR btrim(b.media_url) = '')) THEN
        v_reason := 'missing_media';
      ELSIF EXISTS (SELECT 1 FROM group_campaign_scheduled_messages b WHERE b.message_group_id = v_group AND b.message_type = 'poll' AND (b.poll_options IS NULL OR jsonb_array_length(b.poll_options) < 2)) THEN
        v_reason := 'poll_needs_2_options';
      ELSIF EXISTS (SELECT 1 FROM group_campaign_scheduled_messages b WHERE b.message_group_id = v_group AND b.message_type = 'contact' AND (b.contact_phone IS NULL OR btrim(b.contact_phone) = '')) THEN
        v_reason := 'missing_contact_phone';
      END IF;
    END IF;

    IF v_reason IS NULL AND v_msg.scheduled_at IS NULL THEN
      v_reason := 'missing_schedule';
    END IF;

    IF v_reason IS NULL THEN
      IF v_msg.whatsapp_number_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM group_campaigns c WHERE c.id = v_msg.campaign_id AND c.whatsapp_number_id IS NOT NULL
      ) THEN
        v_reason := 'missing_instance';
      END IF;
    END IF;

    IF v_reason IS NULL AND v_msg.vip_link_mode = 'none'
       AND EXISTS (
         SELECT 1 FROM group_campaign_scheduled_messages b
         WHERE (b.message_group_id = v_group AND v_group IS NOT NULL) OR (v_group IS NULL AND b.id = v_id)
       ) AND COALESCE(v_msg.message_content, '') ILIKE '%{{link_atendimento}}%' THEN
      v_reason := 'vip_link_without_mode';
    END IF;

    IF v_reason IS NOT NULL THEN
      RETURN QUERY SELECT v_id, false, v_reason; CONTINUE;
    END IF;

    v_past := v_msg.scheduled_at < now();

    -- Aprova o bloco 0 (ou mensagem única)
    UPDATE group_campaign_scheduled_messages m
    SET status = 'pending', approved_at = now(), approved_by = p_approved_by
    WHERE m.id = v_id AND m.status = 'draft';

    -- Blocos irmãos em draft viram grouped (nunca pending)
    IF v_group IS NOT NULL THEN
      UPDATE group_campaign_scheduled_messages m
      SET status = 'grouped', approved_at = now(), approved_by = p_approved_by
      WHERE m.message_group_id = v_group AND m.id <> v_id AND m.status = 'draft';
    END IF;

    RETURN QUERY SELECT v_id, true, CASE WHEN v_past THEN 'past_schedule' ELSE 'ok' END;
  END LOOP;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.approve_group_drafts(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_group_drafts(uuid[], text) TO service_role;
