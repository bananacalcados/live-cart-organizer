-- Create message_templates table for shared templates
CREATE TABLE public.message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'all',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Allow all access (same pattern as other tables in this project)
CREATE POLICY "Allow all access to message_templates"
  ON public.message_templates
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_templates;

-- Insert default templates
INSERT INTO public.message_templates (name, message, stage) VALUES
  ('Boas-vindas', 'Olá {{nome}}! 👋

Vi seu interesse nos nossos produtos. Como posso ajudar?', 'new'),
  ('Enviar Link do Carrinho', 'Oi {{nome}}! 🛒

Seu carrinho está pronto! Acesse aqui:
{{link_carrinho}}

Total: R$ {{total}}

Qualquer dúvida estou à disposição!', 'link_sent'),
  ('Lembrete de Pagamento', 'Oi {{nome}}! 😊

Passando para lembrar do seu pedido:
{{produtos}}

Total: R$ {{total}}

Posso ajudar com algo?', 'awaiting_payment'),
  ('Confirmação de Pagamento', 'Oba, {{nome}}! 🎉

Pagamento confirmado! Seu pedido já está sendo preparado.

Obrigado pela compra!', 'paid'),
  ('Pedido Enviado', 'Oi {{nome}}! 📦

Seu pedido foi enviado!

Em breve você receberá o código de rastreio.

Obrigado pela preferência!', 'shipped');