# Plano: Eventos "site" → PDV direto + Renomear "Tiny Shopify" → "Site/Live"

## Objetivo
Eliminar o gargalo em que eventos de canal `site` só viram receita no PDV quando alguém aperta "Criar na Shopify". Passar a rotear **automaticamente** todo pedido pago de evento `site` para `pos_sales` da loja Site/Live como `sale_type='live'`, aparecendo no **Faturamento Live** da loja. E renomear a loja em todo o sistema.

---

## Etapa 1 — Roteamento automático de eventos `site` para o PDV

**Migration (ajuste do trigger `trg_route_paid_event_order_to_pos`):**
- Remover a condição que ignora `channel = 'site'`.
- Para eventos `site` sem `default_store_id`, forçar `store_id = '2bd2c08d-321c-47ee-98a9-e27e936818ab'` (Site/Live).
- Chamar `event-order-route-to-pos` também para esses casos → grava `pos_sale` com `sale_type='live'`, `revenue_attribution='store'`, `status='paid'` quando pago.

**Ajuste em `event-order-route-to-pos/index.ts`:**
- Aceitar eventos `site`: se `channel='site'` e não há `default_store_id`, usar o UUID da Site/Live e `seller_id = null` (sem vendedora de balcão para online).
- Manter mesma lógica de resolução de `pos_customer`, itens e address.

## Etapa 2 — Corrigir dupla contagem em `get_sales_vs_goals`

Migration atualizando a CTE que soma vendas da loja **Site/Live**:
- Excluir `sale_type IN ('live','live_shopping')` do `realizado_loja_pura` da Site/Live (mesma regra já aplicada em Pérola/Centro).
- `shopify_mais_live` continua somando Shopify puro + total Live (agora incluindo eventos `site` roteados).

## Etapa 3 — Renomear loja "Tiny Shopify" → "Site/Live"

**Migration data:**
```sql
UPDATE pos_stores SET name = 'Site/Live' WHERE id = '2bd2c08d-...';
```

**Frontend:** procurar strings hardcoded "Tiny Shopify" e trocar por "Site/Live" (labels de UI apenas — UUIDs permanecem intocados). Arquivos identificados: componentes de dashboard, expedição, trocas, metas, estrategista. Todos consomem `pos_stores.name` via query em sua maioria, então o UPDATE já resolve; ajustes de string ficam só onde o nome está literal no código.

**`concierge-respond`:** não será alterado (usuário confirmou que não é mais usado).

## Etapa 4 — Validação

- Criar um pedido pago fictício em um evento `site` de teste → conferir que aparece no Dashboard Geral do PDV, aba **Faturamento Live** da Site/Live.
- Rodar `get_sales_vs_goals` no mês corrente → conferir que `shopify_mais_live` não duplica e que `realizado_loja_pura` da Site/Live continua só com online "puro" (não-live).
- Verificar `EventsDashboard` intacto (não muda cálculo por evento).

## O que NÃO muda
- Estoque (fica pra próxima conversa, conforme pedido).
- `pos_sales`, `orders`, `events`, `pos_goals` — sem DDL.
- Webhook Shopify, expedição, trocas, fiscal — só recebem mais dados, sem mudança de comportamento.
- Módulo Eventos e `get_events_performance` — intactos.

## Detalhes técnicos
- 1 migration: trigger + `get_sales_vs_goals` + UPDATE do nome da loja.
- 1 edge function editada: `event-order-route-to-pos`.
- Ajustes de strings "Tiny Shopify" → "Site/Live" em componentes que têm o texto literal (varredura via ripgrep antes de editar).
