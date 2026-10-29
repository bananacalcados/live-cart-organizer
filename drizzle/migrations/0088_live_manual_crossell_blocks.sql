ALTER TABLE public.event_message_presets DROP CONSTRAINT event_message_presets_kind_check;
ALTER TABLE public.event_message_presets ADD CONSTRAINT event_message_presets_kind_check CHECK (kind IN ('meta_template','wa_initial','crossell_blocks'));
ALTER TABLE public.event_bulk_sends ADD COLUMN manual_blocks boolean NOT NULL DEFAULT false;
ALTER TABLE public.event_bulk_send_items ADD COLUMN crossell_state text;
ALTER TABLE public.event_bulk_send_items ADD COLUMN crossell_progress jsonb NOT NULL DEFAULT '{"block":0,"file":0,"sent":[]}'::jsonb;
ALTER TABLE public.event_bulk_send_items ADD COLUMN crossell_next_at timestamptz;
ALTER TABLE public.event_bulk_send_items ADD COLUMN crossell_interest_at timestamptz;
ALTER TABLE public.event_bulk_send_items ADD COLUMN crossell_interest_message_id text;
CREATE POLICY crossell_execution_owner ON public.event_bulk_sends AS RESTRICTIVE FOR ALL TO authenticated USING (NOT manual_blocks OR created_by=auth.uid()) WITH CHECK (NOT manual_blocks);
CREATE POLICY crossell_item_owner ON public.event_bulk_send_items AS RESTRICTIVE FOR ALL TO authenticated USING (NOT EXISTS (SELECT 1 FROM public.event_bulk_sends s WHERE s.id=send_id AND s.manual_blocks AND s.created_by IS DISTINCT FROM auth.uid())) WITH CHECK (NOT EXISTS (SELECT 1 FROM public.event_bulk_sends s WHERE s.id=send_id AND s.manual_blocks));
CREATE OR REPLACE FUNCTION public.claim_event_bulk_send_items(p_limit integer DEFAULT 20,p_lock_seconds integer DEFAULT 120) RETURNS SETOF public.event_bulk_send_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
RETURN QUERY WITH picked AS (SELECT i.id FROM public.event_bulk_send_items i JOIN public.event_bulk_sends s ON s.id=i.send_id WHERE i.status='pending' AND NOT s.manual_blocks AND s.status IN ('queued','processing') AND (i.locked_until IS NULL OR i.locked_until<now()) ORDER BY i.created_at LIMIT LEAST(p_limit,200) FOR UPDATE OF i SKIP LOCKED) UPDATE public.event_bulk_send_items i SET locked_until=now()+make_interval(secs=>p_lock_seconds),attempts=i.attempts+1 FROM picked WHERE i.id=picked.id RETURNING i.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_event_bulk_send_items(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_bulk_send_items(integer,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_manual_crossell(p_item_id uuid) RETURNS SETOF public.event_bulk_send_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
RETURN QUERY UPDATE public.event_bulk_send_items i SET crossell_state='sending',locked_until=now()+interval '2 minutes',attempts=attempts+1 WHERE i.id=p_item_id AND i.crossell_state='pending' AND (i.crossell_next_at IS NULL OR i.crossell_next_at<=now()) AND EXISTS (SELECT 1 FROM public.event_bulk_sends s WHERE s.id=i.send_id AND s.manual_blocks AND s.status IN ('queued','processing')) RETURNING i.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_manual_crossell(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_manual_crossell(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.match_manual_crossell_interest() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item record; v_sent jsonb; v_button jsonb; v_payload text;
BEGIN
IF NEW.direction IS DISTINCT FROM 'incoming' OR NEW.is_group IS TRUE THEN RETURN NEW; END IF;
v_payload:=NEW.button_payload;
IF v_payload IS NULL AND NEW.quoted_message_id IS NULL THEN RETURN NEW; END IF;
FOR v_item IN SELECT i.id,i.crossell_progress FROM public.event_bulk_send_items i JOIN public.event_bulk_sends s ON s.id=i.send_id WHERE i.phone=NEW.phone AND i.whatsapp_number_id=NEW.whatsapp_number_id AND s.manual_blocks AND i.crossell_interest_at IS NULL AND i.created_at>now()-interval '2 days' ORDER BY i.created_at DESC LIMIT 20 LOOP
FOR v_sent IN SELECT value FROM jsonb_array_elements(COALESCE(v_item.crossell_progress->'sent','[]'::jsonb)) LOOP
FOR v_button IN SELECT value FROM jsonb_array_elements(COALESCE(v_sent->'buttons','[]'::jsonb)) LOOP
IF COALESCE((v_button->>'interest')::boolean,false) AND (v_payload=v_button->>'id' OR (NEW.quoted_message_id=v_sent->>'messageId' AND COALESCE(v_payload,NEW.message)=v_button->>'title')) THEN
UPDATE public.event_bulk_send_items SET crossell_interest_at=NEW.created_at,crossell_interest_message_id=NEW.message_id WHERE id=v_item.id AND crossell_interest_at IS NULL;
RETURN NEW;
END IF;
END LOOP;
END LOOP;
END LOOP;
RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.match_manual_crossell_interest() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_manual_crossell_interest AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction='incoming' AND (NEW.button_payload IS NOT NULL OR NEW.quoted_message_id IS NOT NULL)) EXECUTE FUNCTION public.match_manual_crossell_interest();