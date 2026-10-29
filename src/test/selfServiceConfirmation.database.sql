BEGIN;
DO $$
DECLARE e uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); first_message uuid; second_message uuid;
BEGIN
  INSERT INTO public.events(id,name,operation_mode,is_active,automation_enabled) VALUES(e,'Teste confirmação sem envio','whatsapp_autoatendimento',false,false);
  INSERT INTO public.event_leads(id,event_id,name,phone,source) VALUES(l,e,'Teste Confirmação','5533991238765','live_whatsapp_link');
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,confirm_code,lead_id,metadata) VALUES(a,e,'5533991238765','3391238765','Q8Z7K',l,'{}');
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238765','Oii, já preenchi meu cadastro #Q8Z7K.','incoming','received') RETURNING id INTO first_message;
  IF NOT EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND whatsapp_confirmed_at IS NOT NULL AND confirm_message_id=first_message AND confirmed_phone_key='3991238765') THEN RAISE EXCEPTION 'legacy key confirmation failed'; END IF;
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238765','Oii, já preenchi meu cadastro #Q8Z7K.','incoming','received') RETURNING id INTO second_message;
  IF EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND confirm_message_id=second_message) THEN RAISE EXCEPTION 'duplicate confirmation consumed'; END IF;
  a:=gen_random_uuid();
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,confirm_code,lead_id,metadata) VALUES(a,e,'5533991238765','3991238765','Q8Z7M',l,'{}');
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238766','Oii, já preenchi meu cadastro #Q8Z7M.','incoming','received') RETURNING id INTO first_message;
  IF NOT EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND confirm_message_id=first_message AND confirmed_phone='5533991238766') THEN RAISE EXCEPTION 'changed sender confirmation failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_leads WHERE id=l AND phone='5533991238766' AND phone_suffix='91238766') THEN RAISE EXCEPTION 'generated lead suffix was not updated by phone'; END IF;
  -- A real incoming contact can already exist under the corrected phone.
  -- Preserve both acquisition records without rolling back confirmation.
  INSERT INTO public.event_leads(event_id,name,phone,source) VALUES(e,'Contato já recebido','5533991238767','live_whatsapp_link');
  a:=gen_random_uuid();
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,confirm_code,lead_id,metadata) VALUES(a,e,'5533991238766','3991238766','Q8Z7N',l,'{}');
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238767','Oii, já preenchi meu cadastro #Q8Z7N.','incoming','received') RETURNING id INTO first_message;
  IF NOT EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND confirm_message_id=first_message AND whatsapp_confirmed_at IS NOT NULL AND confirmed_phone='5533991238767' AND metadata->>'lead_phone_sync_conflict'='true') THEN RAISE EXCEPTION 'lead collision rolled back real WhatsApp confirmation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_leads WHERE id=l AND phone='5533991238766') THEN RAISE EXCEPTION 'lead collision overwrote acquisition history'; END IF;
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238767','Oii, já preenchi meu cadastro #Q8Z7N.','incoming','received') RETURNING id INTO second_message;
  IF EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND confirm_message_id=second_message) THEN RAISE EXCEPTION 'lead collision duplicate confirmation consumed'; END IF;
END $$;
ROLLBACK;