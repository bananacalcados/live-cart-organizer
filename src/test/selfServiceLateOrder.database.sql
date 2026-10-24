BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE ev uuid:=gen_random_uuid(); cust uuid:=gen_random_uuid(); ord uuid:=gen_random_uuid(); acc uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.events(id,name,operation_mode) VALUES(ev,'TESTE TRANSACIONAL CARRINHO','whatsapp_autoatendimento');
 INSERT INTO public.customers(id,instagram_handle,whatsapp) VALUES(cust,'teste_carrinho_automatico','5533999997812');
 INSERT INTO public.live_selfservice_accesses(id,event_id,entered_phone,phone_key,instagram,registered_at,whatsapp_confirmed_at,confirmed_phone,confirmed_phone_key,order_ids)
 VALUES(acc,ev,'5533999997812',public.event_phone_key('5533999997812'),'teste_carrinho_automatico',now()-interval '5 minutes',now()-interval '4 minutes','5533999997812',public.event_phone_key('5533999997812'),'{}');
 INSERT INTO public.orders(id,event_id,customer_id,products,stage) VALUES(ord,ev,cust,'[]','awaiting_confirmation');
 IF public.selfservice_access_for_order(ord) IS DISTINCT FROM acc THEN RAISE EXCEPTION 'Cadastro anterior não identificado'; END IF;
 UPDATE public.customers SET whatsapp=NULL WHERE id=cust;
 IF public.selfservice_access_for_order(ord) IS DISTINCT FROM acc THEN RAISE EXCEPTION 'Instagram exato não identificado'; END IF;
 UPDATE public.customers SET instagram_handle='outro_perfil_ficticio' WHERE id=cust;
 IF public.selfservice_access_for_order(ord) IS NOT NULL THEN RAISE EXCEPTION 'Perfil incorreto associado'; END IF;
 UPDATE public.orders SET products='[{"title":"Teste","price":100}]',phone_last4='7812' WHERE id=ord;
 UPDATE public.customers SET instagram_handle=NULL WHERE id=cust;
 IF public.selfservice_access_for_order(ord) IS DISTINCT FROM acc THEN RAISE EXCEPTION 'Final único não identificado'; END IF;
 UPDATE public.customers SET whatsapp='5533888887812' WHERE id=cust;
 IF public.selfservice_access_for_order(ord) IS NOT NULL THEN RAISE EXCEPTION 'Telefone completo conflitante associado'; END IF;
 UPDATE public.customers SET whatsapp=NULL WHERE id=cust;
 INSERT INTO public.orders(event_id,customer_id,products,stage,phone_last4) VALUES(ev,cust,'[{"title":"Outro","price":100}]','incomplete_order','7812');
 IF public.selfservice_access_for_order(ord) IS NOT NULL THEN RAISE EXCEPTION 'Final ambíguo associado'; END IF;
END $$;
ROLLBACK;