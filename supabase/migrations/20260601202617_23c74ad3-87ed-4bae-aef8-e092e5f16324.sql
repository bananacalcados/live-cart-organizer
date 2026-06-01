-- 1) Drop all existing policies on target tables
DO $$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pos_inter_store_requests','pos_exchanges','pos_seller_tasks','support_tickets',
    'whatsapp_messages','zoppy_customers','zoppy_sales','marketing_campaigns',
    'marketing_contact_lists','marketing_contacts','meta_message_queue',
    'lp_leads','pos_stores'
  ] LOOP
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- 2) Internal tables: authenticated full access only (no anon)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pos_inter_store_requests','pos_exchanges','pos_seller_tasks','support_tickets',
    'whatsapp_messages','zoppy_customers','zoppy_sales','marketing_campaigns',
    'marketing_contact_lists','marketing_contacts','meta_message_queue'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t||'_auth_all', t);
  END LOOP;
END $$;

-- 3) lp_leads: keep anon INSERT (public landing pages), restrict reads/edits to authenticated
ALTER TABLE public.lp_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lp_leads FROM anon;
GRANT INSERT ON public.lp_leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lp_leads TO authenticated;
GRANT ALL ON public.lp_leads TO service_role;
CREATE POLICY "lp_leads_anon_insert" ON public.lp_leads FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "lp_leads_auth_all" ON public.lp_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4) pos_stores: protect tiny_token from anon via column-level grants; anon may read only id + name
ALTER TABLE public.pos_stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_stores FROM anon;
GRANT SELECT (id, name) ON public.pos_stores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_stores TO authenticated;
GRANT ALL ON public.pos_stores TO service_role;
CREATE POLICY "pos_stores_anon_select" ON public.pos_stores FOR SELECT TO anon USING (true);
CREATE POLICY "pos_stores_auth_all" ON public.pos_stores FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5) RPC for public landing page lead counter (replaces direct public UPDATE on marketing_campaigns)
CREATE OR REPLACE FUNCTION public.increment_campaign_leads_captured(p_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.marketing_campaigns
  SET leads_captured = COALESCE(leads_captured, 0) + 1
  WHERE id = p_campaign_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_campaign_leads_captured(uuid) TO anon, authenticated;