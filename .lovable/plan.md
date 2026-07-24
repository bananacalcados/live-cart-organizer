# Plano — Status de pagamento reversível quando NÃO veio de webhook

## Problema
Hoje qualquer pedido marcado como "pago" (seja pelo webhook do gateway, seja arrastado manualmente para a coluna Pago) grava `is_paid=true` na mesma coluna. O link público (`/checkout/order/:orderId`) só olha `is_paid` — então, quando alguém move manualmente por engano, o cliente vê "Pago" no link e, mesmo se voltarmos o pedido para outra coluna no Kanban, o link continua verde porque `is_paid` fica travado em `true`.

## Ideia central
Registrar **de onde veio a confirmação** do pagamento. Se veio de webhook real de gateway, o status é imutável. Se foi manual (arrastado, marcado à mão, live, etc.), o status pode ser desfeito e o link volta a mostrar "pendente".

## Mudanças

### 1. Banco (`orders`)
- Nova coluna `payment_confirmed_source text` com valores:
  - `gateway_webhook` — confirmado por webhook real (MP, AppMax, Pagar.me, PayPal, Yampi, Vindi, Shopify).
  - `manual` — marcado pelo operador (drag no Kanban, botão "marcar como pago", `paid_externally`, live).
  - `null` — não pago.
- Trigger `trg_orders_payment_source_guard` em `BEFORE UPDATE`:
  - Se `OLD.payment_confirmed_source = 'gateway_webhook'` e o novo update tenta mexer em `is_paid`, `paid_externally`, `stage` (para tirar do pago) ou `payment_confirmed_source` → bloqueia (RAISE EXCEPTION).
  - Se o update marca como pago (is_paid true / paid_externally true / stage∈paid_stages) e `payment_confirmed_source` não veio setado explicitamente → default = `manual`.
- Backfill inicial:
  - Pedidos com `mercadopago_payment_id`, `appmax_transaction_id`, `pagarme_charge_id`, `paypal_order_id`, `yampi_order_id`, `vindi_charge_id`, `shopify_order_id` **preenchidos** → `payment_confirmed_source = 'gateway_webhook'`.
  - Demais pedidos pagos → `manual`.

### 2. Edge functions de webhook (setam `gateway_webhook`)
Ajustar cada função que confirma pagamento para escrever `payment_confirmed_source: 'gateway_webhook'` no mesmo UPDATE que marca `is_paid=true`:
- `mercadopago-check-payment`, `mercadopago-poll-pending`, `payment-webhook`, `appmax-webhook`, `pagarme-webhook`, `paypal-webhook`, `yampi-webhook`, `shopify-webhook`, `livete-payment-confirmation` (quando disparada por webhook, não por operador).

### 3. Fluxos manuais (setam `manual`)
- Drag & drop no Kanban do evento.
- Botão "marcar como pago" no `OrderDetailsDialog`.
- Toggle `paid_externally`.
- Qualquer script/RPC administrativa.
Todos passam a enviar `payment_confirmed_source: 'manual'` junto com o update.

### 4. Reversão ("desmarcar pago")
- No Kanban do evento e no `OrderDetailsDialog`, quando `payment_confirmed_source = 'manual'`:
  - Mostrar ação **"Desfazer pagamento"** que faz UPDATE `is_paid=false, paid_externally=false, paid_at=null, stage='awaiting_payment', payment_confirmed_source=null`.
  - Ao arrastar de "Pago" para outra coluna no Kanban → executa a mesma limpeza.
- Quando `payment_confirmed_source = 'gateway_webhook'`:
  - Ação de reversão fica desabilitada com tooltip "Pagamento confirmado pelo gateway — não pode ser alterado".
  - Drag para fora da coluna Pago é bloqueado no front + rejeitado no trigger.

### 5. Link público do cliente (`TransparentCheckout`)
Nenhuma mudança de regra: continua lendo `is_paid`. Como agora o "desfazer" zera `is_paid`, o link automaticamente volta a mostrar "pendente" quando a marcação manual é revertida.

## Detalhes técnicos
- Índice `CREATE INDEX ON orders (payment_confirmed_source) WHERE payment_confirmed_source IS NOT NULL;` para o Kanban filtrar rápido.
- Trigger em `SECURITY DEFINER` com `SET search_path=public`, permitindo bypass só via role `service_role` (usada pelos webhooks) — evita que um cliente autenticado consiga forçar `gateway_webhook`.
- `OrderCard`/`OrderDetailsDialog` recebem badge visual: cadeado quando `gateway_webhook`, ícone editável quando `manual`.
- Testes: reproduzir cenário live (marca manual → volta coluna → link volta a pendente) e cenário webhook (tenta arrastar → bloqueado, link permanece pago).

## Fora do escopo
- Não altera lógica de baixa de estoque, NF-e, ou envio de mensagens automáticas de pagamento confirmado. Só o **status exibido** e a **possibilidade de reversão**.
