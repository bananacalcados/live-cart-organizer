
-- Team members table
CREATE TABLE public.event_team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'vendedora' CHECK (role IN ('vendedora', 'apresentadora')),
  whatsapp TEXT,
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Junction table: event <-> team member
CREATE TABLE public.event_team_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.event_team_members(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id, team_member_id)
);

-- Stock alerts table
CREATE TABLE public.event_stock_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_title TEXT NOT NULL,
  variant TEXT,
  sku TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'has_stock', 'no_stock', 'wrong_product')),
  resolved_by TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.event_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_team_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_stock_alerts ENABLE ROW LEVEL SECURITY;

-- RLS policies (authenticated users can manage)
CREATE POLICY "Authenticated users can manage team members" ON public.event_team_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage team assignments" ON public.event_team_assignments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage stock alerts" ON public.event_stock_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable realtime for stock alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_stock_alerts;

-- Trigger for updated_at
CREATE TRIGGER update_event_team_members_updated_at
  BEFORE UPDATE ON public.event_team_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
