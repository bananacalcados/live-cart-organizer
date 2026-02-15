
-- Security fix: Replace public "Allow all" policies with authenticated-only
-- Only referencing tables that actually exist

-- Critical PII tables
DROP POLICY IF EXISTS "Allow all access to customers" ON public.customers;
CREATE POLICY "Auth access customers" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_orders" ON public.expedition_orders;
CREATE POLICY "Auth access expedition_orders" ON public.expedition_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to pos_products" ON public.pos_products;
CREATE POLICY "Auth access pos_products" ON public.pos_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- All other tables with "Allow all" public policies
DROP POLICY IF EXISTS "Allow all access to app_settings" ON public.app_settings;
CREATE POLICY "Auth access app_settings" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.automation_ai_sessions;
CREATE POLICY "Auth access automation_ai_sessions" ON public.automation_ai_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on automation_executions" ON public.automation_executions;
CREATE POLICY "Auth access automation_executions" ON public.automation_executions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on automation_flows" ON public.automation_flows;
CREATE POLICY "Auth access automation_flows" ON public.automation_flows FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on automation_steps" ON public.automation_steps;
CREATE POLICY "Auth access automation_steps" ON public.automation_steps FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to bank_accounts" ON public.bank_accounts;
CREATE POLICY "Auth access bank_accounts" ON public.bank_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on campaign_channels" ON public.campaign_channels;
CREATE POLICY "Auth access campaign_channels" ON public.campaign_channels FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on campaign_landing_pages" ON public.campaign_landing_pages;
CREATE POLICY "Auth access campaign_landing_pages" ON public.campaign_landing_pages FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on campaign_leads" ON public.campaign_leads;
CREATE POLICY "Auth access campaign_leads" ON public.campaign_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on campaign_tasks" ON public.campaign_tasks;
CREATE POLICY "Auth access campaign_tasks" ON public.campaign_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to chat_contacts" ON public.chat_contacts;
CREATE POLICY "Auth access chat_contacts" ON public.chat_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to chat_finished_conversations" ON public.chat_finished_conversations;
CREATE POLICY "Auth access chat_finished_conversations" ON public.chat_finished_conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to event_promotions" ON public.event_promotions;
CREATE POLICY "Auth access event_promotions" ON public.event_promotions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to events" ON public.events;
CREATE POLICY "Auth access events" ON public.events FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_dispatch_manifest_items" ON public.expedition_dispatch_manifest_items;
CREATE POLICY "Auth access expedition_dispatch_manifest_items" ON public.expedition_dispatch_manifest_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_dispatch_manifests" ON public.expedition_dispatch_manifests;
CREATE POLICY "Auth access expedition_dispatch_manifests" ON public.expedition_dispatch_manifests FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_freight_quotes" ON public.expedition_freight_quotes;
CREATE POLICY "Auth access expedition_freight_quotes" ON public.expedition_freight_quotes FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_groups" ON public.expedition_groups;
CREATE POLICY "Auth access expedition_groups" ON public.expedition_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_order_items" ON public.expedition_order_items;
CREATE POLICY "Auth access expedition_order_items" ON public.expedition_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_picking_lists" ON public.expedition_picking_lists;
CREATE POLICY "Auth access expedition_picking_lists" ON public.expedition_picking_lists FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_returns" ON public.expedition_returns;
CREATE POLICY "Auth access expedition_returns" ON public.expedition_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to expedition_sync_log" ON public.expedition_sync_log;
CREATE POLICY "Auth access expedition_sync_log" ON public.expedition_sync_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to internal_cashback" ON public.internal_cashback;
CREATE POLICY "Auth access internal_cashback" ON public.internal_cashback FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to inventory_barcode_aliases" ON public.inventory_barcode_aliases;
CREATE POLICY "Auth access inventory_barcode_aliases" ON public.inventory_barcode_aliases FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to inventory_correction_queue" ON public.inventory_correction_queue;
CREATE POLICY "Auth access inventory_correction_queue" ON public.inventory_correction_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to inventory_count_items" ON public.inventory_count_items;
CREATE POLICY "Auth access inventory_count_items" ON public.inventory_count_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to inventory_counts" ON public.inventory_counts;
CREATE POLICY "Auth access inventory_counts" ON public.inventory_counts FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to inventory_unresolved_barcodes" ON public.inventory_unresolved_barcodes;
CREATE POLICY "Auth access inventory_unresolved_barcodes" ON public.inventory_unresolved_barcodes FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to marketing_campaigns" ON public.marketing_campaigns;
CREATE POLICY "Auth access marketing_campaigns" ON public.marketing_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to orders" ON public.orders;
CREATE POLICY "Auth access orders" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to pos_exchanges" ON public.pos_exchanges;
CREATE POLICY "Auth access pos_exchanges" ON public.pos_exchanges FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to pos_inter_store_requests" ON public.pos_inter_store_requests;
CREATE POLICY "Auth access pos_inter_store_requests" ON public.pos_inter_store_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to pos_sales" ON public.pos_sales;
CREATE POLICY "Auth access pos_sales" ON public.pos_sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to pos_product_searches" ON public.pos_product_searches;
CREATE POLICY "Auth access pos_product_searches" ON public.pos_product_searches FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to pos_stores" ON public.pos_stores;
CREATE POLICY "Auth access pos_stores" ON public.pos_stores FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to profiles" ON public.profiles;
CREATE POLICY "Auth access profiles" ON public.profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to support_tickets" ON public.support_tickets;
CREATE POLICY "Auth access support_tickets" ON public.support_tickets FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to team_chat_messages" ON public.team_chat_messages;
CREATE POLICY "Auth access team_chat_messages" ON public.team_chat_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to tiny_accounts_payable" ON public.tiny_accounts_payable;
CREATE POLICY "Auth access tiny_accounts_payable" ON public.tiny_accounts_payable FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "Auth access whatsapp_messages" ON public.whatsapp_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to whatsapp_numbers" ON public.whatsapp_numbers;
CREATE POLICY "Auth access whatsapp_numbers" ON public.whatsapp_numbers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to zoppy_customers" ON public.zoppy_customers;
CREATE POLICY "Auth access zoppy_customers" ON public.zoppy_customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to zoppy_sales" ON public.zoppy_sales;
CREATE POLICY "Auth access zoppy_sales" ON public.zoppy_sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- customer_registrations: keep public INSERT for forms
DROP POLICY IF EXISTS "Allow public select on customer_registrations" ON public.customer_registrations;
DROP POLICY IF EXISTS "Allow update on customer_registrations" ON public.customer_registrations;
DROP POLICY IF EXISTS "Allow public insert on customer_registrations" ON public.customer_registrations;
CREATE POLICY "Public insert customer_registrations" ON public.customer_registrations FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Auth read customer_registrations" ON public.customer_registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth update customer_registrations" ON public.customer_registrations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- chat_sector_round_robin - consolidate to authenticated
DROP POLICY IF EXISTS "Authenticated can upsert round robin" ON public.chat_sector_round_robin;
DROP POLICY IF EXISTS "Authenticated can read round robin" ON public.chat_sector_round_robin;
CREATE POLICY "Auth access chat_sector_round_robin" ON public.chat_sector_round_robin FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- lp_leads: keep public INSERT for landing pages
DROP POLICY IF EXISTS "Allow all access to lp_leads" ON public.lp_leads;
CREATE POLICY "Public insert lp_leads" ON public.lp_leads FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Auth read lp_leads" ON public.lp_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth update lp_leads" ON public.lp_leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
