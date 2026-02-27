

# Separar Pedidos por Status de Pagamento

## Contexto
Atualmente, pedidos com status `online_pending` aparecem misturados na lista de vendas e tambem na aba de Envios. O usuario quer:
1. Na aba **Vendas (Pedidos)**: separar pedidos em colunas visuais -- "Aguardando Pagamento" e "Nao Aprovados"
2. Na aba **Envios**: mostrar APENAS pedidos pagos (`completed` e `pending_pickup`)

---

## Mudancas

### 1. POSDailySales.tsx -- Adicionar secoes de status de pagamento

**Onde**: Abaixo dos KPIs e acima da lista de vendas

- Criar 3 secoes visuais com tabs/filtros:
  - **Concluidas** (status = `completed`, `pending_sync`) -- comportamento atual
  - **Aguardando Pagamento** (status = `online_pending`) -- pedidos enviados para checkout mas sem confirmacao de pagamento
  - **Nao Aprovados** (status = `payment_failed` ou `payment_declined`) -- pedidos recusados pelo gateway

- Adicionar um filtro por status na parte superior da lista de vendas (similar aos filtros de expedição no POSShipments)
- O calculo de KPIs (faturamento, ticket medio, etc.) continuara considerando apenas vendas `completed`/`pending_sync` para nao inflar os numeros
- Cada secao tera contagem visual com badge colorida:
  - Aguardando: badge amarela/laranja com animacao pulse se > 0
  - Nao Aprovados: badge vermelha

### 2. POSShipments.tsx -- Filtrar apenas pedidos pagos

**Onde**: Linha 102, query de fetch

- Remover `online_pending` do filtro `.in('status', [...])` 
- Manter apenas `completed` e `pending_pickup`
- Resultado: a aba de envios so mostrara pedidos que ja foram confirmados como pagos

### 3. Novo status `payment_failed`

- O webhook `pagarme-webhook` e `appmax-webhook` ja registram falhas, mas o status do pedido pode precisar ser atualizado para `payment_failed` ou `payment_declined` quando o gateway notifica rejeicao
- Revisar os webhooks para garantir que pedidos recusados tenham o status atualizado adequadamente (e nao fiquem eternamente em `online_pending`)

---

## Detalhes Tecnicos

### POSDailySales.tsx

```text
Novo estado:
  statusFilter: 'all' | 'completed' | 'awaiting_payment' | 'not_approved'

Mapeamento:
  completed -> status in ['completed', 'pending_sync']
  awaiting_payment -> status = 'online_pending'
  not_approved -> status in ['payment_failed', 'payment_declined', 'cancelled']

Tabs visuais (acima da lista de vendas):
  [Todas] [Concluidas (X)] [Aguardando Pgto (Y)] [Nao Aprovadas (Z)]

KPIs: calculados SOMENTE sobre vendas completed/pending_sync (sem mudanca)
```

### POSShipments.tsx

```text
Linha 102 - Mudar de:
  .in('status', ['online_pending', 'pending_pickup', 'completed'])
Para:
  .in('status', ['pending_pickup', 'completed'])
```

### Webhooks (pagarme-webhook e appmax-webhook)

Garantir que quando o gateway notifica "recusado/cancelado":
- O status do pedido mude de `online_pending` para `payment_failed`
- Isso fara o pedido aparecer automaticamente na coluna "Nao Aprovados"

