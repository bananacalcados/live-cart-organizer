-- ============================================================
-- 1) ORDERS: remover leitura anônima em massa (anti-enumeração)
-- ============================================================
DROP POLICY IF EXISTS "Public read orders for checkout" ON public.orders;

DROP POLICY IF EXISTS "Public update checkout_started_at" ON public.orders;
REVOKE UPDATE ON public.orders FROM anon;
GRANT UPDATE (checkout_started_at, notes, eligible_for_prize, shipping_cost, free_shipping, cart_link) ON public.orders TO anon;

CREATE POLICY "Anon update checkout fields on unpaid orders"
ON public.orders
FOR UPDATE
TO anon
USING (COALESCE(is_paid, false) = false)
WITH CHECK (COALESCE(is_paid, false) = false);

-- ============================================================
-- 2) CUSTOMER_REGISTRATIONS: remover leitura anônima em massa
-- ============================================================
DROP POLICY IF EXISTS "Public select own customer_registrations" ON public.customer_registrations;

-- ============================================================
-- 3) RPCs SECURITY DEFINER para o checkout público
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_checkout_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(o.*) || jsonb_build_object(
    'customer',
    (SELECT jsonb_build_object('id', c.id, 'instagram_handle', c.instagram_handle, 'whatsapp', c.whatsapp)
       FROM customers c WHERE c.id = o.customer_id)
  )
  FROM orders o
  WHERE o.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.get_order_status(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'is_paid', o.is_paid,
    'stage', o.stage,
    'checkout_started_at', o.checkout_started_at
  )
  FROM orders o
  WHERE o.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.get_checkout_registration(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(r.*)
  FROM customer_registrations r
  WHERE r.order_id = p_order_id
  ORDER BY r.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_registration_by_cpf(p_cpf text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'full_name', r.full_name,
    'email', r.email,
    'whatsapp', r.whatsapp,
    'cep', r.cep,
    'address', r.address,
    'address_number', r.address_number,
    'complement', r.complement,
    'neighborhood', r.neighborhood,
    'city', r.city,
    'state', r.state
  )
  FROM customer_registrations r
  WHERE r.cpf = p_cpf
  ORDER BY r.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_checkout_order(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_order_status(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_checkout_registration(uuid) FROM public;
REVOKE ALL ON FUNCTION public.get_registration_by_cpf(text) FROM public;

GRANT EXECUTE ON FUNCTION public.get_checkout_order(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_status(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkout_registration(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_registration_by_cpf(text) TO anon, authenticated;