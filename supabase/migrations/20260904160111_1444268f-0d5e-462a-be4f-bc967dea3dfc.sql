CREATE TABLE public.event_contact_lanes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  phone_key text NOT NULL,
  lane text NOT NULL DEFAULT 'doubts' CHECK (lane IN ('doubts', 'new')),
  reason text,
  moved_by uuid DEFAULT auth.uid(),
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, phone_key)
);

CREATE INDEX idx_event_contact_lanes_event ON public.event_contact_lanes(event_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_contact_lanes TO authenticated;
GRANT ALL ON public.event_contact_lanes TO service_role;

ALTER TABLE public.event_contact_lanes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage event contact lanes"
ON public.event_contact_lanes
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER trg_event_contact_lanes_updated_at
BEFORE UPDATE ON public.event_contact_lanes
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.event_contact_lanes;