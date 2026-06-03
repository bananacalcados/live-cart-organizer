-- Lock down staff-only tables: remove permissive {public}/{anon} policies and
-- restrict access to authenticated users. Edge functions/crons use the
-- service_role key which bypasses RLS, so backend flows are unaffected.

DO $$
DECLARE
  t text;
  pol record;
  staff_tables text[] := ARRAY[
    'automation_dispatch_sent',
    'marketing_send_logs',
    'pos_cash_registers',
    'pos_sellers',
    'team_chat_messages',
    'team_gamification',
    'tiny_synced_orders',
    'ai_assistance_requests',
    'paypal_payments',
    'user_profiles',
    'pos_goals',
    'pos_gamification',
    'pos_invoice_config',
    'pos_payment_methods',
    'pos_product_pricing_rules',
    'pos_product_requests',
    'pos_returns',
    'pos_conditionals',
    'pos_store_sellers',
    'pos_store_whatsapp_numbers',
    'pos_seller_commission_tiers',
    'pos_seller_commissions',
    'pos_goal_progress',
    'pos_prizes',
    'pos_cash_movements',
    'inventory_correction_queue',
    'inventory_counts',
    'inventory_count_items',
    'inventory_unresolved_barcodes',
    'inventory_barcode_aliases',
    'tiny_management_sync_log',
    'tiny_sales_history',
    'zoppy_sync_log'
  ];
BEGIN
  FOREACH t IN ARRAY staff_tables LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      'Authenticated full access ' || t, t
    );

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
