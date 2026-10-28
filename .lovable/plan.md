# Estorno AustPay no sistema

## Expedição conferida primeiro
- Os 90 pedidos pagos da live da Pérola de 27/10 chegaram ao PDV: 89 estão ativos e um foi cancelado.
- Dos ativos, 62 vendas estão na etapa Conferência e 27 em Separação. Produtos de uma mesma venda podem estar em etapas diferentes.
- Os contadores menores vinham de um corte na leitura dos produtos antigos. A correção já foi conferida na tela, sem mover, excluir ou recriar pedidos.

## Próxima fase: estorno integral AustPay
- Usar a mesma tela de Estornos, sem reativar o caminho antigo de devolução avulsa.
- Buscar a cobrança exata no pedido da live ou na venda vinculada, confirmar produção, valor capturado, identidade da transação e histórico de estornos na operadora.
- Liberar inicialmente o integral. Parcial continuará bloqueado enquanto as condições e a operadora dessa cobrança não puderem ser verificadas com segurança.
- Manter permissões, aprovação por administrador, trava por cobrança e registro de todas as tentativas.
- Solicitação pendente ou resposta incerta fica em acompanhamento, sem enviar novamente a devolução.
- Gerar comprovante somente após confirmação real de conclusão e permitir baixar/enviar pela ação existente.

## Adriana
- Preparar a devolução integral de R$ 359,99 por desistência do modelo antes do envio.
- Conferir novamente a cobrança antes da execução; não cancelar pedido nem marcar devolvido antes da confirmação da operadora.
- Não realizar devoluções reais durante testes. A execução real será uma ação separada, identificando cliente, valor e motivo.

## Detalhes técnicos
- Adicionar adaptador AustPay no fluxo `mp-refund`, resolvendo também os pedidos convertidos em venda.
- Reusar `gateway_refunds`, o worker existente e os serviços compartilhados de comprovante; sem criar novo cron.
- Validar o contrato oficial de consulta, histórico e solicitação de estorno; enviar valor explícito em centavos.
- Conferir autorização, ambiguidade, concorrência, aprovação, conclusão, falha e resposta incerta em testes sem movimentar dinheiro; validar a prévia real da Adriana na tela.
- A prévia fará consultas limitadas à compra selecionada, apenas ao abrir ou atualizar; não haverá consultas periódicas novas.

## Limites
- Não publicar o site.
- Não alterar Mercado Pago, Appmax, Pagar.me, automações ou modos de live além do encaixe necessário no fluxo de estornos.