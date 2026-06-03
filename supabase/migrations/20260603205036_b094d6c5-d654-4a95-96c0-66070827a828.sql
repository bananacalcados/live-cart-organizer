DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY['pos_products','pos_product_sync_log','message_templates','expedition_stock_requests'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      'Authenticated full access ' || t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
