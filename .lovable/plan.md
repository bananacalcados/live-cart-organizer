# AustPay (Rinne) como 4º gateway — Pix + Cartão, em fases

Objetivo: ter **Pix e Cartão** pela AustPay nos três pontos (Área de Membros da Live, Checkout Transparente do WhatsApp no PDV, PDV > Online > Criar Link de Pagamento) sem quebrar nada do que já funciona.

## Antes de tudo: o Mercado Pago é o gateway principal

Isso muda a estratégia em três pontos e vale como regra para todas as fases:

1. **O MP continua sendo o primeiro da fila em 100% dos casos.** A AustPay nunca entra na frente dele, nem em teste. Ela só é acionada quando o MP já respondeu (aprovado nunca chega nela; recusado/erro sim).
2. **Qualidade da integração do MP é um ativo.** O MP pontua a conta pela qualidade dos dados enviados (device id, payload completo, external_reference). Mandar menos volume pra ele ou mudar o formulário do cartão pode derrubar essa nota e piorar aprovação. Por isso o formulário atual **não muda** — a AustPay se adapta ao que já existe, e não o contrário.
3. **Risco de "só funcionar na AustPay".** Se adotássemos o campo seguro da Rinne (rinne-js) no formulário principal, o número do cartão passaria a sair criptografado só pra eles e o MP deixaria de conseguir cobrar — a cascata quebraria no sentido inverso. A solução está na Fase 3 abaixo: o campo seguro é montado **só no momento em que a AustPay é chamada**, nunca antes.

## Fase 0 — Credenciais e ambiente (sem tocar em código de venda)

- Guardar chave de API (sandbox e produção) e merchantId da AustPay.
- Chave mestra de liga/desliga: nasce **desligada**.
- Confirmar com a AustPay a liberação do rinne-js (hoje em beta fechado) — necessário só para a Fase 3.

Nada visível ao cliente. Nenhuma venda afetada.

## Fase 1 — Pix pela AustPay (sem SDK, sem mexer no formulário)

Pix não exige SDK: é chamada de servidor, igual ao MP.

- Nova função de cobrança Pix na AustPay (valor em centavos, request_id único por tentativa, expiração).
- Entra na cascata de Pix **depois** do MP: se o MP falhar em gerar o QR, tenta AustPay.
- Webhook de status (criado / aprovado / estornado / disputa) com validação de assinatura, gravando no pedido igual aos outros gateways.
- Teste no sandbox, depois uma venda real controlada.

Risco: baixo. Se a AustPay não responder, o comportamento é exatamente o de hoje.

## Fase 2 — Consulta, conciliação e estorno

Antes de colocar cartão, a AustPay precisa estar visível na operação:

- Consulta de pagamento por pedido (hoje só olha o MP).
- Estorno total e parcial.
- Rótulo "AustPay" nos relatórios, dashboards e detalhes de pagamento.

Sem isso, um pagamento AustPay vira "pedido órfão" no dia a dia.

## Fase 3 — Cartão pela AustPay, sem quebrar o MP

A regra de ouro: **o formulário continua sendo o nosso**, com os campos atuais. A cascata roda como hoje (MP → AppMax → Pagar.me). A AustPay entra como último degrau e, só nesse instante, o dado do cartão é entregue ao campo seguro da Rinne.

Dois caminhos possíveis, a decidir quando o SDK for liberado:

- **A) Retentativa com campo seguro** — se todos os gateways recusarem, o checkout mostra "vamos tentar por outro meio" e abre o campo seguro da Rinne já preenchido pelo cliente (uma redigitação rápida do cartão). Aprovação extra sem qualquer risco para o MP.
- **B) Campo seguro em paralelo, invisível** — os dados do cartão alimentam ao mesmo tempo o nosso fluxo (MP/AppMax/Pagar.me) e o campo seguro da Rinne, que fica pronto em segundo plano. Se a cascata inteira recusar, a AustPay é chamada sem pedir nada ao cliente. Depende de o SDK permitir esse uso; validamos no sandbox antes de decidir.

Em ambos, se o rinne-js não carregar, o checkout simplesmente termina como hoje — sem a etapa AustPay.

- 3DS: ligar a política "recusar quando o banco pedir desafio" no começo, para não travar venda; revisar depois com dados reais.

## Fase 4 — Ajuste fino

- Medir aprovação por gateway e por canal antes/depois.
- Só então avaliar mudar ordem da cascata — e apenas com número na mão, nunca por impressão.
- Cartão salvo (cards on file) da AustPay como possibilidade futura para recompra/crediário.

## Ordem e segurança

Fase 0 → 1 → 2 → 3 → 4, uma por vez. Cada fase sobe desligada e é ativada por chave; nenhuma função atual de MP, AppMax ou Pagar.me é alterada — só adicionamos caminhos novos. Qualquer problema se resolve desligando a chave, e o sistema volta ao estado de hoje na hora.

## Detalhes técnicos

- Base: `https://api-sandbox.rinne.com.br/core` e `https://api.rinne.com.br/core`; header `x-api-key`.
- `POST /v1/transactions`: `provider`, `request_id` (idempotência), `amount` em centavos, `currency: BRL`, `capture_method: ECOMMERCE`, `payment_method: PIX | CREDIT_CARD | DEBIT_CARD`, `installments`.
- Cartão exige `card_data.number`/`cvv` criptografados pelo rinne-js (prefixo `ev:`); PAN cru retorna 400 VALIDATION_ERROR.
- Pix: `pix_data.expiration_in_seconds`; BolePix via `boletopix_data`.
- Webhooks: `transaction.created`, `transaction.status-changed`, `dispute.*`.
- Novas edge functions (`austpay-create-pix`, `austpay-webhook`, `austpay-charge-card`) + módulo compartilhado de cliente HTTP; nenhuma função MP/Pagar.me tocada.
