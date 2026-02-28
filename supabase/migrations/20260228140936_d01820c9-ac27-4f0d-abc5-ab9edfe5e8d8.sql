
-- 1. Chat archived conversations
CREATE TABLE public.chat_archived_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_by TEXT
);
ALTER TABLE public.chat_archived_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to chat_archived_conversations" ON public.chat_archived_conversations FOR ALL USING (true) WITH CHECK (true);

-- 2. Chat awaiting payment
CREATE TABLE public.chat_awaiting_payment (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  sale_id UUID,
  type TEXT NOT NULL DEFAULT 'checkout',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_awaiting_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to chat_awaiting_payment" ON public.chat_awaiting_payment FOR ALL USING (true) WITH CHECK (true);

-- 3. Chat seller assignments
CREATE TABLE public.chat_seller_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  seller_id UUID,
  store_id UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_reply_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_seller_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to chat_seller_assignments" ON public.chat_seller_assignments FOR ALL USING (true) WITH CHECK (true);

-- 4. Add finish_reason and seller_id to chat_finished_conversations
ALTER TABLE public.chat_finished_conversations ADD COLUMN IF NOT EXISTS finish_reason TEXT;
ALTER TABLE public.chat_finished_conversations ADD COLUMN IF NOT EXISTS seller_id UUID;

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_archived_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_awaiting_payment;
