# Retirada na Loja — fluxo completo com loja, data e aviso no PDV

## Respostas rápidas (como está hoje)

- O botão **Retirar Loja** só aparece quando o pedido já está **pago** e na coluna **PAGO**. Correto.
- Ao clicar, **não** aparece seleção de loja: o pedido só muda para "Aguardando Retirada" e grava `retirada` como forma de entrega. A loja usada é sempre a loja padrão do evento.
- **Não** existe campo de data da retirada.
- **Não** existe nenhum aviso na tela do PDV da loja física.

## O que será construído

### 1. Botão "Retirar na loja" disponível antes do pagamento

O botão passa a aparecer também em pedidos **não pagos** (ao lado de "PAGO" e "Pagar na entrega"), além de continuar na coluna PAGO.

### 2. Assistente de retirada (novo modal, em etapas)

1. **Pagamento**: "Já foi pago" ou "Vai pagar na loja".
   - "Já foi pago" abre o modal atual de forma de pagamento (PIX, dinheiro, cartão…) e marca o pedido como pago.
   - "Vai pagar na loja" mantém o pedido em aberto e sinaliza pagamento na retirada.
2. **Loja da retirada**: lista das lojas físicas ativas.
3. **Data prevista da retirada**: seletor de data (obrigatório).
4. Resumo e confirmação.

Tudo fica salvo no pedido e é copiado para a venda no PDV.

### 3. Roteamento para a loja escolhida

A venda entra na loja selecionada no assistente (não mais só na loja padrão do evento), aparecendo na aba **Expedição** daquela loja, com etiqueta de "Retirada na loja" e a data prevista visível no card. Quando o pagamento fica para a loja, a venda entra como pendente de pagamento (aba Retiradas), mantendo o comportamento atual de faturamento.

### 4. Notificação na tela do PDV da loja física

Um aviso flutuante aparece no PDV da loja escolhida:

- **Na hora** em que o pedido é enviado para a loja;
- **De novo no dia agendado** da retirada (ao abrir o PDV naquele dia, e em tempo real caso já esteja aberto).

O aviso mostra cliente, itens/valor e a data, com botão **VER PEDIDO** que leva direto à aba Expedição já filtrada naquele pedido. Cada aviso pode ser dispensado individualmente por loja e por dia, para não ficar repetindo.

## Detalhes técnicos

- **Banco**
  - `orders`: novos campos `pickup_store_id`, `pickup_date`, `pickup_pay_at_store` (booleano).
  - `pos_sales`: novos campos `pickup_date` e `is_store_pickup` para a Expedição e para o aviso.
  - Nova tabela `pos_pickup_alerts` (loja, venda, pedido, tipo do aviso `created` | `due_date`, data alvo, dispensado por/quando) com GRANTs + RLS para `authenticated`, e realtime habilitado.
  - Trigger/gatilho ao criar a venda de retirada: insere o alerta `created` e o alerta `due_date` da data agendada.
- **Frontend**
  - Novo `StorePickupWizard.tsx` (reusa `MarkOrderPaidDialog` internamente) chamado pelo `Retirar na loja` em `OrderCardDb.tsx`, substituindo o `handlePickup` direto.
  - `event-order-route-to-pos`: passa a respeitar `orders.pickup_store_id` como loja de destino e propaga `pickup_date` / `is_store_pickup` para `pos_sales`.
  - Novo `usePickupAlerts` + componente de aviso montado em `src/pages/POS.tsx`, escopado por `selectedStore`, com assinatura realtime em `pos_pickup_alerts` e consulta dos alertas do dia; botão VER PEDIDO troca a seção para `expedition` com o `sale_id` focado.
  - `POSExpedition.tsx`: aceita foco por `sale_id` e exibe badge "RETIRADA — <data>".
