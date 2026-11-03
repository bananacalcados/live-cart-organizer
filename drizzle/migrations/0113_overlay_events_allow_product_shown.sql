DROP POLICY IF EXISTS "auth insert overlay events" ON public.live_overlay_events;
CREATE POLICY "auth insert overlay events" ON public.live_overlay_events FOR INSERT TO authenticated
WITH CHECK (kind = ANY (ARRAY['cta_now'::text, 'raffle_draw'::text, 'product_shown'::text]));