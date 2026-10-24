CREATE OR REPLACE FUNCTION public.selfservice_match_initial_order(p_event_id uuid, p_phone text)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_ids uuid[]; v_existing text; v_key text := public.event_phone_key(p_phone);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id=p_event_id AND operation_mode='whatsapp_autoatendimento') THEN RETURN '{}'; END IF;
  SELECT array_agg(o.id ORDER BY o.id) INTO v_ids FROM public.orders o
  WHERE o.event_id=p_event_id AND o.phone_last4=right(regexp_replace(p_phone,'\D','','g'),4)
    AND o.stage<>'cancelled' AND NOT coalesce(o.is_paid,false) AND NOT coalesce(o.paid_externally,false)
    AND o.merged_into_order_id IS NULL AND jsonb_array_length(CASE WHEN jsonb_typeof(o.products)='array' THEN o.products ELSE '[]'::jsonb END)>0;
  IF coalesce(array_length(v_ids,1),0)<>1 THEN RETURN '{}'; END IF;
  SELECT c.whatsapp INTO v_existing FROM public.orders o JOIN public.customers c ON c.id=o.customer_id WHERE o.id=v_ids[1];
  IF nullif(regexp_replace(coalesce(v_existing,''),'\D','','g'),'') IS NOT NULL AND public.event_phone_key(v_existing) IS DISTINCT FROM v_key THEN RETURN '{}'; END IF;
  IF EXISTS (SELECT 1 FROM public.live_selfservice_accesses a WHERE a.event_id=p_event_id AND a.phone_key<>v_key AND a.order_ids @> v_ids AND a.metadata->>'initial_order_match'='true') THEN RETURN '{}'; END IF;
  RETURN v_ids;
END $$;
REVOKE ALL ON FUNCTION public.selfservice_match_initial_order(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_match_initial_order(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.selfservice_capture_initial(p_event_id uuid,p_phone text,p_instagram text DEFAULT NULL,p_access_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_phone text:=regexp_replace(coalesce(p_phone,''),'\D','','g'); v_key text; v_acc public.live_selfservice_accesses%ROWTYPE; v_ids uuid[]; v_lead uuid; v_buyer boolean; v_ig text:=nullif(left(btrim(coalesce(p_instagram,''),'@ '),60),'');
BEGIN
  IF v_phone ~ '^\d{10,11}$' THEN v_phone:='55'||v_phone; END IF;
  IF v_phone ~ '^55\d{10}$' THEN v_phone:=left(v_phone,4)||'9'||substring(v_phone from 5); END IF;
  IF v_phone !~ '^55[1-9][0-9]9[0-9]{8}$' OR NOT EXISTS (SELECT 1 FROM public.events WHERE id=p_event_id AND operation_mode='whatsapp_autoatendimento') THEN RAISE EXCEPTION 'invalid initial contact'; END IF;
  v_key:=public.event_phone_key(v_phone);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text||':initial:'||right(v_phone,4),0));
  IF p_access_id IS NOT NULL THEN SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE id=p_access_id AND event_id=p_event_id AND phone_key=v_key; END IF;
  IF v_acc.id IS NULL THEN SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE event_id=p_event_id AND phone_key=v_key AND registered_at IS NULL ORDER BY created_at DESC LIMIT 1; END IF;
  v_ids:=public.selfservice_match_initial_order(p_event_id,v_phone);
  SELECT EXISTS (SELECT 1 FROM public.customers_unified WHERE phone_suffix8=right(v_phone,8) AND coalesce(total_orders,0)>0) INTO v_buyer;
  SELECT id INTO v_lead FROM public.event_leads WHERE event_id=p_event_id AND phone_suffix=right(v_phone,8) AND public.event_phone_key(phone)=v_key ORDER BY created_at,id LIMIT 1;
  IF v_lead IS NULL AND NOT v_buyer THEN
    INSERT INTO public.event_leads(event_id,name,phone,source,instagram,metadata)
      VALUES(p_event_id,'Lead WhatsApp',v_phone,'live_whatsapp_link',v_ig,jsonb_build_object('selfservice_initial',true))
      ON CONFLICT(event_id,phone) DO NOTHING RETURNING id INTO v_lead;
  END IF;
  IF v_acc.id IS NULL THEN
    INSERT INTO public.live_selfservice_accesses(event_id,entered_phone,phone_key,instagram,order_ids,lead_id,metadata)
      VALUES(p_event_id,v_phone,v_key,v_ig,coalesce(v_ids,'{}'),v_lead,jsonb_build_object('initial_contact',true,'initial_order_match',coalesce(array_length(v_ids,1),0)=1)) RETURNING * INTO v_acc;
  ELSIF v_acc.whatsapp_confirmed_at IS NULL THEN
    UPDATE public.live_selfservice_accesses SET instagram=coalesce(v_ig,instagram),lead_id=coalesce(lead_id,v_lead),
      order_ids=CASE WHEN registered_at IS NULL THEN coalesce(v_ids,'{}') ELSE order_ids END,
      metadata=metadata||jsonb_build_object('initial_contact',true,'initial_order_match',coalesce(array_length(v_ids,1),0)=1),updated_at=now()
      WHERE id=v_acc.id AND (instagram IS DISTINCT FROM coalesce(v_ig,instagram) OR (lead_id IS NULL AND v_lead IS NOT NULL) OR metadata->>'initial_contact' IS DISTINCT FROM 'true' OR (registered_at IS NULL AND order_ids IS DISTINCT FROM coalesce(v_ids,'{}')))
      RETURNING * INTO v_acc;
    IF v_acc.id IS NULL THEN SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE event_id=p_event_id AND phone_key=v_key ORDER BY created_at DESC LIMIT 1; END IF;
  END IF;
  RETURN jsonb_build_object('access_id',v_acc.id,'lead_id',v_lead,'is_customer',v_buyer,'order_ids',coalesce(v_ids,'{}'));
END $$;
REVOKE ALL ON FUNCTION public.selfservice_capture_initial(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_capture_initial(uuid,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.selfservice_initial_contacts(p_event_id uuid,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0,p_search text DEFAULT NULL)
RETURNS TABLE(id uuid,phone text,instagram text,created_at timestamptz,order_ids uuid[],confirmed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE events.id=p_event_id AND operation_mode='whatsapp_autoatendimento') THEN RETURN; END IF;
  RETURN QUERY WITH latest AS (
    SELECT DISTINCT ON (a.phone_key) a.id,a.entered_phone,a.confirmed_phone,a.instagram,a.created_at,a.order_ids,a.whatsapp_confirmed_at
    FROM public.live_selfservice_accesses a WHERE a.event_id=p_event_id
    ORDER BY a.phone_key,a.created_at DESC,a.id
  ) SELECT a.id,coalesce(a.confirmed_phone,a.entered_phone),a.instagram,a.created_at,a.order_ids,a.whatsapp_confirmed_at IS NOT NULL
    FROM latest a WHERE nullif(btrim(p_search),'') IS NULL OR coalesce(a.instagram,'') ILIKE '%'||p_search||'%' OR coalesce(a.confirmed_phone,a.entered_phone) LIKE '%'||regexp_replace(p_search,'\D','','g')||'%' AND length(regexp_replace(p_search,'\D','','g'))>=3
    ORDER BY a.created_at DESC,a.id LIMIT greatest(1,least(coalesce(p_limit,100),200)) OFFSET greatest(0,coalesce(p_offset,0));
END $$;
REVOKE ALL ON FUNCTION public.selfservice_initial_contacts(uuid,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.selfservice_initial_contacts(uuid,integer,integer,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.notify_selfservice_initial_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM realtime.send(jsonb_build_object('event_id',NEW.event_id,'id',NEW.id),'initial_contact','selfservice_contacts_'||NEW.event_id::text,false);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER trg_selfservice_initial_insert AFTER INSERT ON public.live_selfservice_accesses FOR EACH ROW EXECUTE FUNCTION public.notify_selfservice_initial_contact();
CREATE TRIGGER trg_selfservice_initial_update AFTER UPDATE ON public.live_selfservice_accesses FOR EACH ROW WHEN (OLD.order_ids IS DISTINCT FROM NEW.order_ids OR OLD.whatsapp_confirmed_at IS DISTINCT FROM NEW.whatsapp_confirmed_at OR OLD.instagram IS DISTINCT FROM NEW.instagram) EXECUTE FUNCTION public.notify_selfservice_initial_contact();