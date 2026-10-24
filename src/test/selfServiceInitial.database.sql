BEGIN;
DO $$
DECLARE e uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); o2 uuid:=gen_random_uuid(); a jsonb; b jsonb; buyer uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.events(id,name,operation_mode,is_active,automation_enabled) VALUES(e,'TESTE transacional captura','whatsapp_autoatendimento',false,false);
  INSERT INTO public.customers(id,instagram_handle) VALUES(c,'teste_transacional_captura');
  INSERT INTO public.orders(id,event_id,customer_id,stage,products,phone_last4) VALUES(o,e,c,'incomplete_order','[{"title":"Teste","price":100}]','8765');
  a:=public.selfservice_capture_initial(e,'5533991238765');
  IF a->'order_ids' <> jsonb_build_array(o) THEN RAISE EXCEPTION 'unique last4 not matched'; END IF;
  b:=public.selfservice_capture_initial(e,'5533991238765');
  IF a->>'access_id' IS DISTINCT FROM b->>'access_id' THEN RAISE EXCEPTION 'capture not idempotent'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE id=o AND (registered_at IS NOT NULL OR is_paid OR eligible_for_prize)) THEN RAISE EXCEPTION 'initial capture changed registration/payment'; END IF;
  IF EXISTS(SELECT 1 FROM public.customers WHERE id=c AND nullif(whatsapp,'') IS NOT NULL) THEN RAISE EXCEPTION 'initial capture overwrote official phone'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_leads WHERE event_id=e AND phone='5533991238765' AND metadata->>'selfservice_initial'='true' AND source<>'autoatendimento') THEN RAISE EXCEPTION 'prospect not saved'; END IF;
  INSERT INTO public.orders(id,event_id,customer_id,stage,products,phone_last4) VALUES(o2,e,c,'incomplete_order','[{"title":"Teste","price":100}]','8765');
  IF cardinality(public.selfservice_match_initial_order(e,'5533991238765'))<>0 THEN RAISE EXCEPTION 'ambiguous last4 matched'; END IF;
  DELETE FROM public.orders WHERE id=o2;
  UPDATE public.customers SET whatsapp='5533987654321' WHERE id=c;
  IF cardinality(public.selfservice_match_initial_order(e,'5533991238765'))<>0 THEN RAISE EXCEPTION 'conflicting official phone matched'; END IF;
  INSERT INTO public.customers_unified(id,name,phone_e164,phone_suffix8,total_orders) VALUES(buyer,'Teste Cliente Anterior','5533999876543','99876543',1);
  a:=public.selfservice_capture_initial(e,'5533999876543');
  IF a->>'is_customer'<>'true' OR EXISTS(SELECT 1 FROM public.event_leads WHERE event_id=e AND phone='5533999876543') THEN RAISE EXCEPTION 'buyer became prospect'; END IF;
  IF has_function_privilege('anon','public.selfservice_capture_initial(uuid,text,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public capture RPC exposed'; END IF;
END $$;
ROLLBACK;