
-- Tighten RLS policies for new Phase 2 tables

-- chat_payment_followups
DROP POLICY IF EXISTS "Allow all access to chat_payment_followups" ON public.chat_payment_followups;
CREATE POLICY "POS module can manage payment followups"
ON public.chat_payment_followups
FOR ALL
TO authenticated
USING (public.has_module_access(auth.uid(), 'pos'))
WITH CHECK (public.has_module_access(auth.uid(), 'pos'));

-- chat_nps_surveys
DROP POLICY IF EXISTS "Allow all access to chat_nps_surveys" ON public.chat_nps_surveys;
CREATE POLICY "POS module can manage NPS surveys"
ON public.chat_nps_surveys
FOR ALL
TO authenticated
USING (public.has_module_access(auth.uid(), 'pos'))
WITH CHECK (public.has_module_access(auth.uid(), 'pos'));
