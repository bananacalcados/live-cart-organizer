
-- 1. Add 6 columns to catalog_lead_registrations
ALTER TABLE catalog_lead_registrations
  ADD COLUMN IF NOT EXISTS chosen_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS pix_code TEXT,
  ADD COLUMN IF NOT EXISTS pix_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_disparo INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_ultimo_disparo_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_session_id TEXT;

-- 2. Add 3 recovery columns to lp_leads
ALTER TABLE lp_leads
  ADD COLUMN IF NOT EXISTS recovery_disparo INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_ultimo_disparo_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_session_id TEXT;

-- 3. RPC get_leads_for_recovery (UNION between both tables)
CREATE OR REPLACE FUNCTION get_leads_for_recovery()
RETURNS TABLE (
    id TEXT, source_table TEXT, phone TEXT, name TEXT,
    cart_items JSONB, cart_total DECIMAL,
    status TEXT, chosen_payment_method TEXT,
    pix_code TEXT, pix_expires_at TIMESTAMPTZ,
    recovery_disparo INTEGER, recovery_ultimo_disparo_at TIMESTAMPTZ,
    recovery_session_id TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id::TEXT, 'catalog' as source_table,
    whatsapp as phone, instagram_handle as name,
    cart_items, cart_total, status,
    chosen_payment_method, pix_code, pix_expires_at,
    recovery_disparo, recovery_ultimo_disparo_at,
    recovery_session_id, created_at
  FROM catalog_lead_registrations
  WHERE status IN ('browsing','checkout_started')
    AND whatsapp IS NOT NULL AND cart_items IS NOT NULL
  UNION ALL
  SELECT id::TEXT, 'lp_leads' as source_table,
    phone, name,
    (metadata->>'cartSummary')::jsonb as cart_items,
    (metadata->>'totalAmount')::decimal as cart_total,
    CASE WHEN metadata->>'chosen_payment_method' IS NOT NULL
         THEN 'checkout_started' ELSE 'browsing' END as status,
    metadata->>'chosen_payment_method',
    metadata->>'pix_code',
    (metadata->>'pix_expires_at')::timestamptz,
    recovery_disparo, recovery_ultimo_disparo_at,
    recovery_session_id, created_at
  FROM lp_leads
  WHERE source = 'abandoned_cart'
    AND phone IS NOT NULL
    AND converted = false
  ORDER BY created_at DESC LIMIT 500;
$$;

-- 4. RPC update_lead_recovery (routes to correct table)
CREATE OR REPLACE FUNCTION update_lead_recovery(
    p_lead_id TEXT, p_source_table TEXT,
    p_disparo INTEGER, p_session_id TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_source_table = 'catalog' THEN
    UPDATE catalog_lead_registrations
    SET recovery_disparo = p_disparo,
        recovery_ultimo_disparo_at = NOW(),
        recovery_session_id = p_session_id
    WHERE id::TEXT = p_lead_id;
  ELSE
    UPDATE lp_leads
    SET recovery_disparo = p_disparo,
        recovery_ultimo_disparo_at = NOW(),
        recovery_session_id = p_session_id
    WHERE id::TEXT = p_lead_id;
  END IF;
END; $$;

-- 5. RPC sync_lead_pix_data (sync PIX data from lp_leads to catalog_lead_registrations)
CREATE OR REPLACE FUNCTION sync_lead_pix_data(
    p_whatsapp TEXT, p_chosen_payment_method TEXT,
    p_pix_code TEXT, p_pix_expires_at TIMESTAMPTZ
) RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE catalog_lead_registrations
  SET chosen_payment_method = p_chosen_payment_method,
      pix_code = p_pix_code,
      pix_expires_at = p_pix_expires_at
  WHERE whatsapp = p_whatsapp
    AND status IN ('browsing','checkout_started')
    AND created_at > NOW() - INTERVAL '24 hours';
$$;
