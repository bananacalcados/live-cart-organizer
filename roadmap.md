# Fiscal — CNPJ emissor pelo gateway
- [ ] Mapear emissões automáticas/manuais, NF-e/NFC-e, cancelamentos, correções e devoluções
- [ ] Criar configuração segura gateway→empresa, padrão, interruptor desligado e pendência de CNPJs diferentes
- [ ] Aplicar seleção e log na emissão sem alterar o comportamento enquanto desligado
- [ ] Adicionar configuração, filtro e CNPJ emissor nas telas fiscais e listas/modais de notas
- [ ] Desativar somente as duas empresas de teste indicadas
- [ ] Testar regras sem emitir notas e simular os últimos 7 dias por CNPJ e pagamentos divididos

# Vínculo ERP ↔ Shopify e de-para de cores
- [x] Rodar relink e refresh dos intents abertos após cada sincronização, retornando o resultado da relink
- [x] Bloquear confirmação do card somente pelos avisos de item definidos, sem duplicar aviso do intent
- [x] Adicionar de-para manual de cores em Estoque → Códigos e religar após salvar
- [x] Testar regras, rodar a sincronização uma vez e informar o jsonb retornado

# Rastreio do contrato próprio dos Correios
- [x] Ligar envios próprios à consulta oficial sem expor transportadora/código real
- [x] Manter Frenet e etapas existentes; testar com envio real e sem publicar

# Auditoria de cadastro e carrinho da live
- [x] Conferir registros reais de cadastro, confirmação e fila de mensagens
- [x] Auditar identificação de pedidos e reproduzir as telas sem cadastrar ou enviar
- [x] Entregar achados comprovados, riscos e próximos passos sem reenvios automáticos

# Reemissão de logística reversa
- [ ] Conferir vínculo da compra, itens e conversa das clientes restantes; separar dúvidas
- [ ] Reemitir somente casos comprovados com NF-e e código; preservar prazo original
- [ ] Enviar código e DANFE espaçados, confirmar registro e listar resultados
- [ ] Andreia fora (Frenet); Gilda e Michelly já enviadas, não reenviar

# Promoções progressivas — reaproveitamento
- [x] Listar e buscar promoções de outras lives, com resumo
- [x] Copiar promoção e produtos sem alterar a original, tratando nome duplicado
- [x] Vincular a cópia ao catálogo e às ofertas da live atual e informar divergências
- [x] Testar “3 por 200” de 05/11 para 07/11 e conferir os vínculos

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
