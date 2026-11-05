CREATE TABLE IF NOT EXISTS public.webhook_signature_state (
  provider text PRIMARY KEY,
  consecutive_valid integer NOT NULL DEFAULT 0,
  total_valid integer NOT NULL DEFAULT 0,
  total_invalid integer NOT NULL DEFAULT 0,
  enforced boolean NOT NULL DEFAULT false,
  enforced_at timestamptz,
  last_valid_at timestamptz,
  last_invalid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.webhook_signature_state TO authenticated;
GRANT ALL ON public.webhook_signature_state TO service_role;
ALTER TABLE public.webhook_signature_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON public.webhook_signature_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Registra o resultado da assinatura de um aviso real; após 20 válidas seguidas
-- liga a rejeição só daquele provedor. Devolve se a rejeição está ligada.
CREATE OR REPLACE FUNCTION public.record_webhook_signature(p_provider text, p_valid boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.webhook_signature_state;
BEGIN
  INSERT INTO public.webhook_signature_state(provider) VALUES (p_provider) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.webhook_signature_state WHERE provider = p_provider FOR UPDATE;
  IF p_valid THEN
    r.consecutive_valid := r.consecutive_valid + 1;
    UPDATE public.webhook_signature_state SET consecutive_valid = r.consecutive_valid, total_valid = total_valid + 1,
      last_valid_at = now(), updated_at = now() WHERE provider = p_provider;
    IF NOT r.enforced AND r.consecutive_valid >= 20 THEN
      UPDATE public.webhook_signature_state SET enforced = true, enforced_at = now() WHERE provider = p_provider;
      INSERT INTO public.security_events(event, details)
        VALUES ('signature_enforcement_enabled', jsonb_build_object('provider', p_provider, 'consecutive_valid', r.consecutive_valid));
      RETURN true;
    END IF;
  ELSE
    UPDATE public.webhook_signature_state SET consecutive_valid = 0, total_invalid = total_invalid + 1,
      last_invalid_at = now(), updated_at = now() WHERE provider = p_provider;
  END IF;
  RETURN r.enforced;
END $$;
REVOKE ALL ON FUNCTION public.record_webhook_signature(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_signature(text, boolean) TO service_role;

-- Checkout público: só diz se o próprio pedido usa cashback (sem abrir a tabela).
CREATE OR REPLACE FUNCTION public.get_checkout_order_has_cashback(p_order_id uuid, p_token text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (o.cashback_id IS NOT NULL OR COALESCE(o.cashback_amount, 0) > 0)
  FROM public.orders o
  WHERE o.id = p_order_id
    AND (o.checkout_token IS NULL OR o.checkout_token = p_token)
$$;
REVOKE ALL ON FUNCTION public.get_checkout_order_has_cashback(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_checkout_order_has_cashback(uuid, text) TO anon, authenticated, service_role;