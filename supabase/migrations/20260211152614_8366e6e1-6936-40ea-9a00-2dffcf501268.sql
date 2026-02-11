
-- ═══════════════════════════════════════════════════════════════
-- 1. CHAT INTERNO DA EQUIPE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.team_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;

-- Public access (no auth required for internal tool)
CREATE POLICY "Anyone can read team chat" ON public.team_chat_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can send team chat" ON public.team_chat_messages FOR INSERT WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_chat_messages;

-- ═══════════════════════════════════════════════════════════════
-- 2. TICKETS DE SUPORTE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expedition_order_id UUID REFERENCES public.expedition_orders(id),
  shopify_order_name TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'medium',
  assigned_to TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  deadline_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  points_awarded INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read support tickets" ON public.support_tickets FOR SELECT USING (true);
CREATE POLICY "Anyone can create support tickets" ON public.support_tickets FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update support tickets" ON public.support_tickets FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete support tickets" ON public.support_tickets FOR DELETE USING (true);

CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;

-- ═══════════════════════════════════════════════════════════════
-- 3. GAMIFICAÇÃO - PONTUAÇÃO DA EQUIPE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.team_gamification (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  member_name TEXT NOT NULL UNIQUE,
  total_points INTEGER NOT NULL DEFAULT 0,
  tickets_resolved INTEGER NOT NULL DEFAULT 0,
  tickets_fast INTEGER NOT NULL DEFAULT 0,
  tickets_medium INTEGER NOT NULL DEFAULT 0,
  tickets_slow INTEGER NOT NULL DEFAULT 0,
  penalties INTEGER NOT NULL DEFAULT 0,
  weekly_points INTEGER NOT NULL DEFAULT 0,
  weekly_goal INTEGER NOT NULL DEFAULT 50,
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.team_gamification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read gamification" ON public.team_gamification FOR SELECT USING (true);
CREATE POLICY "Anyone can insert gamification" ON public.team_gamification FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update gamification" ON public.team_gamification FOR UPDATE USING (true);

CREATE TRIGGER update_team_gamification_updated_at
  BEFORE UPDATE ON public.team_gamification
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
