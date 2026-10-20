# Estornos Appmax no fluxo existente

## Entrega
- Habilitar Appmax em Novo estorno e na confirmação, mantendo senha, permissões, interruptor, aprovação e travas atuais.
- Confirmar o pagamento real antes de escolher o gateway: Mercado Pago aprovado prevalece; Appmax precisa estar pago na conta correta. Preservar pedido da live convertido em venda.
- Reutilizar comprovante, envio manual e selos; identificar Appmax e nunca inventar E2E.
- Desativar o estorno solto da Rinne com resposta 410. Não executar estornos reais nem enviar mensagens.

## Segurança da integração
- Conferir a documentação oficial dos dois modelos de conta Appmax antes de implementar chamadas de reembolso. Endpoint ou comportamento não documentado fica bloqueado, não presumido.
- Suporte a parcial determina se o valor pode ser editado. Não aplicar limite de dias sem documentação.
- Falhas de rede/5xx ficam em verificação; confirmar valores já devolvidos antes de qualquer repetição.
- Webhook só conclui solicitações existentes após conferência na API; não altera o comportamento atual de pagamento do pedido/venda.

## Detalhes técnicos
- Extrair adaptadores em `_shared/refund-gateways/mercadopago.ts` e `appmax.ts`, com interface para consultar pagamento, executar e acompanhar estorno.
- Escolher adaptador na função existente e no worker de dois minutos, sem cron novo nem alteração de consultas do chat.
- Preservar a lógica Mercado Pago por extração, com testes de regressão.
- Resolver credenciais AppStore/legado pelo registro da tentativa e consulta do pedido; ambiguidade bloqueia.
- A aba mantém as três consultas paginadas iniciais e atualização em tempo real, sem polling. A busca de compras continua sob demanda; elegibilidade mantém teto de dez candidatos por chamada, com consultas locais em lote e leituras limitadas nas operadoras.

## Validação e publicação
- Rodar os testes Mercado Pago e novos testes de escolha de gateway, estorno parcial, repetição incerta e Rinne desativada.
- Consultar elegibilidade real dos três casos pedidos: códigos MP+Appmax, live paga Appmax e pedido Appmax não pago.
- Conferir no navegador as informações de elegibilidade/confirmacão, sem clicar em executar.
- Confirmar que `gateway_refunds` continua com um registro e publicar ao final.
- Relatar endpoints/campos efetivamente confirmados, suporte a parcial, arquivos alterados e qualquer bloqueio de documentação ou teste.