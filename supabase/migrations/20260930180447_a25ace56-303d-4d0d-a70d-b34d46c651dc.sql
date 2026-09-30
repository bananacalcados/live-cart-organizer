CREATE TABLE public.live_order_intent_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  username text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  dismissed_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, username)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_order_intent_dismissals TO authenticated;
GRANT ALL ON public.live_order_intent_dismissals TO service_role;
ALTER TABLE public.live_order_intent_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage live order intent dismissals" ON public.live_order_intent_dismissals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);