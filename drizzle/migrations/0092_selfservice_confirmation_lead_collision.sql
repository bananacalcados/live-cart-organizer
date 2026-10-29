CREATE OR REPLACE FUNCTION public.live_selfservice_match_incoming()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_code text:=substring(coalesce(NEW.message,'') from '#([A-Z0-9]{5})\M'); v_acc public.live_selfservice_accesses%ROWTYPE; v_digits text:=regexp_replace(coalesce(NEW.phone,''),'\D','','g'); v_key text; v_secret text; v_match uuid[]; v_link jsonb;
BEGIN
  IF v_code IS NULL OR length(v_digits)<10 THEN RETURN NEW; END IF;
  v_key:=public.event_phone_key(NEW.phone);
  SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE confirm_code=v_code AND whatsapp_confirmed_at IS NULL FOR UPDATE;
  IF v_acc.id IS NULL THEN RETURN NEW; END IF;
  IF v_acc.metadata->>'initial_order_match'='true' THEN
    v_match:=public.selfservice_match_initial_order(v_acc.event_id,v_digits);
    IF v_key IS NOT DISTINCT FROM public.event_phone_key(v_acc.entered_phone) AND coalesce(array_length(v_match,1),0)=1 AND v_match=v_acc.order_ids THEN
      v_link:=public.live_link_order_verified(v_acc.event_id,v_digits);
      IF coalesce((v_link->>'ok')::boolean,false) IS NOT TRUE THEN v_acc.order_ids:='{}'; END IF;
    ELSE v_acc.order_ids:='{}'; END IF;
  END IF;
  UPDATE public.live_selfservice_accesses SET whatsapp_confirmed_at=now(),confirmed_phone=v_digits,confirmed_phone_key=v_key,confirmed_number_id=NEW.whatsapp_number_id,confirm_message_id=NEW.id,order_ids=v_acc.order_ids,updated_at=now(),metadata=metadata||CASE WHEN v_key IS DISTINCT FROM public.event_phone_key(entered_phone) THEN jsonb_build_object('entered_phone_original',entered_phone,'phone_changed_at',now()) ELSE '{}'::jsonb END WHERE id=v_acc.id;
  IF v_key IS DISTINCT FROM public.event_phone_key(v_acc.entered_phone) AND coalesce(array_length(v_acc.order_ids,1),0)>0 THEN
    UPDATE public.customers c SET whatsapp=v_digits,updated_at=now() FROM public.orders o WHERE o.id=ANY(v_acc.order_ids) AND c.id=o.customer_id AND regexp_replace(coalesce(c.whatsapp,''),'\D','','g') IS DISTINCT FROM v_digits;
    UPDATE public.customer_registrations SET whatsapp=v_digits WHERE order_id=ANY(v_acc.order_ids) AND whatsapp IS DISTINCT FROM v_digits;
  END IF;
  IF v_key IS DISTINCT FROM public.event_phone_key(v_acc.entered_phone) THEN
    -- Lead acquisition history is not a prerequisite for WhatsApp confirmation.
    -- A second lead may already own this event/phone; preserve both identities.
    BEGIN
      UPDATE public.event_leads SET phone=v_digits,metadata=metadata||jsonb_build_object('self_service_entered_phone',v_acc.entered_phone) WHERE id=v_acc.lead_id AND phone IS DISTINCT FROM v_digits;
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.live_selfservice_accesses SET metadata=metadata||jsonb_build_object('lead_phone_sync_conflict',true) WHERE id=v_acc.id;
    END;
  END IF;
  SELECT value INTO v_secret FROM public.internal_function_secrets WHERE key='cron_secret';
  PERFORM net.http_post(url:='https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/live-selfservice',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',coalesce(v_secret,'')),body:=jsonb_build_object('action','confirmed','access_id',v_acc.id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING '[live_selfservice_match_incoming] %',SQLERRM; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.live_selfservice_match_incoming() FROM PUBLIC, anon, authenticated;