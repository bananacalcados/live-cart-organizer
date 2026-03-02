

## Rastreamento Progressivo de Dados do Cliente no Checkout e Unificacao de Pedidos

### Problema Atual
1. Quando o cliente abre o link do checkout, um pedido `online_pending` e criado sem dados do cliente
2. Os dados do cliente so sao salvos apos pagamento aprovado, criando um segundo registro
3. Na aba Pedidos, nao e possivel ver em qual etapa do checkout o cliente parou
4. Na aba Envios, aparecem pedidos que ainda nao foram pagos
5. Nao ha botao para apagar envios

---

### Plano de Implementacao

### 1. Migracao de Banco - Adicionar colunas em `pos_sales`

Adicionar 3 novas colunas na tabela `pos_sales`:
- `customer_name` (text, nullable) - nome do cliente preenchido no checkout
- `customer_phone` (text, nullable) - telefone do cliente
- `checkout_step` (smallint, default 0) - etapa atual do cliente no checkout (0=abriu link, 1=preencheu identificacao, 2=preencheu entrega, 3=pagamento)

---

### 2. Frontend - Salvar dados a cada etapa do checkout (`StoreCheckout.tsx`)

**Etapa 1 (Identificacao):** Ao clicar "Ir para Entrega", salvar no `pos_sales`:
- `customer_name`, `customer_phone` (via `payment_details`)
- `checkout_step = 1`
- Atualizar `payment_details` com nome, email, CPF, WhatsApp

**Etapa 2 (Entrega):** Ao clicar "Ir para Pagamento", salvar:
- `checkout_step = 2`
- Atualizar `payment_details` com endereco completo (CEP, rua, numero, bairro, cidade, estado)
- Atualizar `shipping_address` com os dados de endereco

**Etapa 3 (Pagamento):** Ao entrar na tela de pagamento:
- `checkout_step = 3`

**Ao carregar o checkout:** Marcar `checkout_step = 0` se ainda nao houver valor

Isso garante que, mesmo se o cliente abandonar, os dados preenchidos ja estarao salvos no pedido.

---

### 3. Unificacao de pedidos - Evitar duplicacao

Atualmente, `handlePaymentConfirmed` em `StoreCheckout.tsx` atualiza o status do pedido existente para `completed` e faz upsert do cliente. O problema de duplicacao pode vir do webhook `mercadopago-check-payment` criando outro registro. 

Garantir que:
- O webhook `mercadopago-check-payment` apenas atualize o `pos_sales` existente (pelo `sale_id` ja passado), sem criar novo
- No `handlePaymentConfirmed`, nao criar novo pedido - apenas atualizar o existente (ja e assim no codigo atual, confirmar que nao ha duplicacao)

---

### 4. Aba Pedidos (`POSDailySales.tsx`) - Mostrar etapa do checkout e nome do cliente

No card de cada pedido `online_pending`:
- Mostrar o nome do cliente direto do campo `customer_name` da `pos_sales` (sem precisar buscar `pos_customers`)
- Mostrar badge indicando a etapa: "Etapa 1/3", "Etapa 2/3", "Etapa 3/3" com cores diferentes
- Para pedidos sem `checkout_step` ou `checkout_step = 0`: "Abriu link"

Atualizar a query de `loadData` e a interface `SaleSummary` para incluir `customer_name` e `checkout_step`.

---

### 5. Aba Envios (`POSShipments.tsx`) - Somente pedidos pagos + botao excluir

**Filtro de status:** Alterar a query de `fetchOrders` para filtrar apenas pedidos com status `paid` ou `completed` (remover `pending_pickup` e `online_pending` se nao pagos).

**Botao Excluir:** Adicionar um botao de exclusao dentro do card expandido de cada envio, com confirmacao (Dialog) antes de deletar. A exclusao remove o registro de `pos_sales` e seus `pos_sale_items`.

---

### Resumo dos Arquivos

| Arquivo | Alteracao |
|---|---|
| Migracao SQL | Adicionar `customer_name`, `customer_phone`, `checkout_step` em `pos_sales` |
| `src/pages/StoreCheckout.tsx` | Salvar dados progressivamente a cada etapa via update no `pos_sales` |
| `src/components/pos/POSDailySales.tsx` | Mostrar `customer_name` e badge de etapa nos pedidos `online_pending` |
| `src/components/pos/POSShipments.tsx` | Filtrar somente pagos; adicionar botao excluir com confirmacao |

### Detalhes Tecnicos

- As colunas `customer_name` e `customer_phone` em `pos_sales` sao redundantes com `payment_details`, mas permitem queries diretas e exibicao rapida sem parse de JSON
- `checkout_step` como `smallint` (0-3) e leve e indexavel
- A exclusao de envios deleta o `pos_sales` inteiro (e cascade nos items) - sera confirmada via Dialog
- O salvamento progressivo usa `supabase.from('pos_sales').update(...)` com o `saleId` ja disponivel no checkout
