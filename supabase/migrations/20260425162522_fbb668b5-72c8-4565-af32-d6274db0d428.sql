-- 1. Tabela
CREATE TABLE IF NOT EXISTS public.mercadopago_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  access_token TEXT NOT NULL,
  public_key TEXT,
  mp_user_id TEXT,
  app_number TEXT,
  webhook_secret TEXT,
  is_sandbox BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mp_account_active
  ON public.mercadopago_accounts (is_active)
  WHERE is_active = true;

ALTER TABLE public.mercadopago_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view MP accounts"
  ON public.mercadopago_accounts FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert MP accounts"
  ON public.mercadopago_accounts FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update MP accounts"
  ON public.mercadopago_accounts FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete MP accounts"
  ON public.mercadopago_accounts FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_mp_accounts_updated
  BEFORE UPDATE ON public.mercadopago_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Colunas
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS mp_account_id UUID REFERENCES public.mercadopago_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS mp_account_id UUID REFERENCES public.mercadopago_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_mp_account ON public.orders(mp_account_id) WHERE mp_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_sales_mp_account ON public.pos_sales(mp_account_id) WHERE mp_account_id IS NOT NULL;

-- 3. get_active_mp_account
CREATE OR REPLACE FUNCTION public.get_active_mp_account()
RETURNS TABLE (
  id UUID,
  name TEXT,
  access_token TEXT,
  public_key TEXT,
  mp_user_id TEXT,
  is_sandbox BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.name, a.access_token, a.public_key, a.mp_user_id, a.is_sandbox
  FROM public.mercadopago_accounts a
  WHERE a.is_active = true
  LIMIT 1;
$$;

-- 4. set_active_mp_account
CREATE OR REPLACE FUNCTION public.set_active_mp_account(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change the active Mercado Pago account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mercadopago_accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Mercado Pago account not found';
  END IF;
  UPDATE public.mercadopago_accounts SET is_active = false WHERE is_active = true;
  UPDATE public.mercadopago_accounts SET is_active = true WHERE id = p_account_id;
  RETURN true;
END;
$$;

-- 5. get_mp_token_for_order
CREATE OR REPLACE FUNCTION public.get_mp_token_for_order(p_order_id UUID)
RETURNS TABLE (
  account_id UUID,
  access_token TEXT,
  is_sandbox BOOLEAN,
  account_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 
    COALESCE(a.id, act.id),
    COALESCE(a.access_token, act.access_token),
    COALESCE(a.is_sandbox, act.is_sandbox, false),
    COALESCE(a.name, act.name)
  FROM (SELECT 1) dummy
  LEFT JOIN public.orders o ON o.id = p_order_id
  LEFT JOIN public.mercadopago_accounts a ON a.id = o.mp_account_id
  LEFT JOIN public.mercadopago_accounts act ON act.is_active = true
  LIMIT 1;
$$;

-- 6. get_mp_token_for_sale
CREATE OR REPLACE FUNCTION public.get_mp_token_for_sale(p_sale_id UUID)
RETURNS TABLE (
  account_id UUID,
  access_token TEXT,
  is_sandbox BOOLEAN,
  account_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 
    COALESCE(a.id, act.id),
    COALESCE(a.access_token, act.access_token),
    COALESCE(a.is_sandbox, act.is_sandbox, false),
    COALESCE(a.name, act.name)
  FROM (SELECT 1) dummy
  LEFT JOIN public.pos_sales s ON s.id = p_sale_id
  LEFT JOIN public.mercadopago_accounts a ON a.id = s.mp_account_id
  LEFT JOIN public.mercadopago_accounts act ON act.is_active = true
  LIMIT 1;
$$;

-- 7. get_mp_token_by_payment_id (CTE para evitar erro de UNION+LIMIT)
CREATE OR REPLACE FUNCTION public.get_mp_token_by_payment_id(p_payment_id TEXT)
RETURNS TABLE (
  account_id UUID,
  access_token TEXT,
  is_sandbox BOOLEAN,
  account_name TEXT,
  source_type TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH from_order AS (
    SELECT a.id, a.access_token, a.is_sandbox, a.name, 'order'::text AS src, 1 AS prio
    FROM public.orders o
    JOIN public.mercadopago_accounts a ON a.id = o.mp_account_id
    WHERE o.mercadopago_payment_id = p_payment_id
    LIMIT 1
  ),
  from_sale AS (
    SELECT a.id, a.access_token, a.is_sandbox, a.name, 'sale'::text AS src, 2 AS prio
    FROM public.pos_sales s
    JOIN public.mercadopago_accounts a ON a.id = s.mp_account_id
    WHERE s.mercadopago_payment_id = p_payment_id
    LIMIT 1
  ),
  from_active AS (
    SELECT a.id, a.access_token, a.is_sandbox, a.name, 'active_fallback'::text AS src, 3 AS prio
    FROM public.mercadopago_accounts a
    WHERE a.is_active = true
    LIMIT 1
  ),
  combined AS (
    SELECT * FROM from_order
    UNION ALL SELECT * FROM from_sale
    UNION ALL SELECT * FROM from_active
  )
  SELECT id, access_token, is_sandbox, name, src
  FROM combined
  ORDER BY prio
  LIMIT 1;
$$;