# Coluna "Concluído" no Kanban do Evento (Área de Clientes)

Objetivo: quando a expedição do pedido é finalizada no PDV (etapa **Concluídos**), o card daquele pedido no Kanban do evento vai automaticamente para uma nova coluna **Concluído**.

## Como fica na tela

Colunas do evento em modo Área de Clientes hoje:

```text
Montando · Pedido Incompleto · Aguardando Confirmação · Novo Pedido · Aguardando Pagamento · Pago · Expedição · Cancelado
```

Depois:

```text
... · Pago · Expedição · CONCLUÍDO · Cancelado
```

- **Expedição**: pedido pago, em processamento no PDV.
- **Concluído**: expedição finalizada (embalado/despachado/entregue conforme a etapa Concluídos do PDV).

## Regra de movimentação

- Gatilho: a venda no PDV passa para `Concluídos` na aba Expedição.
- O sistema localiza o pedido de origem da live vinculado àquela venda e move o card para **Concluído**.
- Envio unificado (vários pedidos do mesmo cliente agrupados): todos os pedidos do grupo vão para Concluído juntos.
- Pedidos **cancelados nunca são movidos** — permanecem em Cancelado.
- Se a venda voltar de Concluídos para uma etapa anterior no PDV, o card volta para **Expedição** (movimento reversível, sem perder histórico).
- Movimento manual no Kanban continua funcionando normalmente.

## Detalhes técnicos

1. **Reuso de etapa existente, sem novo valor de status**
   - A coluna nova usa a etapa já existente `shipped`, exibida como "Concluído" apenas no modo Área de Clientes (`MEMBER_AREA_STAGE_IDS` + `MEMBER_AREA_TITLES` em `src/types/order.ts`).
   - Evita criar valor novo em `orders.stage` e não afeta relatórios: `shipped` já é contabilizado como pago em `src/lib/orderPaymentStages.ts`.

2. **Trigger no banco** (`pos_sales`, AFTER UPDATE de `expedition_stage`)
   - `concluido` → `UPDATE orders SET stage='shipped'` para `source_order_id` da venda e das demais vendas do mesmo `expedition_group_id`, ignorando pedidos com `stage='cancelled'`.
   - Saída de `concluido` → volta esses pedidos para `stage='completed'` (coluna Expedição), também ignorando cancelados.
   - Função `SECURITY DEFINER` com `search_path=public`; não altera nada quando `source_order_id` é nulo (vendas de balcão/avulsas).

3. **Backfill único**
   - Alinha os ~798 pedidos que já estão com venda em `concluido` e ainda aparecem em Expedição no Kanban (sem tocar em cancelados).

4. **Sem mudanças de layout ou de outras abas**
   - Kanban padrão (não-Área-de-Clientes) permanece idêntico.
   - Aba Expedição do PDV não muda; ela só passa a disparar o trigger.
