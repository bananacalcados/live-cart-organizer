# Promoções progressivas — reaproveitamento
- [ ] Listar e buscar promoções de outras lives, com resumo
- [ ] Copiar promoção e produtos sem alterar a original, tratando nome duplicado
- [ ] Vincular a cópia ao catálogo e às ofertas da live atual e informar divergências
- [ ] Testar “3 por 200” de 05/11 para 07/11 e conferir os vínculos

# Segurança — Fase 4
- [x] A1 shopify-create-order: só pedido pago, dados do banco, auth
- [x] A2 shopify-create-live-order: idem
- [x] A3 mercadopago-check-payment: referência E valor
- [x] A4 mercadopago-create-pix: desconto do servidor, override admin
- [x] A5 pagarme-create-charge: valor do body só comparado
- [x] A6 split-payment: total comparado, auth nas mutações
- [x] A7 shopify-webhook: HMAC obrigatório
- [x] A8 checkout-public: update_sale restrito, lookup CPF
- [x] A9 payment-confirmed-hook: só pedido pago
- [x] A10 yampi-create-payment-link / mp-create-boleto / austpay-charge-card
- [ ] B11–B14 destrutivas e conta
- [ ] C15–C17 disparos e mensageria
- [ ] D18 gasto e IA

## Fase 4 — status
- [x] A pagamento/pedidos (implantado)
- [x] B destrutivas/conta (implantado; rotinas fiscais migradas p/ segredo interno)
- [x] C disparo/mensagens (implantado; código da live com limite 3/h telefone, 10/h IP)
- [x] D IA/gasto (implantado; limite de uso por IP)
- [ ] Pendências: validação de assinatura nos webhooks WhatsApp (item 17); identidade do livete-respond (14); valores server-side em Yampi/boleto; split-payment por token de sessão; shopify-webhook precisa do segredo do painel Shopify; botão antigo de pedido Shopify da live (LiveSessionManager); replay MP/Pagar.me com 0 falso negativo
