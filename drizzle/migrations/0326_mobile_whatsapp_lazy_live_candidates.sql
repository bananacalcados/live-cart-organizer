DO $fix$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer)'::regprocedure) INTO definition;
 definition := replace(definition, 'WHERE length(regexp_replace(coalesce(c.whatsapp,''''),''\D'','''',''g'')) BETWEEN 8 AND 13', 'WHERE (p_lane=''live'' OR length(btrim(p_query))>=3) AND length(regexp_replace(coalesce(c.whatsapp,''''),''\D'','''',''g'')) BETWEEN 8 AND 13');
 definition := replace(definition, '(lp.phone_key IS NOT NULL OR lm.lane=''live'')', '(EXISTS (SELECT 1 FROM public.customers lc JOIN public.orders lo ON lo.customer_id=lc.id JOIN active_events le ON le.id=lo.event_id WHERE right(regexp_replace(coalesce(lc.whatsapp,''''),''\D'','''',''g''),8)=right(b.phone,8)) OR lm.lane=''live'')');
 EXECUTE definition;
END $fix$;