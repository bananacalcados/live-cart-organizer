-- 1) Prefill: cadastro COMPLETO mais recente do cliente (por customer_id direto ou via pedidos)
CREATE OR REPLACE FUNCTION public.get_customer_checkout_prefill(p_customer_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r.*)
  FROM customer_registrations r
  LEFT JOIN orders o ON o.id = r.order_id
  WHERE p_customer_id IS NOT NULL
    AND (r.customer_id = p_customer_id OR o.customer_id = p_customer_id)
    AND coalesce(btrim(r.full_name), '') <> ''
    AND length(regexp_replace(coalesce(r.cpf, ''), '\D', '', 'g')) = 11
    AND coalesce(btrim(r.address), '') NOT IN ('', 'Pendente')
    AND coalesce(btrim(r.city), '') NOT IN ('', 'Pendente')
    AND coalesce(btrim(r.neighborhood), '') NOT IN ('', 'Pendente')
    AND regexp_replace(coalesce(r.cep, ''), '\D', '', 'g') NOT IN ('', '00000000')
  ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_checkout_prefill(uuid) TO anon, authenticated, service_role;

-- 2) Regra de frete do evento (exposta ao checkout público)
CREATE OR REPLACE FUNCTION public.get_event_checkout_shipping(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'default_shipping_cost', e.default_shipping_cost,
    'free_shipping_threshold', e.free_shipping_threshold
  )
  FROM events e
  WHERE e.id = p_event_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_checkout_shipping(uuid) TO anon, authenticated, service_role;

-- 3) Prefill por telefone — somente equipe logada (evita exposição de PII ao público)
CREATE OR REPLACE FUNCTION public.find_customer_prefill_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r.*)
  FROM customer_registrations r
  WHERE auth.uid() IS NOT NULL
    AND length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
    AND right(regexp_replace(coalesce(r.whatsapp, ''), '\D', '', 'g'), 8)
        = right(regexp_replace(p_phone, '\D', '', 'g'), 8)
    AND coalesce(btrim(r.full_name), '') <> ''
    AND length(regexp_replace(coalesce(r.cpf, ''), '\D', '', 'g')) = 11
    AND coalesce(btrim(r.address), '') NOT IN ('', 'Pendente')
    AND coalesce(btrim(r.city), '') NOT IN ('', 'Pendente')
    AND regexp_replace(coalesce(r.cep, ''), '\D', '', 'g') NOT IN ('', '00000000')
  ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_customer_prefill_by_phone(text) TO authenticated, service_role;