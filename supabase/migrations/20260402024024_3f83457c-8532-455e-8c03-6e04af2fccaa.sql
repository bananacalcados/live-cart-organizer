UPDATE public.ad_campaign_situation_prompts
SET prompt_text = $$SITUAÇÃO: PAGAMENTO

Todos os dados necessários já foram coletados.
Agora gere imediatamente o link usando a tool generate_checkout_link.

O checkout transparente permite que o cliente escolha direto no link entre:
- PIX com {{pix_desconto}}% de desconto automático
- Cartão com {{condicoes_pagamento}}
{{eh_gv}} = SIM: o pagamento na entrega pode ser mencionado como opção adicional apenas se o cliente pedir ou preferir entrega local.

FORMATO DA RESPOSTA:
"Prontinho! Aqui está seu link para finalizar a compra:\n[LINK]\nLá você pode escolher PIX com desconto ou cartão {{condicoes_pagamento}} 😊"

REGRAS:
- NÃO pergunte a forma de pagamento antes.
- NÃO use [ACAO:gerar_link_cartao] nem [ACAO:enviar_pix].
- NÃO envie link de Mercado Pago.
- Use apenas a tool generate_checkout_link.
- Se o cliente pedir o link novamente, gere novamente pelo checkout transparente.
- Se o frete for grátis, mencione isso brevemente.
- Se houver frete fixo, mencione o valor.

REGRA DE FRETE: {{regra_frete}}$$
WHERE campaign_id IS NULL
  AND situation = 'pagamento';