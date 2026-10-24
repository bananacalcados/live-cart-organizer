BEGIN;
DO $$
DECLARE e uuid:=gen_random_uuid(); f boolean;
BEGIN
 INSERT INTO public.events(id,name,operation_mode,is_active,automation_enabled) VALUES(e,'TESTE flag capi','whatsapp_autoatendimento',false,false);
 SELECT capi_advanced_matching INTO f FROM public.events WHERE id=e;
 IF f IS NOT true THEN RAISE EXCEPTION 'flag deve nascer ligado'; END IF;
 UPDATE public.events SET capi_advanced_matching=false WHERE id=e;
 SELECT capi_advanced_matching INTO f FROM public.events WHERE id=e;
 IF f IS NOT false THEN RAISE EXCEPTION 'flag deve aceitar desligar'; END IF;
END $$;
ROLLBACK;
