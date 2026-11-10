CREATE OR REPLACE FUNCTION public.wa_normalize_outgoing_phone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.phone := '55' || NEW.phone;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wa_normalize_outgoing_phone() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_wa_normalize_outgoing_phone
BEFORE INSERT ON public.whatsapp_messages
FOR EACH ROW
WHEN (NEW.direction = 'outgoing' AND COALESCE(NEW.is_group,false) = false AND NEW.phone ~ '^[1-9][1-9]9?[0-9]{8}$')
EXECUTE FUNCTION public.wa_normalize_outgoing_phone();