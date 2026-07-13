-- Colunas para rastrear canal e referência externa de resgate do cashback
ALTER TABLE public.internal_cashback
  ADD COLUMN IF NOT EXISTS used_channel text,
  ADD COLUMN IF NOT EXISTS used_external_ref text;

-- RPC atômica de resgate: só resgata se ainda válido e não usado.
-- Evita double-spend entre loja física e site (single source of truth).
CREATE OR REPLACE FUNCTION public.redeem_internal_cashback(
  _coupon_code text,
  _channel text DEFAULT 'site',
  _external_ref text DEFAULT NULL,
  _subtotal numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.internal_cashback%ROWTYPE;
BEGIN
  -- Trava a linha para leitura consistente
  SELECT * INTO v_row
  FROM public.internal_cashback
  WHERE upper(coupon_code) = upper(_coupon_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cupom não encontrado');
  END IF;

  IF v_row.is_used THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cashback já utilizado');
  END IF;

  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cashback expirado');
  END IF;

  IF _subtotal IS NOT NULL AND _subtotal < COALESCE(v_row.min_purchase, 0) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Compra mínima de R$ ' || to_char(v_row.min_purchase, 'FM999999990.00') || ' para este cashback'
    );
  END IF;

  UPDATE public.internal_cashback
  SET is_used = true,
      used_at = now(),
      used_channel = COALESCE(_channel, 'site'),
      used_external_ref = _external_ref
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'success', true,
    'coupon_code', v_row.coupon_code,
    'discount', v_row.cashback_amount,
    'min_purchase', v_row.min_purchase
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_internal_cashback(text, text, text, numeric) TO service_role;