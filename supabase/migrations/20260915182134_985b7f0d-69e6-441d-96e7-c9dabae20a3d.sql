ALTER TABLE public.member_area_magic_links
  ADD COLUMN order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX idx_member_area_magic_links_order_id
  ON public.member_area_magic_links (order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.live_member_sessions
  ADD COLUMN order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX idx_live_member_sessions_order_id
  ON public.live_member_sessions (order_id)
  WHERE order_id IS NOT NULL;