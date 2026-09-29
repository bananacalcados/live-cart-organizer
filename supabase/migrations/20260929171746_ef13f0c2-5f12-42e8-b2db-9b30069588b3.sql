CREATE OR REPLACE FUNCTION public.internal_cashback_prevent_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s text := right(regexp_replace(coalesce(NEW.customer_phone,''),'\D','','g'),8);
BEGIN
  IF length(s) < 8 OR NEW.origin_type NOT IN ('pos_sale','live_order') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cashback:'||s));
  IF EXISTS (SELECT 1 FROM internal_cashback
             WHERE right(regexp_replace(coalesce(customer_phone,''),'\D','','g'),8) = s
               AND is_used = false AND origin_type IN ('pos_sale','live_order')
               AND created_at > now() - interval '30 minutes') THEN
    RETURN NULL; -- mesma compra já gerou cashback (Live + PDV ao mesmo tempo)
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_internal_cashback_prevent_duplicate ON public.internal_cashback;
CREATE TRIGGER trg_internal_cashback_prevent_duplicate BEFORE INSERT ON public.internal_cashback
FOR EACH ROW EXECUTE FUNCTION public.internal_cashback_prevent_duplicate();

-- Limpeza: remove a cópia duplicada (mantém o cupom enviado na mensagem da Live, salvo se o outro estiver reservado)
WITH p AS (SELECT id, right(regexp_replace(customer_phone,'\D','','g'),8) s, created_at, origin_type, is_used FROM internal_cashback),
pairs AS (
  SELECT a.id pos_id, b.id live_id FROM p a JOIN p b ON a.s=b.s AND a.origin_type='pos_sale' AND b.origin_type='live_order'
   AND abs(extract(epoch FROM a.created_at-b.created_at))<600 AND NOT a.is_used AND NOT b.is_used
)
DELETE FROM internal_cashback WHERE id IN (
  SELECT CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.cashback_id = pos_id) THEN live_id ELSE pos_id END FROM pairs
);