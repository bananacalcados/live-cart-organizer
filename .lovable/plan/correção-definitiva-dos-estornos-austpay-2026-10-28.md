# Correção definitiva dos estornos AustPay

## Consulta real concluída, sem efeito financeiro
- Adriana: CAPPTA, CREDIT_CARD, APPROVED, aprovação em 27/10/2026 às 17:04:46 de São Paulo, 10 parcelas, Mastercard final 2578, refunds vazio, refunded_amount 0.
- automatic_anticipation=true; ledger_entries não trouxe entradas. A janela desta cobrança precisa ser estimada: liquidação em 28/10, encerramento em 27/10 às 23:59:59.
- Documentação confirma payment_date (data prevista), settled, fully_settled_at, last_clearing_at e automatic_anticipation. Não afirmar que uma estimativa prova liquidação real.

## Implementação
1. Restaurar exclusivamente a rota direta de merchant; integral sem refund_amount, com identificação BCREF e metadata. Separar mensagens de regra de negócio, permissão e conflito; respostas incertas continuam sem repetição.
2. Calcular e mostrar a janela antes da execução e aprovação. Usar a menor data de TRANSACTION; bloquear liquidação existente; fallback antecipado com dias úteis/feriados nacionais. Prazo desconhecido bloqueia execução até conferência, sem inventar data.
3. Registro manual para todos os gateways, exclusivo admin com senha validada no servidor, protocolo e data não futura. Identificar cobrança pela compra, limitar valor, impedir concorrência/duplicidade e reaproveitar solicitação pendente na mesma linha.
4. Reconhecer concluido_manual em comprovantes, envio manual de WhatsApp, badges e histórico. PDF informa que é registro manual com protocolo; não consultar API de devolução nesse caminho.
5. Ocultar falhas no histórico por padrão com interruptor Mostrar falhas, preservando os registros.

## Consultas e segurança
- Estornos mantém três chamadas paginadas ao abrir, repetidas apenas por filtros/ações, sem novo polling.
- Novo estorno: nenhuma busca ao abrir; busca ao digitar; seleção faz até cinco leituras agrupadas e uma elegibilidade em lote, até dez verificações de gateway.
- Janela em solicitação pendente é conferida ao abrir a aprovação, não por consulta individual em cada card.
- Registro manual usa transação com trava por pagamento e escrita somente de serviço; não modifica dados manuais, estoque ou fiscal.

## Verificação e limites
- Testes de rota/body, 400/403/409, datas sexta/sábado/feriado, liquidação, valor/protocolo/data/permissão e concorrência manual.
- Conferir a prévia real e telas com devoluções bloqueadas nos testes. Não estornar, registrar Adriana, enviar mensagem ou publicar o site.
- Entregar campos reais, campos usados, arquivos e limitações de verificação.