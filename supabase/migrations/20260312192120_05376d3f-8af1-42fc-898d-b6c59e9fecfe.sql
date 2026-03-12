
-- P0 FIX #1: Remove anon SELECT on customers
DROP POLICY IF EXISTS "Public read customers for checkout" ON public.customers;

-- Create security definer RPC for landing pages
CREATE OR REPLACE FUNCTION public.upsert_landing_customer(
  p_phone text,
  p_instagram text,
  p_tag text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_tags text[];
BEGIN
  SELECT id, tags INTO v_id, v_tags
  FROM customers
  WHERE whatsapp = p_phone
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    IF NOT (v_tags @> ARRAY[p_tag]) THEN
      UPDATE customers SET tags = array_append(COALESCE(tags, '{}'), p_tag)
      WHERE id = v_id;
    END IF;
  ELSE
    INSERT INTO customers (instagram_handle, whatsapp, tags)
    VALUES (p_instagram, p_phone, ARRAY[p_tag]);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_landing_customer(text, text, text) TO anon, authenticated;

-- P0 FIX #2: Fix public USING(true) policies
DROP POLICY IF EXISTS "Allow all access to chat_archived_conversations" ON public.chat_archived_conversations;
CREATE POLICY "Authenticated access chat_archived_conversations"
  ON public.chat_archived_conversations FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to chat_awaiting_payment" ON public.chat_awaiting_payment;
CREATE POLICY "Authenticated access chat_awaiting_payment"
  ON public.chat_awaiting_payment FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to chat_seller_assignments" ON public.chat_seller_assignments;
CREATE POLICY "Authenticated access chat_seller_assignments"
  ON public.chat_seller_assignments FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages dispatch sent" ON public.automation_dispatch_sent;
CREATE POLICY "Service role manages dispatch sent"
  ON public.automation_dispatch_sent FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can manage fixed cost items" ON public.cost_center_fixed_cost_items;
CREATE POLICY "Authenticated users can manage fixed cost items"
  ON public.cost_center_fixed_cost_items FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- P0 FIX #3: Restrict catalog_lead_registrations UPDATE
DROP POLICY IF EXISTS "Anyone can update registrations" ON public.catalog_lead_registrations;
CREATE POLICY "Authenticated can update registrations"
  ON public.catalog_lead_registrations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
