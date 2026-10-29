CREATE OR REPLACE FUNCTION public.selfservice_br_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN d ~ '^55\d{10}$' THEN left(d,4)||'9'||substring(d from 5) ELSE d END
  FROM (SELECT CASE WHEN x ~ '^\d{10,11}$' THEN '55'||x ELSE x END d FROM (SELECT regexp_replace(coalesce(p,''),'\D','','g') x) s) t
$$;

-- The number that sent the order's #CODE becomes the ficha's principal phone;
-- the typed number is kept in previous_phones. Another ficha that owns the
-- confirmed number is merged only when name + CPF/e-mail/address agree and
-- nothing (orders/cashback) would be lost; otherwise a conflict is annotated.
CREATE OR REPLACE FUNCTION public.selfservice_reconcile_confirmed_phone(p_access_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_acc public.live_selfservice_accesses%ROWTYPE; v_e text; v_c text; a public.customers_unified%ROWTYPE; b public.customers_unified%ROWTYPE; v_n int; v_hits int:=0; v_cpf text;
BEGIN
  SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE id=p_access_id;
  IF v_acc.id IS NULL OR v_acc.confirmed_phone IS NULL THEN RETURN 'skip'; END IF;
  v_e:=public.selfservice_br_phone(coalesce(v_acc.metadata->>'entered_phone_original',v_acc.entered_phone));
  v_c:=public.selfservice_br_phone(v_acc.confirmed_phone);
  IF v_e='' OR v_c='' OR v_e=v_c THEN RETURN 'same'; END IF;
  SELECT count(*) INTO v_n FROM public.customers_unified WHERE phone_e164=v_e AND merged_into_id IS NULL AND coalesce(is_archived,false)=false;
  IF v_n<>1 THEN RETURN 'no_entered'; END IF;
  SELECT * INTO a FROM public.customers_unified WHERE phone_e164=v_e AND merged_into_id IS NULL AND coalesce(is_archived,false)=false FOR UPDATE;
  SELECT count(*) INTO v_n FROM public.customers_unified WHERE phone_e164=v_c AND merged_into_id IS NULL AND coalesce(is_archived,false)=false AND id<>a.id;
  IF v_n=0 THEN
    UPDATE public.customers_unified SET phone_e164=v_c,ddd=substring(v_c from 3 for 2),
      previous_phones=CASE WHEN v_e=ANY(coalesce(previous_phones,'{}')) THEN previous_phones ELSE array_append(coalesce(previous_phones,'{}'),v_e) END
    WHERE id=a.id;
    RETURN 'promoted';
  END IF;
  IF v_n>1 THEN RETURN 'ambiguous'; END IF;
  SELECT * INTO b FROM public.customers_unified WHERE phone_e164=v_c AND merged_into_id IS NULL AND coalesce(is_archived,false)=false AND id<>a.id FOR UPDATE;
  IF nullif(a.cpf,'') IS NOT NULL AND nullif(b.cpf,'') IS NOT NULL AND a.cpf<>b.cpf THEN v_hits:=-99; END IF;
  IF nullif(a.cpf,'') IS NOT NULL AND a.cpf=b.cpf THEN v_hits:=v_hits+1; END IF;
  IF nullif(lower(a.email),'') IS NOT NULL AND lower(a.email)=lower(b.email) THEN v_hits:=v_hits+1; END IF;
  IF nullif(regexp_replace(coalesce(a.cep,''),'\D','','g'),'') IS NOT NULL AND regexp_replace(a.cep,'\D','','g')=regexp_replace(coalesce(b.cep,''),'\D','','g')
     AND public.bc_norm_txt(btrim(coalesce(a.address_number,'')))=public.bc_norm_txt(btrim(coalesce(b.address_number,''))) THEN v_hits:=v_hits+1; END IF;
  IF public.bc_norm_txt(btrim(regexp_replace(coalesce(a.name,''),'\s+',' ','g'))) IS DISTINCT FROM public.bc_norm_txt(btrim(regexp_replace(coalesce(b.name,''),'\s+',' ','g')))
     OR btrim(coalesce(a.name,''))='' OR v_hits<1
     OR coalesce(a.total_orders,0)>0 OR coalesce(a.cashback_balance,0)>0 OR coalesce(a.legacy_orders,0)>0 THEN
    UPDATE public.live_selfservice_accesses SET metadata=metadata||jsonb_build_object('phone_identity_conflict',jsonb_build_object('entered_customer_id',a.id,'confirmed_customer_id',b.id,'at',now())) WHERE id=v_acc.id;
    RETURN 'conflict';
  END IF;
  -- Same person: keep the ficha that owns the confirmed number (history/cashback), fill gaps from the new registration.
  v_cpf:=nullif(a.cpf,'');
  UPDATE public.customers_unified SET cpf=NULL,merged_into_id=b.id,is_archived=true,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('merged_by','selfservice_confirmed_phone','merged_at',now()) WHERE id=a.id;
  UPDATE public.customers_unified SET
    cpf=coalesce(nullif(cpf,''),v_cpf), email=coalesce(nullif(email,''),a.email),
    cep=coalesce(nullif(cep,''),a.cep), address=coalesce(nullif(address,''),a.address), address_number=coalesce(nullif(address_number,''),a.address_number),
    complement=coalesce(nullif(complement,''),a.complement), neighborhood=coalesce(nullif(neighborhood,''),a.neighborhood),
    city=coalesce(nullif(city,''),a.city), state=coalesce(nullif(state,''),a.state),
    instagram_handle=coalesce(nullif(instagram_handle,''),a.instagram_handle),
    previous_phones=(SELECT array_agg(DISTINCT p) FROM unnest(coalesce(previous_phones,'{}')||coalesce(a.previous_phones,'{}')||ARRAY[v_e]) p WHERE p IS NOT NULL AND p<>v_c)
  WHERE id=b.id;
  RETURN 'merged';
END $$;
REVOKE ALL ON FUNCTION public.selfservice_reconcile_confirmed_phone(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_reconcile_confirmed_phone(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.live_selfservice_match_incoming()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_code text:=substring(coalesce(NEW.message,'') from '#([A-Z0-9]{5})\M'); v_acc public.live_selfservice_accesses%ROWTYPE; v_digits text:=regexp_replace(coalesce(NEW.phone,''),'\D','','g'); v_key text; v_secret text; v_match uuid[]; v_link jsonb;
BEGIN
  IF v_code IS NULL OR length(v_digits)<10 THEN RETURN NEW; END IF;
  v_key:=public.event_phone_key(NEW.phone);
  SELECT * INTO v_acc FROM public.live_selfservice_accesses WHERE confirm_code=v_code AND whatsapp_confirmed_at IS NULL FOR UPDATE;
  IF v_acc.id IS NULL THEN RETURN NEW; END IF;
  IF v_acc.metadata->>'initial_order_match'='true' THEN
    v_match:=public.selfservice_match_initial_order(v_acc.event_id,v_digits);
    IF v_key IS NOT DISTINCT FROM public.event_phone_key(v_acc.entered_phone) AND coalesce(array_length(v_match,1),0)=1 AND v_match=v_acc.order_ids THEN
      v_link:=public.live_link_order_verified(v_acc.event_id,v_digits);
      IF coalesce((v_link->>'ok')::boolean,false) IS NOT TRUE THEN v_acc.order_ids:='{}'; END IF;
    ELSE v_acc.order_ids:='{}'; END IF;
  END IF;
  UPDATE public.live_selfservice_accesses SET whatsapp_confirmed_at=now(),confirmed_phone=v_digits,confirmed_phone_key=v_key,confirmed_number_id=NEW.whatsapp_number_id,confirm_message_id=NEW.id,order_ids=v_acc.order_ids,updated_at=now(),metadata=metadata||CASE WHEN v_key IS DISTINCT FROM public.event_phone_key(entered_phone) THEN jsonb_build_object('entered_phone_original',entered_phone,'phone_changed_at',now()) ELSE '{}'::jsonb END WHERE id=v_acc.id;
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
    -- Ficha reconciliation never blocks the confirmation or the cart link.
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