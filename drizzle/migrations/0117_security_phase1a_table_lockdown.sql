DO $lockdown$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['_perf_snap','live_code_parse_log','live_code_settings','live_order_intents','live_shown_products','product_code_category_map','product_code_letters','product_color_codes','products_master_category_backup_20261103','selfservice_instance_pacing'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%backup%' LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $lockdown$;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT SELECT ON public.live_code_parse_log, public.live_code_settings, public.live_order_intents, public.live_shown_products, public.product_code_category_map, public.product_code_letters, public.product_color_codes TO authenticated;
CREATE POLICY staff_read ON public.live_code_parse_log FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY staff_read ON public.live_code_settings FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY staff_read ON public.live_order_intents FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY staff_read ON public.live_shown_products FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY staff_read ON public.product_code_category_map FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY staff_read ON public.product_code_letters FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY staff_read ON public.product_color_codes FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
GRANT INSERT, UPDATE ON public.live_code_settings, public.live_shown_products TO authenticated;
CREATE POLICY event_staff_insert ON public.live_code_settings FOR INSERT TO authenticated WITH CHECK (public.has_module_access(auth.uid(),'events'));
CREATE POLICY event_staff_update ON public.live_code_settings FOR UPDATE TO authenticated USING (public.has_module_access(auth.uid(),'events')) WITH CHECK (public.has_module_access(auth.uid(),'events'));
CREATE POLICY event_staff_insert ON public.live_shown_products FOR INSERT TO authenticated WITH CHECK (public.has_module_access(auth.uid(),'events'));
CREATE POLICY event_staff_update ON public.live_shown_products FOR UPDATE TO authenticated USING (public.has_module_access(auth.uid(),'events')) WITH CHECK (public.has_module_access(auth.uid(),'events'));
GRANT UPDATE ON public.product_code_letters TO authenticated;
GRANT INSERT ON public.product_color_codes TO authenticated;
CREATE POLICY inventory_staff_update ON public.product_code_letters FOR UPDATE TO authenticated USING (public.has_module_access(auth.uid(),'inventory')) WITH CHECK (public.has_module_access(auth.uid(),'inventory'));
CREATE POLICY inventory_staff_insert ON public.product_color_codes FOR INSERT TO authenticated WITH CHECK (public.has_module_access(auth.uid(),'inventory'));
COMMENT ON TABLE public._perf_snap IS 'Service-only performance snapshots; no browser grants.';
COMMENT ON TABLE public.selfservice_instance_pacing IS 'Service-only queue pacing; no browser grants.';