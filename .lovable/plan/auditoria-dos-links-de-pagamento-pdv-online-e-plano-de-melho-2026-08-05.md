# Auditoria dos links de pagamento (PDV > Online) e plano de melhoria

## O que existe hoje

Os dois caminhos criam **a mesma coisa**: uma linha em `pos_sales`. Não há tabela separada de "pedido de expedição" — a aba EXPEDIÇÃO é apenas uma visão filtrada de `pos_sales` pela coluna `expedition_stage`.

### Caminho A — Criar link de produtos (Online Hub)
1. Vendedora monta o carrinho e gera o link.
2. É criada a venda em `pos_sales` com `status = online_pending`, `sale_type = online`, `payment_details.link_origin = online_hub`, mais os itens em `pos_sale_items`.
3. Um gatilho no banco (`trg_set_pos_sale_expedition_stage`) já grava `expedition_stage = novo` no momento da criação.

### Caminho B — Criar link avulso (valor livre, sem produto)
1. Vendedora digita o valor e (opcionalmente) os dados do cliente.
2. Mesma criação em `pos_sales`, com `status = online_pending`, `payment_details.is_avulso = true`, `link_origin = custom_link` e um item sintético "Pagamento avulso".
3. Mesmo gatilho grava `expedition_stage = novo`.

### O que acontece quando o pagamento é confirmado
- O webhook do gateway apenas muda `status` para `paid`/`completed` e preenche `paid_at`.
- Nesse instante a venda passa a ser visível **simultaneamente** em:
  - **EXPEDIÇÃO > Novos Pedidos** (a aba esconde tudo que está em `online_pending`, `pending`, `pending_pickup`, `payment_failed`, `cancelled`);
  - **PEDIDOS** (aba "daily"), onde entra direto na lista de vendas concluídas e **soma no faturamento do dia**.
- O gatilho `apply_pos_sale_stock_movement` dá baixa no estoque nesse mesmo momento (na virada de status para pago), não na expedição.
- A expedição depois só evolui `expedition_stage` (novo → preparação → separação → conferência → concluído) e, na conclusão, sincroniza o `stage` do pedido do evento (quando existir).

### Resposta direta
Não. O pedido **não passa pela Expedição antes de virar venda**. Assim que o pagamento é confirmado ele aparece nas duas abas ao mesmo tempo e já conta como venda/faturamento; a Expedição é um fluxo paralelo de fulfillment sobre a mesma linha.

---

## Plano de implementação — "Venda só após expedição concluída"

Objetivo: pagamento confirmado leva o pedido para EXPEDIÇÃO; a aba PEDIDOS só passa a listá-lo como venda efetivada quando a expedição for concluída — sem quebrar estoque, financeiro, fiscal, Meta CAPI e comissões.

### Princípio de segurança
Nada de mudar `status` de `paid` para um status novo. O `status` continua sendo a verdade do pagamento (o guard de webhook, a baixa de estoque, o cash flow e o CAPI dependem dele). A separação é feita **na leitura**, usando `expedition_stage` + uma flag explícita.

### Etapa 1 — Sinalizador de venda efetivada
- Nova coluna `pos_sales.sale_released_at` (timestamptz, nula).
- Gatilho: quando `expedition_stage` muda para `concluido` e a venda está paga, grava `sale_released_at = now()`. Se voltar de etapa, limpa.
- Backfill: todas as vendas já concluídas ou fora do fluxo de expedição (`sale_type` de balcão, `expedition_stage = concluido`) recebem `sale_released_at` retroativo, para não sumir nada do histórico.

### Etapa 2 — Aba PEDIDOS com duas listas
- Lista principal "Vendas" passa a exigir `sale_released_at` preenchido.
- Nova aba/contador "Em expedição": pagas, ainda sem `sale_released_at`, com o nome da etapa atual e botão para pular direto ao card na Expedição.
- KPIs do dia: faturamento principal conta apenas vendas liberadas; um card secundário mostra "Pago aguardando expedição" com valor e quantidade, para a vendedora não achar que sumiu dinheiro.

### Etapa 3 — Não quebrar o que depende de pagamento
Permanecem disparando na confirmação do pagamento (sem alteração):
- baixa de estoque e espelho Shopify;
- lançamento no fluxo de caixa e conciliação de gateway;
- Meta CAPI Purchase e área de membros;
- comissão da vendedora (continua atrelada ao pagamento; caso contrário a folha mudaria de base).
Revisão pontual: relatórios e dashboards que hoje listam vendas por `paid_at` ganham um seletor "Faturamento (pago)" x "Vendas efetivadas (expedidas)", com o padrão mantido em "pago" para não mudar números históricos.

### Etapa 4 — Regras por tipo de venda
- Retirada em loja (`pickup`) e balcão: liberadas imediatamente, não entram na trava.
- Link avulso sem produto: hoje precisa que a vendedora complete produto/dados/envio antes de avançar. Continua igual; ele só é liberado como venda ao concluir a expedição — se for uma cobrança que não gera envio, a vendedora usa o botão de concluir direto na Expedição.
- Pagamento na entrega (mototáxi): já entra na Expedição sem pagamento; libera como venda ao concluir, com o pagamento registrado.

### Etapa 5 — Ajustes de UI e comunicação
- Badge "Aguardando expedição" no card do pedido dentro da aba Pedidos.
- Contadores no topo do PDV para a fila de expedição por loja.
- Texto curto de ajuda explicando a nova regra para as vendedoras.

### Detalhes técnicos
- Migração: coluna `sale_released_at`, índice parcial `(store_id, sale_released_at)`, gatilho `trg_pos_sales_release_on_expedition`, backfill em uma única migração.
- Arquivos afetados: `src/components/pos/POSDailySales.tsx` (filtros e KPIs), `src/components/pos/expedition/expeditionTypes.ts` e `POSExpedition.tsx` (nenhuma mudança de filtro, só o gatilho de conclusão), `src/components/pos/POSGeneralDashboard.tsx` e relatórios que agregam `pos_sales` (seletor de base).
- Risco principal: relatórios de terceiros que leem `pos_sales` por `status`. Mitigado porque `status` não muda.
