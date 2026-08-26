ALTER TABLE public.chargebacks
  ADD COLUMN IF NOT EXISTS pos_sale_id uuid,
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS customer_unified_id uuid,
  ADD COLUMN IF NOT EXISTS phone_key text,
  ADD COLUMN IF NOT EXISTS cpf_digits text,
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by uuid;

CREATE OR REPLACE FUNCTION public.chargebacks_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.phone_key := NULLIF(public.automation_phone_key(NEW.customer_phone), '');
  NEW.cpf_digits := NULLIF(regexp_replace(COALESCE(NEW.customer_cpf,''), '\D', '', 'g'), '');
  NEW.address_key := public.normalize_address_key(NEW.address_cep, NEW.address_number);
  IF NEW.blocked AND NEW.blocked_at IS NULL THEN
    NEW.blocked_at := now();
  END IF;
  IF NOT NEW.blocked THEN
    NEW.blocked_at := NULL;
    NEW.blocked_by := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chargebacks_normalize ON public.chargebacks;
CREATE TRIGGER trg_chargebacks_normalize
BEFORE INSERT OR UPDATE ON public.chargebacks
FOR EACH ROW EXECUTE FUNCTION public.chargebacks_normalize();

UPDATE public.chargebacks SET updated_at = updated_at;

CREATE INDEX IF NOT EXISTS idx_chargebacks_phone_key ON public.chargebacks(phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargebacks_cpf_digits ON public.chargebacks(cpf_digits) WHERE cpf_digits IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargebacks_unified ON public.chargebacks(customer_unified_id) WHERE customer_unified_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargebacks_pos_sale ON public.chargebacks(pos_sale_id) WHERE pos_sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chargebacks_order ON public.chargebacks(order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_chargeback_risk(
  p_customer_name text,
  p_customer_email text DEFAULT NULL::text,
  p_customer_phone text DEFAULT NULL::text,
  p_customer_cpf text DEFAULT NULL::text,
  p_address_cep text DEFAULT NULL::text,
  p_address_number text DEFAULT NULL::text,
  p_customer_unified_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone_key text := NULLIF(public.automation_phone_key(p_customer_phone), '');
  v_cpf_norm text := NULLIF(regexp_replace(COALESCE(p_customer_cpf,''), '\D', '', 'g'), '');
  v_email_norm text := NULLIF(lower(trim(COALESCE(p_customer_email,''))), '');
  v_addr_key text := public.normalize_address_key(p_address_cep, p_address_number);
  v_name_norm text := lower(trim(COALESCE(p_customer_name,'')));
  v_direct jsonb;
  v_address jsonb;
  v_blocked boolean := false;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_direct
  FROM (
    SELECT id, customer_name, source, source_order_name, pos_sale_id, order_id,
           amount, chargeback_date, status, reason, blocked
    FROM public.chargebacks
    WHERE
      (v_cpf_norm IS NOT NULL AND cpf_digits = v_cpf_norm)
      OR (v_phone_key IS NOT NULL AND phone_key = v_phone_key)
      OR (p_customer_unified_id IS NOT NULL AND customer_unified_id = p_customer_unified_id)
      OR (v_email_norm IS NOT NULL AND lower(customer_email) = v_email_norm)
    ORDER BY created_at DESC
    LIMIT 10
  ) t;

  IF v_addr_key IS NOT NULL AND length(v_addr_key) > 1 AND v_addr_key <> '|' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_address
    FROM (
      SELECT id, customer_name, source_order_name, amount, chargeback_date, status, reason, blocked,
             address_street, address_number, address_cep
      FROM public.chargebacks
      WHERE address_key = v_addr_key
        AND lower(trim(customer_name)) <> v_name_norm
      ORDER BY created_at DESC
      LIMIT 10
    ) t;
  ELSE
    v_address := '[]'::jsonb;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.chargebacks
    WHERE blocked
      AND (
        (v_cpf_norm IS NOT NULL AND cpf_digits = v_cpf_norm)
        OR (v_phone_key IS NOT NULL AND phone_key = v_phone_key)
        OR (p_customer_unified_id IS NOT NULL AND customer_unified_id = p_customer_unified_id)
        OR (v_email_norm IS NOT NULL AND lower(customer_email) = v_email_norm)
      )
  ) INTO v_blocked;

  RETURN jsonb_build_object(
    'direct_match', v_direct,
    'address_match', v_address,
    'has_risk', (jsonb_array_length(v_direct) > 0 OR jsonb_array_length(v_address) > 0),
    'blocked', v_blocked,
    'risk_level', CASE
      WHEN v_blocked THEN 'blocked'
      WHEN jsonb_array_length(v_direct) > 0 THEN 'high'
      WHEN jsonb_array_length(v_address) > 0 THEN 'medium'
      ELSE 'none' END
  );
END;
$$;