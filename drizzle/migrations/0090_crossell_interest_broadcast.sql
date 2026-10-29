DROP TRIGGER trg_manual_crossell_interest ON public.whatsapp_messages;
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
NEW.source:='live_crossell_interest';
RETURN NEW;
END IF;
END LOOP;
END LOOP;
END LOOP;
RETURN NEW;
END; $$;
CREATE TRIGGER trg_manual_crossell_interest BEFORE INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction='incoming' AND (NEW.button_payload IS NOT NULL OR NEW.quoted_message_id IS NOT NULL)) EXECUTE FUNCTION public.match_manual_crossell_interest();
CREATE OR REPLACE FUNCTION public.notify_wa_message_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,realtime AS $$
BEGIN
IF COALESCE(NEW.is_mass_dispatch,false) THEN RETURN NEW; END IF;
PERFORM realtime.send(jsonb_build_object('id',NEW.id,'phone',NEW.phone,'whatsapp_number_id',NEW.whatsapp_number_id,'direction',NEW.direction,'created_at',NEW.created_at,'crossell_interest',NEW.source='live_crossell_interest'),'wa_msg_insert','wa_msg_inserts',false);
RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;
DROP POLICY crossell_execution_owner ON public.event_bulk_sends;
CREATE POLICY crossell_execution_owner ON public.event_bulk_sends AS RESTRICTIVE FOR ALL TO authenticated USING (NOT manual_blocks OR public.has_module_access(auth.uid(),'events')) WITH CHECK (NOT manual_blocks);
DROP POLICY crossell_item_owner ON public.event_bulk_send_items;
CREATE POLICY crossell_item_owner ON public.event_bulk_send_items AS RESTRICTIVE FOR ALL TO authenticated USING (NOT EXISTS (SELECT 1 FROM public.event_bulk_sends s WHERE s.id=send_id AND s.manual_blocks AND NOT public.has_module_access(auth.uid(),'events'))) WITH CHECK (NOT EXISTS (SELECT 1 FROM public.event_bulk_sends s WHERE s.id=send_id AND s.manual_blocks));