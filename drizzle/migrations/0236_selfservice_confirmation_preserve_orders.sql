CREATE OR REPLACE FUNCTION public.selfservice_orders_by_instagram(p_event_id uuid, p_instagram text, p_phone text)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH h AS (SELECT public.ig_handle_norm(regexp_replace(coalesce(p_instagram,''), '\s', '', 'g')) AS k)
  SELECT coalesce(array_agg(o.id ORDER BY o.created_at,o.id), '{}')
  FROM h JOIN public.orders o ON o.event_id = p_event_id
  JOIN public.customers c ON c.id = o.customer_id
  WHERE h.k IS NOT NULL
    AND public.ig_handle_norm(regexp_replace(coalesce(c.instagram_handle,''), '\s', '', 'g')) = h.k
    AND o.stage <> 'cancelled' AND o.merged_into_order_id IS NULL
    AND coalesce(o.is_paid,false) = false AND coalesce(o.paid_externally,false) = false
    AND jsonb_array_length(CASE WHEN jsonb_typeof(o.products)='array' THEN o.products ELSE '[]'::jsonb END)>0
    AND (nullif(regexp_replace(coalesce(c.whatsapp,''), '\D', '', 'g'), '') IS NULL
         OR public.event_phone_key(c.whatsapp) = public.event_phone_key(p_phone))
$$;
REVOKE ALL ON FUNCTION public.selfservice_orders_by_instagram(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_orders_by_instagram(uuid, text, text) TO service_role;

-- Resolve the confirmation without throwing away a previously captured order.
-- Exact phone or exact normalized Instagram must agree; conflicting handles never match by phone alone.
CREATE OR REPLACE FUNCTION public.selfservice_confirmation_order_ids(p_access_id uuid, p_phone text)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_acc public.live_selfservice_accesses%ROWTYPE;
  v_key text:=public.event_phone_key(p_phone);
  v_entered_key text;
  v_original uuid[];
  v_keep uuid[];
  v_ig uuid[];
BEGIN
  SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE id=p_access_id;
  IF v_acc.id IS NULL THEN RETURN '{}'; END IF;
  v_original:=coalesce(v_acc.order_ids,'{}');
  v_entered_key:=public.event_phone_key(v_acc.entered_phone);

  SELECT array_agg(o.id ORDER BY o.created_at,o.id) INTO v_keep
  FROM public.orders o
  JOIN public.customers c ON c.id=o.customer_id
  WHERE o.id=ANY(v_original) AND o.event_id=v_acc.event_id
    AND o.stage<>'cancelled' AND o.merged_into_order_id IS NULL
    AND jsonb_array_length(CASE WHEN jsonb_typeof(o.products)='array' THEN o.products ELSE '[]'::jsonb END)>0
    AND (public.ig_handle_norm(regexp_replace(coalesce(v_acc.instagram,''),'\s','','g')) IS NULL
         OR public.ig_handle_norm(regexp_replace(coalesce(c.instagram_handle,''),'\s','','g')) IS NULL
         OR public.ig_handle_norm(regexp_replace(coalesce(c.instagram_handle,''),'\s','','g'))=public.ig_handle_norm(regexp_replace(coalesce(v_acc.instagram,''),'\s','','g')))
    AND (public.event_phone_key(c.whatsapp)=v_key
         OR (public.ig_handle_norm(regexp_replace(coalesce(v_acc.instagram,''),'\s','','g')) IS NOT NULL
             AND public.ig_handle_norm(regexp_replace(coalesce(c.instagram_handle,''),'\s','','g'))=public.ig_handle_norm(regexp_replace(coalesce(v_acc.instagram,''),'\s','','g')))
         OR (v_key IS NOT DISTINCT FROM v_entered_key AND nullif(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'),'') IS NULL));

  IF coalesce(array_length(v_keep,1),0)>0 THEN RETURN v_keep; END IF;

  -- Ambiguous/empty initial match: Instagram is the second independent proof.
  -- Do not claim an order already confirmed by a different phone in another access.
  SELECT array_agg(o.id ORDER BY o.created_at,o.id) INTO v_ig
  FROM public.orders o
  JOIN public.customers c ON c.id=o.customer_id
  WHERE o.event_id=v_acc.event_id
    AND public.ig_handle_norm(regexp_replace(coalesce(v_acc.instagram,''),'\s','','g')) IS NOT NULL
    AND public.ig_handle_norm(regexp_replace(coalesce(c.instagram_handle,''),'\s','','g'))=public.ig_handle_norm(regexp_replace(coalesce(v_acc.instagram,''),'\s','','g'))
    AND o.stage<>'cancelled' AND o.merged_into_order_id IS NULL
    AND jsonb_array_length(CASE WHEN jsonb_typeof(o.products)='array' THEN o.products ELSE '[]'::jsonb END)>0
    AND (nullif(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'),'') IS NULL OR public.event_phone_key(c.whatsapp)=v_key)
    AND NOT EXISTS (
      SELECT 1 FROM public.live_selfservice_accesses other
      WHERE other.event_id=v_acc.event_id AND other.id<>v_acc.id
        AND other.whatsapp_confirmed_at IS NOT NULL AND other.order_ids @> ARRAY[o.id]
        AND other.confirmed_phone_key IS DISTINCT FROM v_key
    );
  RETURN coalesce(v_ig,'{}');
END $$;
REVOKE ALL ON FUNCTION public.selfservice_confirmation_order_ids(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_confirmation_order_ids(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.live_selfservice_match_incoming()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_code text:=substring(coalesce(NEW.message,'') from '#([A-Z0-9]{5})\M');
  v_acc public.live_selfservice_accesses%ROWTYPE;
  v_digits text:=regexp_replace(coalesce(NEW.phone,''),'\D','','g');
  v_key text;
  v_secret text;
  v_match uuid[];
  v_original uuid[];
  v_resolved uuid[];
  v_link jsonb;
  v_note jsonb;
BEGIN
  IF v_code IS NULL OR length(v_digits)<10 THEN RETURN NEW; END IF;
  v_key:=public.event_phone_key(NEW.phone);
  SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE confirm_code=v_code AND whatsapp_confirmed_at IS NULL FOR UPDATE;
  IF v_acc.id IS NULL THEN RETURN NEW; END IF;
  v_original:=coalesce(v_acc.order_ids,'{}');
  IF v_acc.metadata->>'initial_order_match'='true' THEN
    v_match:=public.selfservice_match_initial_order(v_acc.event_id,v_digits);
  END IF;
  v_resolved:=public.selfservice_confirmation_order_ids(v_acc.id,v_digits);
  v_note:=jsonb_build_object(
    'at',now(),
    'original_order_ids',v_original,
    'resolved_order_ids',v_resolved,
    'rematch_order_ids',coalesce(v_match,'{}'),
    'preserved_on_divergence',v_original IS DISTINCT FROM v_resolved AND coalesce(array_length(v_resolved,1),0)>0,
    'instagram_fallback',coalesce(array_length(v_original,1),0)=0 AND coalesce(array_length(v_resolved,1),0)>0
  );
  IF v_acc.metadata->>'initial_order_match'='true'
     AND v_key IS NOT DISTINCT FROM public.event_phone_key(v_acc.entered_phone)
     AND coalesce(array_length(v_match,1),0)=1
     AND v_match=v_original AND v_resolved=v_original THEN
    v_link:=public.live_link_order_verified(v_acc.event_id,v_digits);
    IF coalesce((v_link->>'ok')::boolean,false) IS NOT TRUE THEN
      -- Provider/order state may have changed after capture; keep the still-valid identity.
      v_note:=v_note||jsonb_build_object('verified_link_warning',v_link);
    END IF;
  END IF;
  v_acc.order_ids:=v_resolved;
  UPDATE public.live_selfservice_accesses
  SET whatsapp_confirmed_at=now(),confirmed_phone=v_digits,confirmed_phone_key=v_key,
    confirmed_number_id=NEW.whatsapp_number_id,confirm_message_id=NEW.id,order_ids=v_acc.order_ids,updated_at=now(),
    metadata=metadata||jsonb_build_object('confirmation_order_match',v_note)||CASE WHEN v_key IS DISTINCT FROM public.event_phone_key(entered_phone) THEN jsonb_build_object('entered_phone_original',entered_phone,'phone_changed_at',now()) ELSE '{}'::jsonb END
  WHERE id=v_acc.id;
  -- Comment-only orders have no phone until this confirmation; fill only the blank field.
  UPDATE public.customers c SET whatsapp=v_digits,updated_at=now()
  FROM public.orders o
  WHERE o.id=ANY(v_acc.order_ids) AND c.id=o.customer_id
    AND nullif(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'),'') IS NULL;
  IF v_key IS DISTINCT FROM public.event_phone_key(v_acc.entered_phone) AND coalesce(array_length(v_acc.order_ids,1),0)>0 THEN
    UPDATE public.customers c SET whatsapp=v_digits,updated_at=now() FROM public.orders o WHERE o.id=ANY(v_acc.order_ids) AND c.id=o.customer_id AND regexp_replace(coalesce(c.whatsapp,''),'\D','','g') IS DISTINCT FROM v_digits;
    UPDATE public.customer_registrations SET whatsapp=v_digits WHERE order_id=ANY(v_acc.order_ids) AND whatsapp IS DISTINCT FROM v_digits;
  END IF;
  IF v_key IS DISTINCT FROM public.event_phone_key(v_acc.entered_phone) THEN
    BEGIN
      UPDATE public.event_leads SET phone=v_digits,metadata=metadata||jsonb_build_object('self_service_entered_phone',v_acc.entered_phone) WHERE id=v_acc.lead_id AND phone IS DISTINCT FROM v_digits;
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.live_selfservice_accesses SET metadata=metadata||jsonb_build_object('lead_phone_sync_conflict',true) WHERE id=v_acc.id;
    END;
    BEGIN
      PERFORM public.selfservice_reconcile_confirmed_phone(v_acc.id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.live_selfservice_accesses SET metadata=metadata||jsonb_build_object('phone_reconcile_error',left(SQLERRM,200)) WHERE id=v_acc.id;
    END;
  END IF;
  SELECT value INTO v_secret FROM public.internal_function_secrets WHERE key='cron_secret';
  PERFORM net.http_post(url:='https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/live-selfservice',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',coalesce(v_secret,'')),body:=jsonb_build_object('action','confirmed','access_id',v_acc.id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING '[live_selfservice_match_incoming] %',SQLERRM; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.live_selfservice_match_incoming() FROM PUBLIC, anon, authenticated;