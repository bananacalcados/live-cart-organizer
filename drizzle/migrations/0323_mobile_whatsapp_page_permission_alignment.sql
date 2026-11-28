DO $fix$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer)'::regprocedure) INTO definition;
 definition := replace(definition, 'has_module_access(auth.uid(),''pdv'')', 'has_module_access(auth.uid(),''pos'')');
 definition := replace(definition, 'o.stage NOT IN (''cancelado'',''cancelled'')', 'o.stage::text NOT IN (''cancelado'',''cancelled'')');
 EXECUTE definition;
END $fix$;