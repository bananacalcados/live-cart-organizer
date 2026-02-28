
-- Enable RLS on new tables
ALTER TABLE public.chat_payment_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_nps_surveys ENABLE ROW LEVEL SECURITY;

-- Permissive policies (same pattern as other chat tables in this project)
CREATE POLICY "Allow all access to chat_payment_followups" ON public.chat_payment_followups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to chat_nps_surveys" ON public.chat_nps_surveys FOR ALL USING (true) WITH CHECK (true);
