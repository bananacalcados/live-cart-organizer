-- Permite o evento de sorteio (raffle_draw) no overlay: o botão Sortear (função event-raffle) e o
-- botão Testar sorteio (painel do overlay) já gravam esse kind, mas a constraint e a política de
-- escrita não aceitavam — o sorteio acontecia e a roleta nunca aparecia na tela.
ALTER TABLE public.live_overlay_events DROP CONSTRAINT live_overlay_events_kind_check;
ALTER TABLE public.live_overlay_events ADD CONSTRAINT live_overlay_events_kind_check
  CHECK (kind = ANY (ARRAY['paid','assembled','cta_now','raffle_update','wheel_spin','timer','expired','raffle_draw']));

DROP POLICY "auth insert cta" ON public.live_overlay_events;
CREATE POLICY "auth insert overlay events" ON public.live_overlay_events FOR INSERT TO authenticated
  WITH CHECK (kind = ANY (ARRAY['cta_now','raffle_draw']));