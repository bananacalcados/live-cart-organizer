ALTER TABLE public.gateway_refunds
  ADD COLUMN IF NOT EXISTS receipt_auto_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS receipt_auto_error text,
  ADD COLUMN IF NOT EXISTS receipt_send_claimed_at timestamptz;
ALTER TABLE public.gateway_refunds DROP CONSTRAINT IF EXISTS gateway_refunds_receipt_auto_status_check;
ALTER TABLE public.gateway_refunds ADD CONSTRAINT gateway_refunds_receipt_auto_status_check
  CHECK (receipt_auto_status IN ('legacy','pending','sending','sent','failed'));
COMMENT ON COLUMN public.gateway_refunds.receipt_auto_status IS 'legacy protege comprovantes anteriores à automação; pending só nasce por trigger após estorno concluído com PDF.';
CREATE INDEX IF NOT EXISTS gateway_refunds_receipt_auto_pending ON public.gateway_refunds(completed_at,id)
  WHERE receipt_auto_status='pending' AND receipt_sent_at IS NULL;

CREATE OR REPLACE FUNCTION public.refund_receipt_mark_auto()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status='concluido' AND NEW.receipt_path IS NOT NULL AND NEW.receipt_code IS NOT NULL
     AND NEW.receipt_sent_at IS NULL AND NEW.receipt_auto_status='legacy' THEN
    NEW.receipt_auto_status:='pending';
  END IF;
  IF NEW.receipt_sent_at IS NOT NULL THEN
    NEW.receipt_auto_status:='sent';
    NEW.receipt_auto_error:=NULL;
    NEW.receipt_send_claimed_at:=NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gateway_refunds_receipt_auto ON public.gateway_refunds;
CREATE TRIGGER gateway_refunds_receipt_auto
BEFORE INSERT OR UPDATE OF status,receipt_path,receipt_code,receipt_sent_at ON public.gateway_refunds
FOR EACH ROW EXECUTE FUNCTION public.refund_receipt_mark_auto();

CREATE OR REPLACE FUNCTION public.refund_receipt_claim(p_id uuid,p_automatic boolean,p_allow_resend boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.gateway_refunds%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO r FROM public.gateway_refunds WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('concluido','concluido_manual') OR r.receipt_path IS NULL OR r.receipt_code IS NULL THEN RETURN false; END IF;
  IF r.receipt_sent_at IS NOT NULL AND NOT p_allow_resend THEN RETURN false; END IF;
  IF r.receipt_send_claimed_at>now()-interval '10 minutes' THEN RETURN false; END IF;
  IF p_automatic AND r.receipt_auto_status<>'pending' THEN RETURN false; END IF;
  UPDATE public.gateway_refunds SET receipt_send_claimed_at=now(),
    receipt_auto_status=CASE WHEN p_automatic THEN 'sending' ELSE receipt_auto_status END,
    receipt_auto_error=CASE WHEN p_automatic THEN NULL ELSE receipt_auto_error END,
    updated_at=now()
  WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.refund_receipt_claim(uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refund_receipt_claim(uuid,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_receipt_send_failed(p_id uuid,p_automatic boolean,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.gateway_refunds SET receipt_send_claimed_at=NULL,
    receipt_auto_status=CASE WHEN p_automatic AND receipt_sent_at IS NULL THEN 'failed' ELSE receipt_auto_status END,
    receipt_auto_error=CASE WHEN p_automatic AND receipt_sent_at IS NULL THEN left(coalesce(p_error,'Falha no envio'),500) ELSE receipt_auto_error END,
    updated_at=now()
  WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.refund_receipt_send_failed(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refund_receipt_send_failed(uuid,boolean,text) TO service_role;