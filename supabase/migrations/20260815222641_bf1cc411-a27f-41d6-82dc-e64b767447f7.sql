GRANT INSERT ON public.livete_presenter_alerts TO authenticated;
CREATE POLICY "Authenticated can insert alerts" ON public.livete_presenter_alerts FOR INSERT TO authenticated WITH CHECK (true);