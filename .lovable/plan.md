
# Adicionar Data do Pedido e Transportadora na Expedição Beta

## Contexto
Os pedidos vêm do Tiny (que não tem info de transportadora), mas originam na Shopify (que tem `shipping_lines` com transportadora e serviço). O campo `numero_ecommerce` do Tiny corresponde ao `order_number` da Shopify, permitindo cruzar os dados.

## Mudancas

### 1. Adicionar coluna `shipping_method` na tabela `expedition_beta_orders`

Nova coluna `shipping_method TEXT` para armazenar a transportadora (ex: "Correios - SEDEX", "JADLOG - .Package").

### 2. Criar Edge Function `expedition-enrich-shipping`

Uma funcao que:
- Busca pedidos em `expedition_beta_orders` onde `shipping_method IS NULL` e `shopify_order_id` nao começa com `tiny-`
- Para cada pedido, consulta a Shopify Admin API: `GET /admin/api/2025-07/orders.json?name={order_number}&fields=id,name,shipping_lines`
- Extrai `shipping_lines[0].title` (ex: "Correios - SEDEX") e atualiza a coluna `shipping_method`
- Processa em lotes para respeitar rate limits da Shopify

### 3. Atualizar `expedition-beta-initial-sync`

Apos a sincronizacao do Tiny, chamar automaticamente a funcao de enriquecimento de shipping para os pedidos recem-importados que possuem `numero_ecommerce` (indicando origem Shopify).

### 4. Atualizar `shopify-webhook` (pedidos novos)

Quando um pedido chega via webhook da Shopify, ja salvar `shipping_method` direto do payload `shipping_lines[0].title`, evitando a necessidade de consulta posterior.

### 5. Atualizar UI `BetaOrdersList.tsx`

No componente `BetaOrderRow`:
- Adicionar a **data do pedido** (`shopify_created_at`) formatada em DD/MM/YYYY ao lado do nome do cliente
- Exibir a **transportadora** como um Badge colorido:
  - Vermelho/destaque para "SEDEX" e "MOTOTAXISTA" (prioridade alta)
  - Azul para "PAC" (prioridade normal)
  - Cinza para outros

### 6. Ordenacao por prioridade na Separacao (`BetaPickingList`)

Na aba de separacao, ordenar pedidos automaticamente priorizando:
1. SEDEX e MOTOTAXISTA primeiro
2. Depois PAC e outros

## Fluxo tecnico

```text
Shopify (pedido com shipping_lines)
  |
  v
Tiny ERP (recebe pedido, perde info de frete)
  |
  v
expedition-beta-initial-sync (puxa do Tiny)
  |
  v
expedition-enrich-shipping (cruza com Shopify via order_number)
  |
  v
expedition_beta_orders.shipping_method = "Correios - SEDEX"
```

## Impacto
- Pedidos existentes: preenchidos automaticamente pela funcao de enriquecimento
- Pedidos novos via webhook: ja vem com shipping_method
- Pedidos novos via sync Tiny: enriquecidos apos importacao
- Frontend: mostra data + transportadora com prioridade visual
