ALTER TABLE public.pos_stores
  ADD COLUMN IF NOT EXISTS has_tiny_token boolean GENERATED ALWAYS AS (coalesce(nullif(btrim(tiny_token), ''), null) IS NOT NULL) STORED;

REVOKE SELECT ON public.pos_stores FROM authenticated;
GRANT SELECT (id, name, address, is_active, created_at, updated_at, tiny_deposit_name, revenue_target, is_simulation, company_id, disable_tiny_orders, has_tiny_token) ON public.pos_stores TO authenticated;
GRANT ALL ON public.pos_stores TO service_role;

DROP POLICY IF EXISTS "Auth access pos_stores" ON public.pos_stores;
DROP POLICY IF EXISTS "pos_stores_auth_all" ON public.pos_stores;
CREATE POLICY "Authenticated users can read safe store fields"
ON public.pos_stores FOR SELECT TO authenticated
USING (true);
CREATE POLICY "Admins and managers can insert stores"
ON public.pos_stores FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Admins and managers can update stores"
ON public.pos_stores FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
CREATE POLICY "Admins and managers can delete stores"
ON public.pos_stores FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS "Authenticated users can manage reminders" ON public.secretary_reminders;
CREATE POLICY "Users manage own secretary reminders"
ON public.secretary_reminders FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can manage secretary messages" ON public.secretary_messages;
CREATE POLICY "Users manage own secretary messages"
ON public.secretary_messages FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can manage secretary settings" ON public.secretary_settings;
CREATE POLICY "Users manage own secretary settings"
ON public.secretary_settings FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Auth access pos_sales" ON public.pos_sales;
CREATE POLICY "Authorized staff can manage pos sales"
ON public.pos_sales FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'pos')
  OR public.has_module_access(auth.uid(), 'management')
  OR public.has_module_access(auth.uid(), 'expedition')
  OR public.has_module_access(auth.uid(), 'marketing')
  OR public.has_module_access(auth.uid(), 'events')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'pos')
  OR public.has_module_access(auth.uid(), 'management')
  OR public.has_module_access(auth.uid(), 'expedition')
  OR public.has_module_access(auth.uid(), 'marketing')
  OR public.has_module_access(auth.uid(), 'events')
);

DROP POLICY IF EXISTS "Staff manage live chat messages" ON public.live_chat_messages;
CREATE POLICY "Authorized staff manage live chat messages"
ON public.live_chat_messages FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'events')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'events')
);

DROP POLICY IF EXISTS "Staff manage live viewers" ON public.live_viewers;
CREATE POLICY "Authorized staff manage live viewers"
ON public.live_viewers FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'events')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'events')
);

DROP POLICY IF EXISTS "Authenticated users can view dispatch history" ON public.dispatch_history;
DROP POLICY IF EXISTS "Authenticated users can insert dispatch history" ON public.dispatch_history;
DROP POLICY IF EXISTS "Authenticated users can update dispatch history" ON public.dispatch_history;
CREATE POLICY "Authorized staff can view dispatch history"
ON public.dispatch_history FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'marketing')
  OR public.has_module_access(auth.uid(), 'management')
);
CREATE POLICY "Authorized staff can insert dispatch history"
ON public.dispatch_history FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'marketing')
  OR public.has_module_access(auth.uid(), 'management')
);
CREATE POLICY "Authorized staff can update dispatch history"
ON public.dispatch_history FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'marketing')
  OR public.has_module_access(auth.uid(), 'management')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR public.has_module_access(auth.uid(), 'marketing')
  OR public.has_module_access(auth.uid(), 'management')
);

ALTER VIEW public.v_a1_backfill_summary SET (security_invoker = on);
ALTER VIEW public.v_a1_orphan_pos_products SET (security_invoker = on);
ALTER VIEW public.v_products_needs_review SET (security_invoker = on);
ALTER VIEW public.whatsapp_numbers_safe SET (security_invoker = on);

ALTER PUBLICATION supabase_realtime DROP TABLE public.pos_sales;
ALTER PUBLICATION supabase_realtime DROP TABLE public.live_viewers;
ALTER PUBLICATION supabase_realtime DROP TABLE public.live_chat_messages;
ALTER PUBLICATION supabase_realtime DROP TABLE public.dispatch_history;