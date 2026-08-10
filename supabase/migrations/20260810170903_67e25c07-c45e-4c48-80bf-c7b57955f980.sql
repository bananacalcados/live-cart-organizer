CREATE TABLE public.event_raffles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prize_label TEXT NOT NULL,
  prize_type TEXT NOT NULL DEFAULT 'product',
  prize_value NUMERIC NOT NULL DEFAULT 0,
  expiry_days INTEGER NOT NULL DEFAULT 30,
  winners_count INTEGER NOT NULL DEFAULT 1,
  audience TEXT NOT NULL DEFAULT 'confirmed_orders',
  min_purchase_value NUMERIC NOT NULL DEFAULT 0,
  exclude_previous_winners BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft',
  drawn_at TIMESTAMP WITH TIME ZONE,
  drawn_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_raffles TO authenticated;
GRANT ALL ON public.event_raffles TO service_role;
ALTER TABLE public.event_raffles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage event_raffles" ON public.event_raffles FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.event_raffle_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  raffle_id UUID NOT NULL REFERENCES public.event_raffles(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  phone_suffix TEXT,
  display_name TEXT,
  order_id UUID,
  entry_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX event_raffle_entries_unique ON public.event_raffle_entries (raffle_id, phone);
CREATE INDEX event_raffle_entries_raffle_idx ON public.event_raffle_entries (raffle_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_raffle_entries TO authenticated;
GRANT ALL ON public.event_raffle_entries TO service_role;
ALTER TABLE public.event_raffle_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage event_raffle_entries" ON public.event_raffle_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.event_raffle_winners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  raffle_id UUID NOT NULL REFERENCES public.event_raffles(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES public.event_raffle_entries(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  display_name TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  customer_prize_id UUID,
  voided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX event_raffle_winners_raffle_idx ON public.event_raffle_winners (raffle_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_raffle_winners TO authenticated;
GRANT ALL ON public.event_raffle_winners TO service_role;
ALTER TABLE public.event_raffle_winners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage event_raffle_winners" ON public.event_raffle_winners FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_event_raffles_updated_at
BEFORE UPDATE ON public.event_raffles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Claim atômico: garante que um sorteio só seja executado uma vez.
CREATE OR REPLACE FUNCTION public.claim_event_raffle_draw(_raffle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ok BOOLEAN;
BEGIN
  UPDATE public.event_raffles
     SET status = 'drawn', drawn_at = now()
   WHERE id = _raffle_id AND status = 'draft'
  RETURNING true INTO _ok;
  RETURN COALESCE(_ok, false);
END;
$$;