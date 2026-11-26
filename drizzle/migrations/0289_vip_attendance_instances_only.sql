ALTER TABLE public.whatsapp_numbers ADD COLUMN IF NOT EXISTS vip_attendance_enabled boolean NOT NULL DEFAULT false;
UPDATE public.whatsapp_numbers SET vip_attendance_enabled = true
 WHERE id IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','1f715932-e118-4e88-8051-85a5c14f5a4b') AND vip_attendance_enabled IS DISTINCT FROM true;

CREATE OR REPLACE VIEW public.whatsapp_numbers_safe AS
 SELECT id, label, phone_display, phone_number_id, business_account_id, is_default, is_active, created_at, updated_at, provider, zapi_instance_id, ai_paused, is_online, last_health_check, wasender_session_id, wasender_phone_number, uazapi_instance_name, uazapi_owner, uazapi_proxy_mode, uazapi_proxy_managed_country, uazapi_proxy_managed_state, uazapi_proxy_managed_city, instagram_account_id, instagram_username, health_check_error, vip_attendance_enabled
   FROM public.whatsapp_numbers;

CREATE OR REPLACE FUNCTION public.vip_dest_attendance_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM whatsapp_numbers WHERE id = NEW.whatsapp_number_id AND vip_attendance_enabled) THEN
    RAISE EXCEPTION 'Essa instância não é de atendimento. Use Whats Pérola ou Whats Centro.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.vip_dest_attendance_guard() FROM PUBLIC, anon;

UPDATE public.vip_link_daily_destination SET whatsapp_number_id = '1f715932-e118-4e88-8051-85a5c14f5a4b', updated_at = now()
 WHERE whatsapp_number_id = 'fb7dd381-6460-4f28-8d01-f15943edb879';

DROP TRIGGER IF EXISTS trg_vip_dest_attendance_guard ON public.vip_link_daily_destination;
CREATE TRIGGER trg_vip_dest_attendance_guard BEFORE INSERT OR UPDATE OF whatsapp_number_id ON public.vip_link_daily_destination
 FOR EACH ROW EXECUTE FUNCTION public.vip_dest_attendance_guard();