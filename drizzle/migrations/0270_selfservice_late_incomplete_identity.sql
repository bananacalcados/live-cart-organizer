-- A verified, still-unbound registration can resolve one incomplete order even
-- when its typed Instagram is wrong. Fully identified orders never compete by suffix.
CREATE OR REPLACE FUNCTION public.selfservice_access_for_order(p_order_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; c record; ids uuid[]; keys text[]; v_incomplete_ids uuid[];
BEGIN
 SELECT id,event_id,customer_id,phone_last4 INTO o FROM orders WHERE id=p_order_id;
 IF o.id IS NULL OR NOT EXISTS(SELECT 1 FROM events WHERE id=o.event_id AND operation_mode='whatsapp_autoatendimento') THEN RETURN NULL; END IF;
 SELECT whatsapp,instagram_handle INTO c FROM customers WHERE id=o.customer_id;
 SELECT array_agg(candidate.id ORDER BY candidate.id) INTO v_incomplete_ids
 FROM orders candidate JOIN customers customer ON customer.id=candidate.customer_id
 LEFT JOIN customer_registrations registration ON registration.order_id=candidate.id
 WHERE candidate.event_id=o.event_id AND candidate.phone_last4=o.phone_last4
   AND candidate.stage<>'cancelled' AND NOT coalesce(candidate.is_paid,false)
   AND NOT coalesce(candidate.paid_externally,false) AND candidate.merged_into_order_id IS NULL
   AND jsonb_array_length(CASE WHEN jsonb_typeof(candidate.products)='array' THEN candidate.products ELSE '[]'::jsonb END)>0
   AND length(regexp_replace(coalesce(customer.whatsapp,''),'\D','','g'))<10
   AND length(regexp_replace(coalesce(registration.whatsapp,''),'\D','','g'))<10
   AND NOT EXISTS(SELECT 1 FROM live_selfservice_accesses claimed
     WHERE claimed.event_id=o.event_id AND claimed.whatsapp_confirmed_at IS NOT NULL
       AND claimed.order_ids @> ARRAY[candidate.id]);
 SELECT array_agg(a.id ORDER BY a.whatsapp_confirmed_at DESC),array_agg(DISTINCT a.confirmed_phone_key) INTO ids,keys
 FROM live_selfservice_accesses a
 WHERE a.event_id=o.event_id AND a.whatsapp_confirmed_at IS NOT NULL AND a.registered_at IS NOT NULL
   AND (length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'))<10 OR a.confirmed_phone_key=event_phone_key(c.whatsapp))
   AND NOT EXISTS(SELECT 1 FROM customer_registrations registration WHERE registration.order_id=o.id
     AND length(regexp_replace(coalesce(registration.whatsapp,''),'\D','','g'))>=10
     AND event_phone_key(registration.whatsapp) IS DISTINCT FROM a.confirmed_phone_key)
   AND (a.order_ids @> ARRAY[o.id]
     OR (length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'))>=10
       AND a.confirmed_phone_key=event_phone_key(c.whatsapp)
       AND (ig_handle_norm(a.instagram) IS NULL OR ig_handle_norm(a.instagram)=ig_handle_norm(c.instagram_handle)))
     OR (ig_handle_norm(c.instagram_handle) IS NOT NULL AND ig_handle_norm(a.instagram)=ig_handle_norm(c.instagram_handle))
     OR (v_incomplete_ids=ARRAY[o.id] AND o.phone_last4=right(a.confirmed_phone,4)
       AND cardinality(coalesce(a.order_ids,'{}'))=0));
 IF cardinality(keys)=1 THEN RETURN ids[1]; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.selfservice_access_for_order(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_access_for_order(uuid) TO service_role;