
-- 1. ai_conversation_logs: remove anonymous insert ability (server uses service_role which bypasses RLS)
DROP POLICY IF EXISTS "Service can insert ai logs" ON public.ai_conversation_logs;
CREATE POLICY "Authenticated can insert ai logs"
  ON public.ai_conversation_logs FOR INSERT TO authenticated
  WITH CHECK (true);
REVOKE INSERT ON public.ai_conversation_logs FROM anon;

-- 2. live_comments: restrict insert to authenticated staff (ingestion goes through service_role)
DROP POLICY IF EXISTS "Allow public insert" ON public.live_comments;
CREATE POLICY "Authenticated can insert live comments"
  ON public.live_comments FOR INSERT TO authenticated
  WITH CHECK (true);
REVOKE INSERT ON public.live_comments FROM anon;

-- 3. push_subscriptions: remove anonymous insert (client subscribes via push-notifications edge function using service_role)
DROP POLICY IF EXISTS "Allow anonymous insert" ON public.push_subscriptions;
REVOKE INSERT, UPDATE, DELETE ON public.push_subscriptions FROM anon;

-- 4. group_redirect_links: remove public read; redirects served via group-redirect-link edge function (service_role)
DROP POLICY IF EXISTS "Public can read active redirect links" ON public.group_redirect_links;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.group_redirect_links FROM anon;
