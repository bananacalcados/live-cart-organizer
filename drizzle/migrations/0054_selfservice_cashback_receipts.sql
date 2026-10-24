ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS selfservice_cart_sent_at timestamptz, ADD COLUMN IF NOT EXISTS selfservice_cart_message_id text, ADD COLUMN IF NOT EXISTS selfservice_cashback_receipt jsonb;
ALTER TABLE public.internal_cashback ADD COLUMN IF NOT EXISTS source_order_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS internal_cashback_source_order_unique ON public.internal_cashback(source_order_id) WHERE source_order_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.selfservice_mark_cart_sent(p_order_ids uuid[], p_message_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_message_id IS NULL OR length(p_message_id)=0 OR cardinality(p_order_ids)>10 THEN RAISE EXCEPTION 'Envio não confirmado'; END IF;
 UPDATE public.orders o SET selfservice_cart_sent_at=clock_timestamp(),selfservice_cart_message_id=p_message_id
 WHERE o.id=ANY(p_order_ids) AND o.selfservice_cart_sent_at IS NULL AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=o.event_id AND e.operation_mode='whatsapp_autoatendimento');
END $$;
REVOKE ALL ON FUNCTION public.selfservice_mark_cart_sent(uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_mark_cart_sent(uuid[],text) TO service_role;
CREATE OR REPLACE FUNCTION public.selfservice_grant_cashback(p_order_id uuid,p_amount_paid numeric,p_paid_at timestamptz,p_gateway text,p_transaction_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.orders%ROWTYPE; cb public.internal_cashback%ROWTYPE; cfg public.pos_cashback_config%ROWTYPE; r integer; ph text; nm text; amount numeric;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=o.event_id AND e.operation_mode='whatsapp_autoatendimento') THEN RETURN jsonb_build_object('applicable',false); END IF;
 IF NOT(coalesce(o.is_paid,false) OR coalesce(o.paid_externally,false)) OR o.stage='cancelled' THEN RAISE EXCEPTION 'Pedido não pago'; END IF;
 SELECT * INTO cb FROM public.internal_cashback WHERE source_order_id=p_order_id;
 IF FOUND THEN RETURN to_jsonb(cb)||jsonb_build_object('applicable',true); END IF;
 IF p_amount_paid IS NULL OR p_amount_paid<=0 OR p_paid_at IS NULL OR p_paid_at>clock_timestamp()+interval '1 minute' OR p_gateway IS NULL OR p_transaction_id IS NULL THEN RAISE EXCEPTION 'Pagamento sem comprovação de valor e horário'; END IF;
 r := CASE WHEN o.selfservice_cart_sent_at IS NOT NULL AND p_paid_at>=o.selfservice_cart_sent_at AND p_paid_at<=o.selfservice_cart_sent_at+interval '20 minutes' THEN 10 ELSE 5 END;
 amount := round(p_amount_paid*r/100,2);
 SELECT whatsapp,full_name INTO ph,nm FROM public.customer_registrations WHERE order_id=p_order_id;
 IF ph IS NULL THEN SELECT whatsapp,instagram_handle INTO ph,nm FROM public.customers WHERE id=o.customer_id; END IF;
 IF length(regexp_replace(coalesce(ph,''),'\D','','g'))<10 THEN RAISE EXCEPTION 'Cliente sem telefone confirmado'; END IF;
 SELECT * INTO cfg FROM public.pos_cashback_config WHERE store_id IS NULL LIMIT 1;
 INSERT INTO public.internal_cashback(coupon_code,cashback_amount,min_purchase,customer_phone,customer_name,expires_at,origin_type,source_order_id)
 VALUES('CB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),amount,round(amount*coalesce(cfg.min_purchase_multiplier,1.5),2),ph,nm,clock_timestamp()+make_interval(days=>coalesce(cfg.validity_days,60)::integer),'selfservice_order',p_order_id) RETURNING * INTO cb;
 UPDATE public.orders SET selfservice_cashback_receipt=jsonb_build_object('rate',r,'amount_paid',p_amount_paid,'paid_at',p_paid_at,'gateway',p_gateway,'transaction_id',p_transaction_id,'cashback_id',cb.id,'cashback_amount',amount,'cart_sent_at',o.selfservice_cart_sent_at) WHERE id=p_order_id AND selfservice_cashback_receipt IS NULL;
 RETURN to_jsonb(cb)||jsonb_build_object('applicable',true);
END $$;
REVOKE ALL ON FUNCTION public.selfservice_grant_cashback(uuid,numeric,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_grant_cashback(uuid,numeric,timestamptz,text,text) TO service_role;
COMMENT ON COLUMN public.orders.selfservice_cashback_receipt IS 'Immutable credit evidence; never inferred from browser clock or customer phone history.';