# Sincronização Shopify ↔ Módulo Eventos

## 1) Diagnóstico do estado atual

**O que já existe:**
- Edge function `shopify-create-order`: cria o pedido na Shopify quando o card vai pra coluna "Pago". Retorna `shopifyOrderId` + `shopifyOrderName`.
- Edge function `shopify-cancel-live-order`: já cancela pedido na Shopify, mas hoje só é usada no fluxo de "Revisão de Duplicatas Live" (tabela `shopify_live_order_syncs`), não no card de eventos.
- Tabela `orders` (módulo eventos): possui apenas a coluna `shopify_order_name` (ex: `#10523`). **Não persiste o `shopify_order_id` numérico** — que é exatamente o que a API Admin precisa pra cancelar/editar/deletar.
- Frontend: ao criar o pedido, só salva `shopify_order_name` na linha do `orders` e dispara um evento `shopify-order-created`. Joga fora o `shopifyOrderId`.

**Por isso hoje é impossível, pelo nosso sistema:**
1. Editar o pedido na Shopify após pago (não há fluxo, e nem temos o ID guardado).
2. Apagar/cancelar o pedido da Shopify (não temos o ID, e o botão não existe na UI do card).
3. Desvincular o pedido Shopify do card de eventos (nenhum botão limpa `shopify_order_name`).

## 2) O que é possível tecnicamente

| Pedido do usuário | Viável? | Observação |
|---|---|---|
| Atualizar pedido Shopify a partir das edições no nosso sistema | **Parcialmente** | A Shopify **não permite editar pedidos já pagos** via API REST de forma direta (linhas, preços, totais ficam congelados após pagamento). Existem 2 caminhos válidos: **(A) Cancelar + recriar** o pedido (mais simples e confiável), ou **(B) Order Editing API** via GraphQL (mais complexa, exige `orderEditBegin/orderEditAddVariant/orderEditCommit`, e tem limitações). Recomendo **(A)** porque já temos `create-order` e `cancel-live-order` funcionando. |
| Apagar pedido na Shopify pelo nosso sistema | **Sim** | Via API REST: `POST /orders/{id}/cancel.json` (cancela) e/ou `DELETE /orders/{id}.json` (apaga, só funciona se já cancelado). Função de cancelar já existe — basta um wrapper genérico para o módulo eventos. |
| Desvincular pedido Shopify do card | **Sim** | Apenas limpar `shopify_order_name` (e novo `shopify_order_id`) na linha do `orders`. Trivial. |
| Recriar pedido após desvincular | **Sim** | Já é o que acontece hoje quando movemos pra "Pago" — basta o botão "Criar pedido na Shopify" ficar disponível quando o vínculo estiver vazio. |

## 3) Plano de implementação

### Passo 1 — Migration (banco)
Adicionar `shopify_order_id` (text) à tabela `orders` para guardarmos o ID numérico, indispensável para todas as operações.

### Passo 2 — Persistir o ID na criação
- `OrderCardDb.tsx` e `OrderDialogDb.tsx`: ao chamar `shopify-create-order`, salvar **tanto** `shopify_order_name` **quanto** `shopify_order_id` retornados.
- Backfill opcional: para pedidos antigos com `shopify_order_name` mas sem `shopify_order_id`, criar uma rotina que busca por nome via `GET /orders.json?name=#10523` e preenche.

### Passo 3 — Nova edge function `shopify-delete-event-order`
Recebe `{ orderId }` (id do `orders` no nosso banco). Lê `shopify_order_id`, chama:
1. `POST /orders/{id}/cancel.json` (cancela / restock=false / email=false)
2. `DELETE /orders/{id}.json` (apaga de fato)
3. Limpa `shopify_order_id` e `shopify_order_name` na linha do `orders`.

Permissão: admin ou manager (mesmo padrão do `shopify-cancel-live-order`).

### Passo 4 — Nova edge function `shopify-update-event-order` (estratégia cancel+recreate)
Recebe `{ orderId }`. Faz:
1. Cancela + apaga o pedido Shopify atual (reusa lógica do passo 3).
2. Recria via `shopify-create-order` com os dados **atuais** do `orders` (já editados no nosso sistema).
3. Atualiza `shopify_order_id` + `shopify_order_name` com os novos valores.

Importante: avisar visualmente que o número do pedido na Shopify **vai mudar** (ex: era `#10523`, vira `#10524`). Isso é inevitável nesse caminho.

### Passo 5 — UI no card do pedido (`OrderCardDb.tsx`)
Quando `shopify_order_name` estiver presente, adicionar um menu (3 pontinhos) na badge "Shopify #XXXX" com:
- **Atualizar pedido na Shopify** → chama `shopify-update-event-order` (com confirmação avisando que o número vai mudar).
- **Desvincular** → só limpa `shopify_order_id` + `shopify_order_name` no nosso banco. Pedido permanece na Shopify.
- **Apagar pedido na Shopify** → chama `shopify-delete-event-order` (confirmação dupla).

Quando **não** houver `shopify_order_name`, o card já mostra a opção de "Criar pedido na Shopify" (comportamento atual mantido).

### Passo 6 — Permissões e auditoria
- Restringir as 3 ações a admin/manager.
- Logar cada operação numa tabela `shopify_event_order_audit` (action, order_id, shopify_order_id, user_id, result, timestamp) pra rastrear.

## 4) Detalhes técnicos relevantes

- **Order Editing API (alternativa B)**: se no futuro quisermos manter o **mesmo número** do pedido na Shopify ao editar, dá pra trocar a estratégia do passo 4 por `orderEditBegin → orderEditAddVariant / orderEditSetQuantity → orderEditCommit` (GraphQL Admin). Mas tem restrições: não permite trocar cliente, endereço, nem alterar pagamento já capturado. Como vocês geralmente trocam **produto/tamanho** (que mexe nas line items), a Order Editing API funcionaria, mas é bem mais código. Sugestão: começar com cancel+recreate e migrar pra Order Editing só se o "número novo a cada edição" incomodar.
- **Pedido pago + estoque**: ao cancelar com `restock:false` + `email:false` + recriar, evitamos email duplicado pro cliente e duplicação de movimentação de estoque. Confirmar essa configuração no payload.
- **Webhook**: o `shopify-webhook` continua funcionando normalmente — vai receber o cancel e o create do novo pedido, e qualquer downstream (RFM, expedição) já lida com isso.

## 5) Arquivos afetados

- `supabase/migrations/<nova>.sql` (adiciona `orders.shopify_order_id`)
- `supabase/functions/shopify-delete-event-order/index.ts` (nova)
- `supabase/functions/shopify-update-event-order/index.ts` (nova)
- `supabase/functions/shopify-create-order/index.ts` (sem mudança, mas validar retorno)
- `src/components/OrderCardDb.tsx` (menu de ações + persistir `shopify_order_id`)
- `src/components/OrderDialogDb.tsx` (persistir `shopify_order_id` ao criar)

## 6) Pergunta antes de eu implementar

Quer que eu siga com **cancel + recreate** (mais simples, número novo a cada edição) ou prefere a **Order Editing API** (mantém o mesmo número, mas leva ~2x mais tempo pra implementar)?
