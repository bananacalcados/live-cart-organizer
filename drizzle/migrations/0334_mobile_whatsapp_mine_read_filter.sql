DO $mobile_mine$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer)'::regprocedure) INTO definition;
 marker := 'AND (v_admin OR e.assigned_to IS NULL OR e.assigned_to=auth.uid() OR e.assigned_to=v_viewer)';
 IF position(marker IN definition)=0 OR position('p_lane IN (''all'',''archived'',''dispatch'')' IN definition)=0 THEN
   RAISE EXCEPTION 'Mobile conversation read differs; no change applied';
 END IF;
 definition := replace(definition,marker,marker||E'\n AND (p_lane<>''mine'' OR (v_viewer IS NOT NULL AND e.assigned_to=v_viewer))');
 definition := replace(definition,'p_lane IN (''all'',''archived'',''dispatch'')','p_lane IN (''all'',''archived'',''dispatch'',''mine'')');
 EXECUTE definition;
END $mobile_mine$;
REVOKE ALL ON FUNCTION public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer) TO authenticated,service_role;