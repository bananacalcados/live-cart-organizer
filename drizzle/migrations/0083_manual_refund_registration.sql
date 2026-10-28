ALTER TABLE public.gateway_refunds ADD COLUMN IF NOT EXISTS manual_reference text, ADD COLUMN IF NOT EXISTS manual_done_at timestamptz, ADD COLUMN IF NOT EXISTS manual_registered_by uuid;
ALTER TABLE public.gateway_refunds DROP CONSTRAINT gateway_refunds_status_check;
ALTER TABLE public.gateway_refunds ADD CONSTRAINT gateway_refunds_status_check CHECK (status IN ('aguardando_aprovacao','recusado','processando','verificar','concluido','concluido_manual','falhou'));
CREATE OR REPLACE FUNCTION public.refund_manual_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.payment_id,0));
 IF NEW.status='concluido_manual' THEN
  IF NEW.manual_reference IS NULL OR length(btrim(NEW.manual_reference)) NOT BETWEEN 4 AND 80 OR NEW.manual_done_at IS NULL OR NEW.manual_done_at>now() OR NEW.manual_registered_by IS NULL THEN RAISE EXCEPTION 'Protocolo, data ou administrador inválido'; END IF;
  IF EXISTS(SELECT 1 FROM public.gateway_refunds g WHERE g.payment_id=NEW.payment_id AND g.id<>NEW.id AND g.status IN ('aguardando_aprovacao','processando','verificar','concluido','concluido_manual')) THEN RAISE EXCEPTION 'Existe estorno em andamento ou concluído para este pagamento'; END IF;
 ELSIF NEW.status IN ('aguardando_aprovacao','processando','verificar','concluido') AND EXISTS(SELECT 1 FROM public.gateway_refunds g WHERE g.payment_id=NEW.payment_id AND g.id<>NEW.id AND g.status='concluido_manual') THEN RAISE EXCEPTION 'Pagamento já registrado como estornado manualmente'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gateway_refunds_manual_insert_guard BEFORE INSERT ON public.gateway_refunds FOR EACH ROW EXECUTE FUNCTION public.refund_manual_guard();
CREATE TRIGGER gateway_refunds_manual_update_guard BEFORE UPDATE ON public.gateway_refunds FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.payment_id IS DISTINCT FROM NEW.payment_id) EXECUTE FUNCTION public.refund_manual_guard();
CREATE UNIQUE INDEX gateway_refunds_manual_payment_unique ON public.gateway_refunds(payment_id) WHERE status='concluido_manual';
CREATE OR REPLACE FUNCTION public.register_manual_refund(p_row jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_id uuid; v_pending public.gateway_refunds; v_payment text:=p_row->>'payment_id';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(v_payment,0));
 IF EXISTS(SELECT 1 FROM public.gateway_refunds WHERE payment_id=v_payment AND status IN ('processando','verificar','concluido','concluido_manual')) THEN RAISE EXCEPTION 'Existe estorno em andamento ou concluído para este pagamento'; END IF;
 SELECT * INTO v_pending FROM public.gateway_refunds WHERE payment_id=v_payment AND status='aguardando_aprovacao' FOR UPDATE;
 IF v_pending.id IS NOT NULL THEN
  IF v_pending.gateway<>p_row->>'gateway' OR (p_row->>'amount')::numeric>v_pending.amount THEN RAISE EXCEPTION 'Solicitação pendente não confere ou valor excede o solicitado'; END IF;
  UPDATE public.gateway_refunds SET status='concluido_manual',amount=(p_row->>'amount')::numeric,refund_type=p_row->>'refund_type',reason=p_row->>'reason',reason_text=p_row->>'reason_text',manual_reference=p_row->>'manual_reference',manual_done_at=(p_row->>'manual_done_at')::timestamptz,manual_registered_by=(p_row->>'manual_registered_by')::uuid,approved_by=(p_row->>'manual_registered_by')::uuid,approved_at=now(),completed_at=(p_row->>'manual_done_at')::timestamptz,error_message=NULL,updated_at=now() WHERE id=v_pending.id RETURNING id INTO v_id;
 ELSE
  INSERT INTO public.gateway_refunds(gateway,source,source_id,payment_id,mp_account_id,amount,refund_type,reason,reason_text,status,idempotency_key,card_brand,card_last4,installments,requested_by,approved_by,approved_at,completed_at,manual_reference,manual_done_at,manual_registered_by)
  VALUES(p_row->>'gateway',p_row->>'source',(p_row->>'source_id')::uuid,v_payment,(p_row->>'mp_account_id')::uuid,(p_row->>'amount')::numeric,p_row->>'refund_type',p_row->>'reason',p_row->>'reason_text','concluido_manual',gen_random_uuid()::text,p_row->>'card_brand',p_row->>'card_last4',(p_row->>'installments')::int,(p_row->>'manual_registered_by')::uuid,(p_row->>'manual_registered_by')::uuid,now(),(p_row->>'manual_done_at')::timestamptz,p_row->>'manual_reference',(p_row->>'manual_done_at')::timestamptz,(p_row->>'manual_registered_by')::uuid) RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.register_manual_refund(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_manual_refund(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.refund_manual_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refund_manual_guard() TO service_role;
REVOKE INSERT,UPDATE,DELETE ON public.gateway_refunds FROM authenticated,anon;