
-- 1. Add new columns to zoppy_customers for POS enrichment + lead_status
ALTER TABLE public.zoppy_customers
  ADD COLUMN IF NOT EXISTS lead_status TEXT DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS store_id UUID,
  ADD COLUMN IF NOT EXISTS shoe_size TEXT,
  ADD COLUMN IF NOT EXISTS preferred_style TEXT,
  ADD COLUMN IF NOT EXISTS age_range TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS cashback_balance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashback_expires_at TIMESTAMPTZ;

-- 2. Create RPC for opportunity agent
CREATE OR REPLACE FUNCTION public.get_customers_for_opportunities(
    p_limit INTEGER DEFAULT 1000,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id TEXT,
    name TEXT,
    whatsapp TEXT,
    email TEXT,
    cpf TEXT,
    store_id TEXT,
    lead_status TEXT,
    total_orders INTEGER,
    total_spent DECIMAL,
    avg_ticket DECIMAL,
    first_purchase_at TIMESTAMPTZ,
    last_purchase_at TIMESTAMPTZ,
    cashback_balance DECIMAL,
    cashback_expires_at TIMESTAMPTZ,
    shoe_size TEXT,
    preferred_style TEXT,
    age_range TEXT,
    source TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT
        zc.id::TEXT,
        TRIM(COALESCE(zc.first_name, '') || ' ' || COALESCE(zc.last_name, '')) as name,
        zc.phone as whatsapp,
        zc.email,
        zc.cpf,
        zc.store_id::TEXT,
        COALESCE(zc.lead_status, 'customer') as lead_status,
        COALESCE(zc.total_orders, 0)::INTEGER as total_orders,
        COALESCE(zc.total_spent, 0)::DECIMAL as total_spent,
        COALESCE(zc.avg_ticket, 0)::DECIMAL as avg_ticket,
        zc.first_purchase_at::TIMESTAMPTZ,
        zc.last_purchase_at::TIMESTAMPTZ,
        COALESCE(zc.cashback_balance, 0)::DECIMAL as cashback_balance,
        zc.cashback_expires_at,
        zc.shoe_size,
        zc.preferred_style,
        zc.age_range,
        zc.source,
        zc.created_at::TIMESTAMPTZ
    FROM zoppy_customers zc
    WHERE zc.phone IS NOT NULL OR zc.email IS NOT NULL OR zc.cpf IS NOT NULL
    ORDER BY zc.last_purchase_at DESC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
$$;
