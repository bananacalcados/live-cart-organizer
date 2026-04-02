
-- Table for situation-specific prompts (global defaults + per-campaign overrides)
CREATE TABLE public.ad_campaign_situation_prompts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES public.ad_campaigns_ai(id) ON DELETE CASCADE,
  situation TEXT NOT NULL,
  sub_situation TEXT,
  prompt_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one prompt per situation/sub per campaign (or global)
CREATE UNIQUE INDEX idx_ad_situation_prompts_unique 
ON public.ad_campaign_situation_prompts (
  COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
  situation,
  COALESCE(sub_situation, '__none__')
);

-- Index for fast lookups
CREATE INDEX idx_ad_situation_prompts_campaign ON public.ad_campaign_situation_prompts(campaign_id);
CREATE INDEX idx_ad_situation_prompts_situation ON public.ad_campaign_situation_prompts(situation);

-- Enable RLS
ALTER TABLE public.ad_campaign_situation_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read prompts"
ON public.ad_campaign_situation_prompts FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert prompts"
ON public.ad_campaign_situation_prompts FOR INSERT
TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update prompts"
ON public.ad_campaign_situation_prompts FOR UPDATE
TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete prompts"
ON public.ad_campaign_situation_prompts FOR DELETE
TO authenticated USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_ad_situation_prompts_updated_at
BEFORE UPDATE ON public.ad_campaign_situation_prompts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed global default prompts
INSERT INTO public.ad_campaign_situation_prompts (campaign_id, situation, sub_situation, prompt_text, sort_order) VALUES
-- Situação 1: Info + Qualificação
(NULL, 'info_qualificacao', NULL, 'Apresente o produto de forma breve e simpática. Mencione o preço e pergunte o tamanho do cliente. Máximo 2 linhas. Use emoji moderado. NÃO mencione frete, formas de pagamento ou promoções neste momento.', 1),

-- Situação 2: Dúvidas (sub-prompts)
(NULL, 'duvidas', 'tamanho', 'O cliente perguntou sobre tamanho/numeração. Use a ferramenta search_product para verificar os tamanhos disponíveis em estoque. Responda de forma direta listando os tamanhos disponíveis.', 2),
(NULL, 'duvidas', 'cores', 'O cliente perguntou sobre cores disponíveis. Use search_product para verificar. Liste as cores disponíveis de forma breve.', 3),
(NULL, 'duvidas', 'frete', 'O cliente perguntou sobre frete/entrega. Se for de Governador Valadares (GV), informe que entregamos na cidade sem custo adicional e podemos combinar pagamento na entrega. Se for de fora, peça o CEP para calcular.', 4),
(NULL, 'duvidas', 'localizacao', 'O cliente perguntou de onde somos ou onde fica a loja. Somos a Banana Calçados, de Governador Valadares - MG. Temos lojas no Jardim Pérola e no Centro. Também atendemos online pelo WhatsApp para todo o Brasil.', 5),
(NULL, 'duvidas', 'pagamento', 'O cliente perguntou sobre formas de pagamento. Aceitamos: PIX (com desconto), Cartão de Crédito (até 10x), e para clientes de Valadares temos a opção de pagamento na entrega.', 6),
(NULL, 'duvidas', 'fotos', 'O cliente pediu fotos do produto. Use a ferramenta send_product_image para enviar a foto. Diga que está enviando a foto.', 7),
(NULL, 'duvidas', 'desconto', 'O cliente perguntou sobre descontos ou promoções. Verifique se a campanha tem condições especiais no campo payment_conditions. Se não houver, informe o preço normal e destaque o custo-benefício.', 8),
(NULL, 'duvidas', 'geral', 'O cliente fez uma pergunta geral. Responda de forma breve e direta (máximo 2 linhas). Se não souber a resposta, diga que vai verificar com a equipe.', 9),

-- Situação 3: Follow-up 1
(NULL, 'followup_1', NULL, 'O cliente não respondeu. Envie uma mensagem curta e amigável retomando o assunto da última etapa. NÃO mude de assunto. Exemplos: "Oi! Ainda está interessado(a) no [produto]?" ou "Conseguiu ver o que enviei?". Máximo 1 linha.', 10),

-- Situação 4: Coleta de dados
(NULL, 'coleta_dados', NULL, 'Colete os dados do cliente para envio UM DE CADA VEZ nesta ordem: 1) Nome completo, 2) CPF, 3) Email, 4) CEP, 5) Endereço completo. Quando o cliente enviar o CEP, use a ferramenta lookup_cep para preencher automaticamente. Confirme os dados antes de prosseguir.', 11),

-- Situação 5: Pagamento
(NULL, 'pagamento', NULL, 'Pergunte a forma de pagamento preferida: PIX ou Cartão. Se PIX, use generate_pix e envie a chave EM UMA MENSAGEM SEPARADA (apenas a chave, sem texto extra). Se cartão, use generate_card_link. Para clientes de GV, ofereça também pagamento na entrega.', 12),

-- Situação 6: Follow-up 2
(NULL, 'followup_2', NULL, 'O cliente já recebeu follow-up(s) sem resposta. Mude de assunto: pergunte se gostaria de participar da próxima Live/evento da loja e se quer ser avisado quando começar. NÃO insista no produto anterior. Seja breve e simpático.', 13),

-- Situação 7: Requalificação
(NULL, 'requalificacao', NULL, 'O cliente demonstrou interesse em outro produto ou pediu mais opções. Use search_product para buscar alternativas. Entenda se ele quer algo diferente no estilo, preço ou funcionalidade. Apresente até 3 opções relevantes de forma breve.', 14);
