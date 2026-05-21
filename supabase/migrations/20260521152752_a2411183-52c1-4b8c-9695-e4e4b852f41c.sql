-- 1) Adiciona coluna de vínculo
ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS customer_unified_id uuid REFERENCES public.customers_unified(id) ON DELETE SET NULL;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_unified_id uuid REFERENCES public.customers_unified(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sales_customer_unified ON public.pos_sales(customer_unified_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_unified ON public.orders(customer_unified_id);

-- 2) Função: resolve customer_unified_id a partir de telefone/CPF
CREATE OR REPLACE FUNCTION public.resolve_customer_unified(p_phone text, p_cpf text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_suf text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 8);
  v_cpf text := regexp_replace(coalesce(p_cpf,''), '\D', '', 'g');
  v_id uuid;
BEGIN
  IF v_cpf <> '' THEN
    SELECT id INTO v_id FROM public.customers_unified WHERE cpf = v_cpf LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF length(v_phone_suf) = 8 THEN
    SELECT id INTO v_id FROM public.customers_unified
      WHERE right(regexp_replace(coalesce(phone_e164,''), '\D', '', 'g'), 8) = v_phone_suf
      LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- 3) Recálculo de métricas (soma pos_sales pagos)
CREATE OR REPLACE FUNCTION public.recalc_customer_metrics(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders int := 0;
  v_spent numeric := 0;
  v_first timestamptz;
  v_last timestamptz;
BEGIN
  SELECT count(*), coalesce(sum(total),0), min(coalesce(paid_at, created_at)), max(coalesce(paid_at, created_at))
    INTO v_orders, v_spent, v_first, v_last
  FROM public.pos_sales
  WHERE customer_unified_id = p_customer_id
    AND status IN ('paid','completed','finalized','invoiced');

  UPDATE public.customers_unified
    SET total_orders = v_orders,
        total_spent = v_spent,
        avg_ticket = CASE WHEN v_orders > 0 THEN v_spent / v_orders ELSE 0 END,
        first_purchase_at = v_first,
        last_purchase_at = v_last,
        updated_at = now()
  WHERE id = p_customer_id;
END;
$$;

-- 4) Trigger: vincula pos_sale ao customers_unified e dispara recálculo
CREATE OR REPLACE FUNCTION public.trg_pos_sales_sync_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_old_uid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.customer_unified_id IS NOT NULL THEN
      PERFORM public.recalc_customer_metrics(OLD.customer_unified_id);
    END IF;
    RETURN OLD;
  END IF;

  -- Resolve vínculo se faltar
  IF NEW.customer_unified_id IS NULL AND (NEW.customer_phone IS NOT NULL) THEN
    v_uid := public.resolve_customer_unified(NEW.customer_phone, NULL);
    IF v_uid IS NOT NULL THEN
      NEW.customer_unified_id := v_uid;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_pos_sales_recalc_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_unified_id IS NOT NULL THEN
    PERFORM public.recalc_customer_metrics(NEW.customer_unified_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.customer_unified_id IS NOT NULL AND OLD.customer_unified_id IS DISTINCT FROM NEW.customer_unified_id THEN
    PERFORM public.recalc_customer_metrics(OLD.customer_unified_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_sales_sync_before ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_sync_before
BEFORE INSERT OR UPDATE OF customer_phone, customer_unified_id ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.trg_pos_sales_sync_customer();

DROP TRIGGER IF EXISTS trg_pos_sales_recalc_after ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_recalc_after
AFTER INSERT OR UPDATE OF status, total, customer_unified_id, paid_at OR DELETE ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.trg_pos_sales_recalc_after();