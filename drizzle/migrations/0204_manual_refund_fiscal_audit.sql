CREATE OR REPLACE FUNCTION public.register_manual_refund(p_row jsonb) RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_id uuid; v_pending public.gateway_refunds; v_payment text:=p_row->>'payment_id';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(v_payment,0));
 IF EXISTS(SELECT 1 FROM public.gateway_refunds WHERE payment_id=v_payment AND status IN ('processando','verificar','concluido','concluido_manual')) THEN RAISE EXCEPTION 'Existe estorno em andamento ou concluído para este pagamento'; END IF;
 SELECT * INTO v_pending FROM public.gateway_refunds WHERE payment_id=v_payment AND status='aguardando_aprovacao' FOR UPDATE;
 IF v_pending.id IS NOT NULL THEN
  IF v_pending.gateway<>p_row->>'gateway' OR (p_row->>'amount')::numeric>v_pending.amount THEN RAISE EXCEPTION 'Solicitação pendente não confere ou valor excede o solicitado'; END IF;
  UPDATE public.gateway_refunds SET status='concluido_manual',amount=(p_row->>'amount')::numeric,refund_type=p_row->>'refund_type',reason=p_row->>'reason',reason_text=p_row->>'reason_text',manual_reference=p_row->>'manual_reference',manual_done_at=(p_row->>'manual_done_at')::timestamptz,manual_registered_by=(p_row->>'manual_registered_by')::uuid,approved_by=(p_row->>'manual_registered_by')::uuid,approved_at=now(),completed_at=(p_row->>'manual_done_at')::timestamptz,error_message=NULL,updated_at=now(),fiscal_override_by=(p_row->>'fiscal_override_by')::uuid,fiscal_override_reason=p_row->>'fiscal_override_reason',fiscal_override_at=(p_row->>'fiscal_override_at')::timestamptz WHERE id=v_pending.id RETURNING id INTO v_id;
 ELSE
  INSERT INTO public.gateway_refunds(gateway,source,source_id,payment_id,mp_account_id,amount,refund_type,reason,reason_text,status,idempotency_key,card_brand,card_last4,installments,requested_by,approved_by,approved_at,completed_at,manual_reference,manual_done_at,manual_registered_by,fiscal_override_by,fiscal_override_reason,fiscal_override_at)
  VALUES(p_row->>'gateway',p_row->>'source',(p_row->>'source_id')::uuid,v_payment,(p_row->>'mp_account_id')::uuid,(p_row->>'amount')::numeric,p_row->>'refund_type',p_row->>'reason',p_row->>'reason_text','concluido_manual',gen_random_uuid()::text,p_row->>'card_brand',p_row->>'card_last4',(p_row->>'installments')::int,(p_row->>'manual_registered_by')::uuid,(p_row->>'manual_registered_by')::uuid,now(),(p_row->>'manual_done_at')::timestamptz,p_row->>'manual_reference',(p_row->>'manual_done_at')::timestamptz,(p_row->>'manual_registered_by')::uuid,(p_row->>'fiscal_override_by')::uuid,p_row->>'fiscal_override_reason',(p_row->>'fiscal_override_at')::timestamptz) RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.register_manual_refund(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_manual_refund(jsonb) TO service_role;
CREATE TRIGGER guard_refund_return_manual BEFORE UPDATE ON public.gateway_refunds FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='concluido_manual' AND OLD.status='aguardando_aprovacao') EXECUTE FUNCTION public.guard_refund_return_fiscal();