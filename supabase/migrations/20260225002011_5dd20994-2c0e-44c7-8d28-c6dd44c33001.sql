
-- Master table of all possible fixed costs for shoe stores
CREATE TABLE public.cost_center_fixed_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'geral',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cost_center_fixed_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.cost_center_fixed_costs FOR ALL USING (true) WITH CHECK (true);

-- Which fixed costs apply to which store + their amounts
CREATE TABLE public.cost_center_store_fixed_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  fixed_cost_id UUID NOT NULL REFERENCES public.cost_center_fixed_costs(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, fixed_cost_id)
);
ALTER TABLE public.cost_center_store_fixed_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.cost_center_store_fixed_costs FOR ALL USING (true) WITH CHECK (true);

-- Variable costs per store
CREATE TABLE public.cost_center_variable_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.pos_stores(id),
  description TEXT NOT NULL,
  percentage NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cost_center_variable_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.cost_center_variable_costs FOR ALL USING (true) WITH CHECK (true);

-- Seed default fixed costs for shoe stores
INSERT INTO public.cost_center_fixed_costs (name, description, category, sort_order) VALUES
  ('Aluguel', 'Aluguel do ponto comercial', 'Imóvel', 1),
  ('Condomínio', 'Taxa de condomínio do shopping/galeria', 'Imóvel', 2),
  ('IPTU', 'Imposto predial e territorial urbano', 'Imóvel', 3),
  ('Energia Elétrica', 'Conta de luz da loja', 'Utilidades', 4),
  ('Água', 'Conta de água', 'Utilidades', 5),
  ('Internet/Telefone', 'Telecomunicações', 'Utilidades', 6),
  ('Seguro do Imóvel', 'Seguro contra incêndio, roubo, etc.', 'Seguros', 7),
  ('Alarme/Monitoramento', 'Sistema de segurança', 'Seguros', 8),
  ('Sistema ERP/PDV', 'Mensalidade do sistema de gestão', 'Tecnologia', 9),
  ('Plataforma E-commerce', 'Shopify, Yampi ou similar', 'Tecnologia', 10),
  ('Domínio e Hospedagem', 'Site institucional', 'Tecnologia', 11),
  ('Salários', 'Folha de pagamento dos funcionários', 'Pessoal', 12),
  ('Encargos Trabalhistas', 'FGTS, INSS, 13º, férias', 'Pessoal', 13),
  ('Vale Transporte', 'Benefício de transporte', 'Pessoal', 14),
  ('Vale Alimentação/Refeição', 'Benefício alimentação', 'Pessoal', 15),
  ('Plano de Saúde', 'Benefício saúde dos colaboradores', 'Pessoal', 16),
  ('Contador/Contabilidade', 'Honorários contábeis', 'Administrativo', 17),
  ('Assessoria Jurídica', 'Consultoria jurídica mensal', 'Administrativo', 18),
  ('Material de Escritório', 'Papelaria, sacolas, embalagens', 'Operacional', 19),
  ('Sacolas e Embalagens', 'Sacolas personalizadas, caixas, papel de seda', 'Operacional', 20),
  ('Limpeza e Conservação', 'Produtos de limpeza ou empresa terceirizada', 'Operacional', 21),
  ('Manutenção da Loja', 'Reparos, pintura, reformas', 'Operacional', 22),
  ('Marketing/Publicidade', 'Investimento fixo em mídias, redes sociais', 'Marketing', 23),
  ('Decoração/Visual Merchandising', 'Vitrine, displays, ambientação', 'Marketing', 24),
  ('Despesas Bancárias', 'Tarifas, anuidade de conta PJ', 'Financeiro', 25),
  ('Software/Assinaturas', 'Ferramentas digitais (Canva, CRM, etc.)', 'Tecnologia', 26),
  ('Frete Fixo/Logística', 'Custo fixo com entregas ou motoboy', 'Logística', 27),
  ('Associação Comercial', 'Mensalidade CDL, associações', 'Administrativo', 28),
  ('Pró-labore', 'Retirada mensal dos sócios', 'Pessoal', 29),
  ('Depreciação de Equipamentos', 'Mobiliário, ar condicionado, computadores', 'Administrativo', 30);

-- Add completion_notes column to pos_seller_tasks for task completion summaries
ALTER TABLE public.pos_seller_tasks ADD COLUMN IF NOT EXISTS completion_notes TEXT;
