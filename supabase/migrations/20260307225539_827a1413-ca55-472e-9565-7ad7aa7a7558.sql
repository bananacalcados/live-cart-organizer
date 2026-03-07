CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,
  keys_p256dh text NOT NULL,
  keys_auth text NOT NULL,
  campaign_tag text,
  lead_name text,
  lead_phone text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert" ON public.push_subscriptions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow authenticated select" ON public.push_subscriptions FOR SELECT TO authenticated USING (true);

CREATE TABLE public.push_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  image_url text,
  click_url text,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  sent_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage" ON public.push_notification_log FOR ALL TO authenticated USING (true) WITH CHECK (true);