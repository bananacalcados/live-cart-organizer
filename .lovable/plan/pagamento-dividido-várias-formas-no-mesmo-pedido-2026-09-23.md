# Pagamento dividido (várias formas no mesmo pedido)

## Ideia central
Um pedido, um valor total, **várias partes de pagamento**. Cada parte tem sua forma (Pix, Crédito, Débito) e seu valor. O pedido só vira **Pago** quando a soma das partes aprovadas cobre o total. Estoque, expedição, link de rastreio, cashback e confirmação continuam acontecendo **uma vez só**, no pagamento final.

Regras:
- De 2 a 4 partes (padrão 2; botão "+ adicionar forma").
- Qualquer combinação: Pix + Crédito, Crédito + Crédito, Crédito + Débito, Débito + Pix, Pix + Pix etc.
- Desconto Pix (5%) vale **só sobre a parte Pix**. Cartão sem desconto.
- Parcelamento por parte de crédito, respeitando as regras atuais (máx. 6x / regra do link / 10x sem juros acima de R$ 300 aplicada ao valor da parte).
- Débito: Mercado Pago, 1x (regra atual).
- Cascata de gateways igual à de hoje, aplicada a cada parte (MP sempre primeiro).

## Experiência do vendedor
Nos 3 lugares aparece a chave **"Dividir pagamento"**:
1. Liga a chave → surgem 2 linhas: forma + valor.
2. Digita o valor da 1ª parte; a última linha se ajusta sozinha com o restante.
3. "+ adicionar forma" para 3ª/4ª parte.
4. Resumo: "Pix R$ 200 (R$ 190 com desconto) + Crédito R$ 260 em até 6x = cliente paga R$ 450".
5. Envia **um link só**.

Opção "Deixar a cliente escolher a divisão": o link abre com a divisão livre para a cliente preencher (mesmas regras).

## Experiência da cliente (checkout)
- Topo: "Pagamento em 2 partes" com lista das partes e status (Pendente / Pago).
- Paga a parte 1 (Pix: QR na tela; cartão: formulário atual, sem mudanças).
- Parte aprovada fica verde e trava; segue para a próxima.
- Pode sair e voltar pelo mesmo link: partes pagas continuam pagas.
- Ao completar: tela de sucesso normal + mensagem de confirmação com link de rastreio.

## Segurança contra erros
- Parte aprovada nunca é cobrada de novo (idempotência por parte).
- Pedido não pode ser alterado depois que alguma parte foi paga (só cancelar/estornar).
- Se a cliente desistir no meio: pedido fica "Pago parcialmente", visível para a equipe com botão **Estornar partes pagas** ou **Cobrar restante** (novo link só do saldo).
- Pix expirado de uma parte: gera novo Pix só daquela parte.

## Etapas (cada uma sobe desligada e é ativada por chave)

**Etapa 1 — Base (sem mudar nada visível)**
- Nova tabela de partes de pagamento ligada ao pedido/link, com forma, valor, desconto, parcelas, gateway, id da transação, status.
- Função no servidor que soma partes aprovadas e só marca o pedido como pago quando cobre o total (reaproveita a confirmação atual → estoque, rastreio, cashback, Meta, confirmação).
- Chave `split_payment_enabled` em configurações (desligada).
- Testes automáticos das contas (desconto só no Pix, arredondamento, soma).

**Etapa 2 — Checkout da cliente**
- Checkout transparente passa a entender pedidos com partes: paga uma de cada vez, reusando Pix, crédito e débito atuais.
- Retomada do link, trava de parte paga, Pix expirado por parte.
- Pedidos sem divisão seguem exatamente o fluxo atual.
- Teste ponta a ponta no ambiente de teste (Pix + crédito; crédito + débito; 3 partes).

**Etapa 3 — PDV > Online > Link de pagamento**
- Chave "Dividir pagamento" no criar link, editor de partes, resumo, envio.
- Barra de links pendentes mostra "2/3 partes pagas".

**Etapa 4 — Modal do WhatsApp no PDV**
- Mesmo editor no botão de checkout do chat; mensagens prontas ganham variável `{{divisao_pagamento}}`.

**Etapa 5 — Live**
- Chave no card do pedido/ações rápidas; cards "Aguardando pagamento" mostram "Pago parcialmente R$ X de R$ Y".
- Confirmação da Live dispara só no pagamento final.

**Etapa 6 — Painéis e relatórios**
- Venda mostra cada parte (forma, gateway, id, parcelas) nos detalhes de pagamento.
- Dashboard por forma de pagamento soma cada parte na sua forma real (Pix R$ 190 em Pix, R$ 260 em Crédito).
- Consulta/estorno por parte; lista "Pagos parcialmente" com ações.
- Cashback = 10% do valor realmente pago (soma das partes).

## O que não muda
- Formulário de cartão atual, cascata (MP primeiro, AustPay desligada), regras de parcelamento, pedidos sem divisão, fiscal, estoque (baixa só no pagamento final).

## Detalhes técnicos
- Tabela `payment_splits` (order_ref/sale_id/checkout_link_id, seq, method pix|credit|debit, amount, discount_amount, charge_amount, installments, gateway, gateway_tx_id, request_id único, status pending|approved|refused|expired|refunded, paid_at) com GRANT + RLS.
- RPC `apply_split_payment(split_id, gateway, tx_id)` security definer: marca parte, soma, e só quando `sum(amount approved) >= total` chama o caminho existente de pago (`_shared/payment-confirmed.ts`) com `payment_method` = "Dividido" e `payment_details` listando as partes.
- Edge functions de pagamento (Pix/cartão/débito MP, AppMax, Pagar.me) recebem `split_id` opcional; sem ele, comportamento idêntico.
- Webhooks resolvem `split_id` pela referência externa `{order}-S{seq}`.
- Validação servidor: soma das partes = total; parcelas por parte ≤ teto; débito 1x.
- Tudo atrás de `app_settings.split_payment_enabled` por etapa.
