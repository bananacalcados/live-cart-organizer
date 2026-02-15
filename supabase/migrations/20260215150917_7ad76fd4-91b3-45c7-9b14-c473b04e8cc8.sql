
-- Sectors table: customizable departments
CREATE TABLE public.chat_sectors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  ai_routing_keywords TEXT[], -- keywords to help AI classify
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_sectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read sectors" ON public.chat_sectors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage sectors" ON public.chat_sectors FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Agents assigned to sectors
CREATE TABLE public.chat_sector_agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sector_id UUID NOT NULL REFERENCES public.chat_sectors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_online BOOLEAN NOT NULL DEFAULT false,
  current_load INT NOT NULL DEFAULT 0,
  max_concurrent INT NOT NULL DEFAULT 5,
  last_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sector_id, user_id)
);
ALTER TABLE public.chat_sector_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read sector agents" ON public.chat_sector_agents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage sector agents" ON public.chat_sector_agents FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Lead/conversation assignments (round-robin tracking)
CREATE TABLE public.chat_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  sector_id UUID NOT NULL REFERENCES public.chat_sectors(id),
  assigned_to UUID, -- user_id of the agent
  assigned_by TEXT NOT NULL DEFAULT 'ai', -- 'ai', 'manual', 'round_robin'
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, resolved
  ai_classification TEXT, -- what the AI detected (e.g. 'tracking_inquiry', 'purchase_interest')
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read assignments" ON public.chat_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert assignments" ON public.chat_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update assignments" ON public.chat_assignments FOR UPDATE TO authenticated USING (true);

-- Round-robin counter per sector
CREATE TABLE public.chat_sector_round_robin (
  sector_id UUID NOT NULL REFERENCES public.chat_sectors(id) ON DELETE CASCADE PRIMARY KEY,
  last_agent_index INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_sector_round_robin ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read round robin" ON public.chat_sector_round_robin FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can upsert round robin" ON public.chat_sector_round_robin FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed default sectors
INSERT INTO public.chat_sectors (name, description, ai_routing_keywords, sort_order) VALUES
('Vendas', 'Atendimento de vendas, dúvidas sobre produtos, preços e disponibilidade', ARRAY['comprar','preço','produto','disponível','tamanho','numeração','modelo','coleção','promoção','desconto','parcela','pagamento'], 1),
('Suporte', 'Suporte ao cliente, rastreio de pedidos, problemas com entregas', ARRAY['rastreio','rastrear','envio','entrega','pedido','tracking','transportadora','correios','jadlog','demora','não chegou','problema','reclamação'], 2),
('Trocas e Devoluções', 'Gestão de trocas, devoluções e reembolsos', ARRAY['troca','trocar','devolver','devolução','reembolso','defeito','errado','tamanho errado','não serviu'], 3);

-- Enable realtime for assignments
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_assignments;

-- Triggers for updated_at
CREATE TRIGGER update_chat_sectors_updated_at BEFORE UPDATE ON public.chat_sectors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_chat_assignments_updated_at BEFORE UPDATE ON public.chat_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
