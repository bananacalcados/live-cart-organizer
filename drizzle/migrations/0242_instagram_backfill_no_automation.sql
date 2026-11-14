DROP TRIGGER trg_auto_reopen_finished_conversation_on_message ON public.whatsapp_messages;
CREATE TRIGGER trg_auto_reopen_finished_conversation_on_message AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.auto_reopen_finished_conversation_on_message();

DROP TRIGGER trg_auto_unarchive_conversation ON public.whatsapp_messages;
CREATE TRIGGER trg_auto_unarchive_conversation AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.auto_unarchive_conversation_on_message();

DROP TRIGGER trg_chat_lane_clear_on_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_chat_lane_clear_on_incoming AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.chat_lane_clear_on_incoming();

DROP TRIGGER trg_event_unarchive_on_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_event_unarchive_on_incoming AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.event_unarchive_on_incoming_message();

DROP TRIGGER trg_live_selfservice_match_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_live_selfservice_match_incoming AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction = 'incoming' AND NEW.message LIKE '%já preenchi meu cadastro #%' AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.live_selfservice_match_incoming();

DROP TRIGGER trg_live_zap_match_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_live_zap_match_incoming AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.message IS NOT NULL AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.live_zap_match_incoming();

DROP TRIGGER trg_manual_crossell_interest ON public.whatsapp_messages;
CREATE TRIGGER trg_manual_crossell_interest BEFORE INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND (NEW.button_payload IS NOT NULL OR NEW.quoted_message_id IS NOT NULL) AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.match_manual_crossell_interest();

DROP TRIGGER trg_mark_orders_unread_on_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_mark_orders_unread_on_incoming AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.mark_orders_unread_on_incoming();

DROP TRIGGER trg_support_auto_detect ON public.whatsapp_messages;
CREATE TRIGGER trg_support_auto_detect AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.message IS NOT NULL AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.support_auto_detect_trigger();

DROP TRIGGER trg_vip_link_match_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_vip_link_match_incoming AFTER INSERT ON public.whatsapp_messages FOR EACH ROW WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.message IS NOT NULL AND NEW.message ~* '(VIP-[A-Z0-9]{6}|^\s*Oi! (Quero este produto:|Vim do grupo))' AND NEW.source IS DISTINCT FROM 'instagram_backfill') EXECUTE FUNCTION public.vip_link_match_incoming();