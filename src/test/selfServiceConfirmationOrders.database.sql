BEGIN;
DO $$
DECLARE
  e uuid:=gen_random_uuid(); a uuid; other uuid; c uuid; o1 uuid; o2 uuid; msg uuid;
BEGIN
  INSERT INTO public.events(id,name,operation_mode,is_active,automation_enabled) VALUES(e,'Teste confirmação preserva pedido','whatsapp_autoatendimento',false,false);

  -- A second order with the same last four appears after capture: keep the original.
  c:=gen_random_uuid(); o1:=gen_random_uuid(); o2:=gen_random_uuid(); a:=gen_random_uuid(); other:=gen_random_uuid();
  INSERT INTO public.customers(id,instagram_handle) VALUES(c,'teste_confirma_original');
  INSERT INTO public.orders(id,event_id,customer_id,products,stage,phone_last4) VALUES(o1,e,c,'[{"title":"Um","price":100}]','incomplete_order','8765');
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,instagram,confirm_code,order_ids,registered_at,metadata)
  VALUES(a,e,'5533991238765',public.event_phone_key('5533991238765'),'teste_confirma_original','Q9A1A',ARRAY[o1],now(),'{"initial_order_match":true}');
  INSERT INTO public.orders(id,event_id,customer_id,products,stage,phone_last4) VALUES(o2,e,c,'[{"title":"Dois","price":100}]','incomplete_order','8765');
  -- Another access for the same verified phone must not erase the captured order either.
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,instagram,order_ids,registered_at,whatsapp_confirmed_at,confirmed_phone,confirmed_phone_key)
  VALUES(other,e,'5533991238765',public.event_phone_key('5533991238765'),'teste_confirma_original',ARRAY[o1],now(),now(),'5533991238765',public.event_phone_key('5533991238765'));
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238765','já preenchi meu cadastro #Q9A1A','incoming','received') RETURNING id INTO msg;
  IF NOT EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND confirm_message_id=msg AND order_ids=ARRAY[o1]) THEN RAISE EXCEPTION 'ambiguous rematch erased original order'; END IF;

  -- Sender changed, but exact Instagram still validates the captured order and fills blank phone.
  c:=gen_random_uuid(); o1:=gen_random_uuid(); a:=gen_random_uuid();
  INSERT INTO public.customers(id,instagram_handle) VALUES(c,'@teste_confirma_instagram');
  INSERT INTO public.orders(id,event_id,customer_id,products,stage,phone_last4) VALUES(o1,e,c,'[{"title":"Três","price":100}]','incomplete_order','9999');
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,instagram,confirm_code,order_ids,registered_at,metadata)
  VALUES(a,e,'5533991238765',public.event_phone_key('5533991238765'),'teste_confirma_instagram','Q9A2B',ARRAY[o1],now(),'{"initial_order_match":false}');
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238766','já preenchi meu cadastro #Q9A2B','incoming','received') RETURNING id INTO msg;
  IF NOT EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND order_ids=ARRAY[o1]) THEN RAISE EXCEPTION 'changed sender erased Instagram-valid order'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=c AND whatsapp='5533991238766') THEN RAISE EXCEPTION 'confirmed phone did not fill blank customer phone'; END IF;

  -- Empty initial result can still be recovered by exact normalized Instagram.
  c:=gen_random_uuid(); o1:=gen_random_uuid(); a:=gen_random_uuid();
  INSERT INTO public.customers(id,instagram_handle) VALUES(c,'@teste_confirma_espaco');
  INSERT INTO public.orders(id,event_id,customer_id,products,stage) VALUES(o1,e,c,'[{"title":"Quatro","price":100}]','incomplete_order');
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,instagram,confirm_code,order_ids,registered_at,metadata)
  VALUES(a,e,'5533991238765',public.event_phone_key('5533991238765'),' teste_ confirma_espaco ','Q9A3C','{}',now(),'{"initial_order_match":false}');
  IF public.selfservice_orders_by_instagram(e,' @teste_ confirma_espaco ','5533991238765') IS DISTINCT FROM ARRAY[o1] THEN RAISE EXCEPTION 'open order Instagram normalization failed'; END IF;
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238765','já preenchi meu cadastro #Q9A3C','incoming','received') RETURNING id INTO msg;
  IF NOT EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND order_ids=ARRAY[o1]) THEN RAISE EXCEPTION 'Instagram fallback did not recover empty order_ids'; END IF;

  -- Same phone never overrides a conflicting Instagram identity.
  c:=gen_random_uuid(); o1:=gen_random_uuid(); a:=gen_random_uuid();
  INSERT INTO public.customers(id,instagram_handle,whatsapp) VALUES(c,'@perfil_do_pedido','5533991238765');
  INSERT INTO public.orders(id,event_id,customer_id,products,stage,phone_last4) VALUES(o1,e,c,'[{"title":"Cinco","price":100}]','incomplete_order','8765');
  INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,instagram,confirm_code,order_ids,registered_at,metadata)
  VALUES(a,e,'5533991238765',public.event_phone_key('5533991238765'),'perfil_de_outra_pessoa','Q9A4D',ARRAY[o1],now(),'{"initial_order_match":true}');
  INSERT INTO public.whatsapp_messages(phone,message,direction,status) VALUES('5533991238765','já preenchi meu cadastro #Q9A4D','incoming','received');
  IF NOT EXISTS(SELECT 1 FROM public.live_selfservice_accesses WHERE id=a AND order_ids='{}') THEN RAISE EXCEPTION 'conflicting Instagram was linked by phone'; END IF;
END $$;
ROLLBACK;
