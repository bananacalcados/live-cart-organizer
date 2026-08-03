CREATE TABLE public.pos_commission_live_event_optouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.pos_commission_people(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  store_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_commission_live_event_optouts TO authenticated;
GRANT ALL ON public.pos_commission_live_event_optouts TO service_role;

ALTER TABLE public.pos_commission_live_event_optouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage live event optouts"
ON public.pos_commission_live_event_optouts
FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE INDEX idx_live_event_optouts_event ON public.pos_commission_live_event_optouts(event_id);
CREATE INDEX idx_live_event_optouts_person ON public.pos_commission_live_event_optouts(person_id);

CREATE TRIGGER trg_live_event_optouts_updated_at
BEFORE UPDATE ON public.pos_commission_live_event_optouts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();