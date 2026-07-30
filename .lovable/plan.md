## Objetivo

Pagar direto na Área de Membros (`/minha-area`), sem redirecionar para o link do checkout — mas **reaproveitando exatamente** o código da etapa 3 do checkout transparente. O link do checkout continua existindo e funcionando igual.

## Como funciona hoje

- `src/pages/TransparentCheckout.tsx` (2.420 linhas) contém a etapa 3 inteira:
  - `StepPayment` (linha 822): seletor PIX / Crédito / Débito, parcelas, "Alterar forma de pagamento".
  - `PixPaymentForm` (1016): chama `mercadopago-create-pix`, QR Code, polling de status, desconto PIX.
  - `CardPaymentForm` (1177): tokenização Mercado Pago (`src/lib/mercadopago.ts`), BIN/capacidades crédito x débito, 3DS, cascata de gateways, `handlePaymentConfirmed`, Meta Pixel/CAPI.
- `src/pages/LiveMemberArea.tsx` linha 544 apenas redireciona: `window.location.href = checkout_url?method=...`.
- O webhook de pagamento (`payment-webhook`) já marca o pedido como pago pelo `orderId` — como a Área de Membros usará **o mesmo `order.id`**, o pedido move para PAGO no módulo Eventos automaticamente, sem código novo.

## Plano

### 1. Extrair a etapa 3 para um componente compartilhado (sem reescrever nada)
Mover, **sem alterar a lógica**, de `TransparentCheckout.tsx` para `src/components/checkout/PaymentSection.tsx`:
- `StepPayment`, `PixPaymentForm`, `CardPaymentForm`, `calculateInstallmentAmount` e os helpers de formatação/validação que elas usam (`isValidCPF`, `formatCardNumber`, `formatExpiry`, etc.) — estes vão para `src/lib/checkout/formatters.ts`.
- `TransparentCheckout.tsx` passa a importar esses componentes. Comportamento idêntico, zero regressão esperada (mesmo código, só realocado).

### 2. Usar o componente na Área de Membros
Em `LiveMemberArea.tsx`, substituir o redirecionamento por um passo `payment` que renderiza `<StepPayment />` com:
- `orderId` = id do pedido do evento (mesmo id do checkout),
- `orderData` = itens com preço efetivo (com desconto), frete escolhido, total,
- `form` = CustomerFormData montado a partir do cadastro já preenchido no onboarding (nome, telefone, e-mail, CPF, CEP, rua, número, bairro, cidade, UF),
- `pixDiscountPercent` e config de parcelas vindos do mesmo lugar que o checkout usa.

Assim os gateways recebem nome, telefone, e-mail, CPF, endereço completo e valor do frete — porque é literalmente a mesma função de envio.

### 3. Espelhar o cadastro no pedido/checkout
Cada etapa do onboarding (nome → endereço/frete → CPF/e-mail) já grava via `live-member-area`. Ajuste: essa função passa a persistir os mesmos campos que o checkout grava (`customer_registrations` / `pos_customers` / `shipping_info` / `shipping_cost` do pedido), usando os mesmos helpers já existentes. Resultado: abrir o link do checkout depois mostra tudo preenchido, e vice-versa.

### 4. Pós-pagamento
Reusar `handlePaymentConfirmed` do checkout (Meta Pixel/CAPI, dedupe, cross-sell) e, na Área de Membros, exibir a tela de "Pagamento confirmado" com histórico atualizado e o botão da roleta.

## Detalhes técnicos

- Nenhuma edge function nova: `mercadopago-create-pix`, `process-payment`, `payment-webhook` e `checkout-public` são os mesmos.
- Nenhuma tabela nova.
- Risco principal é o refactor de extração; mitigado por mover o código intacto e validar o checkout transparente (PIX, crédito 1x/parcelado, débito) antes de plugar na Área de Membros.
