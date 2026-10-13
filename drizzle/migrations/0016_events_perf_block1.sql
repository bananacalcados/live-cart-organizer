CREATE INDEX IF NOT EXISTS idx_live_comments_order_id ON public.live_comments(order_id) WHERE order_id IS NOT NULL;

ALTER PUBLICATION supabase_realtime DROP TABLE public.automation_ai_sessions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.automation_flows;
ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_contacts;
ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_payment_followups;
ALTER PUBLICATION supabase_realtime DROP TABLE public.expedition_returns;
ALTER PUBLICATION supabase_realtime DROP TABLE public.order_crossell_items;