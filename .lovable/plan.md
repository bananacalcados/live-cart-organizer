# Retirada na loja: etiqueta e prioridade na Expedição

## O que muda para a equipe

- Todo pedido que for **retirada em loja física** ganha a etiqueta roxa **RETIRADA — {nome da loja}** (ou só **RETIRADA NA LOJA** quando a loja ainda não foi escolhida), no card da Expedição do PDV.
- Esses pedidos passam a ter prioridade na fila, junto com SEDEX e Valadares. A nova ordem de embalagem fica:
  1. SEDEX
  2. RETIRADA NA LOJA
  3. VALADARES, MG
  4. o restante, por data (como hoje)
- O contador do topo ("X prioritário(s)") passa a incluir as retiradas.
- Quando a retirada tem data marcada, a etiqueta mostra a data (ex.: RETIRADA — LOJA CENTRO · 10/09).

## De onde vem a marcação

1. **Pedidos da Live** — já hoje a equipe marca "Retirada na loja" na ficha do pedido; isso chega na venda como forma de envio e/ou loja de retirada. Nada muda no fluxo de marcação.
2. **Pedidos do site (Shopify)** — hoje a forma de envio escolhida no site **não** é trazida para o PDV, então pedidos de retirada do site chegam sem nenhuma marcação. Passamos a trazer essa informação na sincronização: se a opção de envio do pedido tiver "retirada", "retirar" ou "pickup" no nome, o pedido entra já marcado como retirada.
3. **Marcação manual** — se algum pedido antigo ficar sem marcação, a equipe continua podendo ajustar a forma de envio em "Editar dados".

## Correção de pedidos já existentes

- Marcamos como retirada os pedidos em aberto que já têm "Retirada na loja" como forma de envio mas estão sem a sinalização própria.
- Fazemos uma varredura dos pedidos do site em aberto para trazer a forma de envio que faltou e marcar os de retirada.

## Detalhes técnicos

- `pos_sales`: usar as colunas existentes `is_store_pickup`, `pickup_store_id`, `pickup_date` e `shipping_carrier`. Backfill: `is_store_pickup = true` onde `shipping_carrier ilike '%retirada%'`. Sem coluna nova.
- `src/lib/expeditionPriority.ts`: novo `isStorePickupOrder(order)` (checa `is_store_pickup`, `pickup_store_id`, `pickup_date` ou `shipping_carrier/delivery_method` contendo "retirada"); `expeditionPriorityRank` passa a 0=SEDEX, 1=Retirada, 2=Valadares, 3=demais.
- `src/components/pos/expedition/POSExpedition.tsx`: badge roxa com nome da loja (mapa de `pos_stores` já carregado por id) e data; ordenação e `priorityCount` reaproveitam o rank.
- `expeditionTypes.ts`: incluir `pickup_store_id`/`pickup_date` no mapeamento (já existem) e resolver o nome da loja de retirada em uma consulta única a `pos_stores`.
- `supabase/functions/shopify-sync-to-pos/index.ts`: adicionar `shipping_lines` à lista de `fields`; gravar `shipping_carrier = shipping_lines[0].title` quando vazio e `is_store_pickup = true` quando o título casar com /retirad|pickup|local/i.
- Nada muda em RLS, estoque, faturamento ou nas regras de avanço de etapa.
