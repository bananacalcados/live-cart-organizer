DO $fix$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer)'::regprocedure) INTO definition;
 definition := replace(definition, 'v_admin := public.has_role(auth.uid(),''admin'') OR public.has_role(auth.uid(),''moderator'');', 'SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role::text IN (''admin'',''moderator'')) INTO v_admin;');
 EXECUTE definition;
END $fix$;