CREATE OR REPLACE FUNCTION public.selfservice_access_for_order(p_order_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; c record; ids uuid[]; keys text[];
BEGIN
 SELECT id,event_id,customer_id INTO o FROM orders WHERE id=p_order_id;
 IF o.id IS NULL THEN RETURN NULL; END IF;
 SELECT whatsapp,instagram_handle INTO c FROM customers WHERE id=o.customer_id;
 SELECT array_agg(a.id ORDER BY a.whatsapp_confirmed_at DESC),array_agg(DISTINCT a.confirmed_phone_key) INTO ids,keys FROM live_selfservice_accesses a
 WHERE a.event_id=o.event_id AND a.whatsapp_confirmed_at IS NOT NULL AND a.registered_at IS NOT NULL
 AND (a.order_ids @> ARRAY[o.id] OR
 (length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'))>=10 AND a.confirmed_phone_key=event_phone_key(c.whatsapp)
 AND (nullif(trim(both '@ ' from coalesce(a.instagram,'')),'') IS NULL OR ig_handle_norm(a.instagram)=ig_handle_norm(c.instagram_handle)))
 OR (nullif(trim(both '@ ' from coalesce(c.instagram_handle,'')),'') IS NOT NULL AND ig_handle_norm(a.instagram)=ig_handle_norm(c.instagram_handle)));
 IF cardinality(keys)=1 THEN RETURN ids[1]; END IF;
 RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.selfservice_access_for_order(uuid) TO service_role,sandbox_exec;