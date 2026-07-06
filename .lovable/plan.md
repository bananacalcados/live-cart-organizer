# Eventos multi-loja + roteamento manual de pedido pago

## Objetivo
Permitir que um evento seja atribuído a **duas lojas físicas ao mesmo tempo**. Nesses eventos, o pedido pago **não** vai automaticamente pro PDV: aparece um **botão no card** onde se escolhe **qual loja** e **qual vendedora** (vendedoras reais da loja física) fez a venda. A venda entra na aba **PEDIDOS** com tag **Live** + nome da vendedora, conta no faturamento da loja como **Faturamento Live** e no faturamento da vendedora — **sem somar em dobro**.

## Como funciona hoje (auditoria)
- `events` guarda **uma** loja em `default_store_id` + `channel` (`site` / `pos_perola` / `pos_centro`). Config em `src/pages/Events.tsx` e `src/components/events/EventSetupWizard.tsx` via mapa `STORE_BY_CHANNEL`.
- Ao pagar, o trigger `trg_route_paid_event_order_to_pos` (migration `20260520194043`) chama a edge function `event-order-route-to-pos`, que cria a venda em `pos_sales` **automaticamente** usando uma vendedora virtual fixa (`LIVE_SELLER_BY_STORE`).
- `SendToPOSDialog.tsx` já é um envio manual, mas usa loja única e a **mesma vendedora virtual fixa**.
- Dashboard (`POSGeneralDashboard.tsx`): o faturamento da loja é a **soma de cada linha `pos_sales` uma única vez**. Ou seja, uma venda de live vinculada a loja+vendedora conta **uma vez** naturalmente. "Faturamento Live" e "por vendedora" são apenas recortes das mesmas linhas.
- Folha (`src/lib/pos/payroll.ts`): vendas `sale_type='live'` hoje são **rateadas** entre participantes por loja (ignoram `seller_id`). Precisa passar a atribuir direto quando houver vendedora real escolhida.

## Mudanças

### 1. Banco (migration)
- Adicionar em `events`:
  - `store_ids uuid[]` — lista de lojas do evento (multi-loja).
  - `manual_pos_routing boolean default false` — quando true, desliga o auto-route.
- Atualizar o trigger `trg_route_paid_event_order_to_pos` para **`RETURN NEW` imediatamente quando `manual_pos_routing = true`** (eventos multi-loja não auto-roteiam). Eventos de loja única continuam idênticos.

### 2. Configuração do evento (multi-loja)
Em `src/pages/Events.tsx` e `src/components/events/EventSetupWizard.tsx`:
- Trocar o `Select` único de "Canal de venda" por opção de escolher **Site** OU **uma/duas lojas físicas** (checkboxes: Loja Pérola, Loja Centro).
- Ao salvar:
  - 1 loja física → comportamento atual (`default_store_id` setado, `manual_pos_routing=false`).
  - 2 lojas físicas → `store_ids = [pérola, centro]`, `default_store_id = null`, `manual_pos_routing=true`, `channel` marcado como físico (não `site`).
  - Site → como hoje.

### 3. Card do pedido (roteamento manual)
Em `src/components/OrderCardDb.tsx`:
- Detectar evento multi-loja (`manual_pos_routing` / `store_ids.length > 1`).
- Nesses casos, em vez do texto "vai automaticamente para o PDV", mostrar botão destacado **"Enviar Pedido Pago ao PDV"** que abre o dialog abaixo (habilitado quando pago).

Em `src/components/SendToPOSDialog.tsx` (evoluir):
- **Loja**: restringir as opções às lojas do evento (`store_ids`).
- **Vendedora**: novo `Select` carregado de `pos_sellers` (`store_id = loja escolhida`, `is_active`, excluindo vendedoras virtuais via `isVirtualSeller`). Recarrega ao trocar de loja.
- Ao enviar: criar `pos_sales` com `store_id` = loja escolhida, `seller_id` = **vendedora real escolhida**, `sale_type='live'`, `revenue_attribution='store'`, `status='paid'` + `paid_at` (pedido já pago), `event_id`, `source_order_id`, `notes` com tag Live + nome da vendedora; setar `orders.pos_sale_id`. O pedido passa a aparecer na aba PEDIDOS com origem Live e a vendedora vinculada.

### 4. Dashboard sem dupla contagem
- **Total da loja**: nenhuma mudança — como é 1 linha em `pos_sales`, já entra **uma única vez** no total da loja.
- Adicionar em `POSGeneralDashboard.tsx` um card/recorte **"Faturamento Live"** = soma de linhas `sale_type='live'` da loja (é um recorte do total, **não** soma por cima).
- **Folha** (`payroll.ts`): ajustar `computePayroll` para que vendas `live` **com vendedora real mapeada** sejam atribuídas **direto** à vendedora (canal `live_perola`/`live_centro`) e **removidas do pool** de rateio. Vendas `live` sem vendedora real (virtual) seguem no rateio/participantes como hoje. Assim a venda da Valéria conta 1x pra ela e não é rateada de novo. Atualizar `src/test/payroll.test.ts`.

## Garantias / não quebrar nada
- Eventos de loja única e de site: fluxo inalterado (auto-route e Shopify seguem iguais).
- Uma linha `pos_sales` por pedido → total da loja sempre conta 1x; "Faturamento Live" e "por vendedora" são recortes.
- Dedup do pool na folha evita contar a live 2x.

## Detalhes técnicos
- IDs de loja: Pérola `1c08a9d8-...e9f2`, Centro `4ade7b44-...468e29`.
- `pos_sellers`: colunas `store_id`, `is_active`, `name` (filtrar virtuais com `isVirtualSeller`).
- Regenerar `types.ts` após a migration antes de usar `store_ids`/`manual_pos_routing` no código.

## Validação
- Criar evento com 2 lojas → confirmar que pedido pago **não** cria `pos_sales` sozinho.
- Usar o botão no card → escolher loja + vendedora → confirmar venda em PEDIDOS com tag Live + vendedora, e `pos_sale_id` no pedido.
- Dashboard da loja: faturamento sobe **uma vez**, aparece em "Faturamento Live"; folha credita a vendedora sem duplicar.
