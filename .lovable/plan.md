

## Diagnóstico do Problema

Existem **duas falhas críticas** no fluxo de pagamento online:

### Problema 1: Dados do cliente não são salvos pelo backend
Quando o pagamento por **cartão** é aprovado, a edge function `pagarme-create-charge` marca o pedido como `paid` mas **NÃO salva** os dados do cliente (nome, CPF, email, endereço) na tabela `pos_sales` nem cria registro em `pos_customers`. Esses dados só são salvos pelo frontend em `handlePaymentConfirmed` — que depende do navegador da cliente estar aberto.

O mesmo acontece nos webhooks (`pagarme-webhook`, `appmax-webhook`, `payment-webhook`): apenas atualizam o status para `paid`, sem salvar dados do cliente nem criar pedido no Tiny.

**Apenas o fluxo de PIX** (`mercadopago-check-payment`) faz isso corretamente — porque já foi corrigido anteriormente.

### Problema 2: Pedido no Tiny não é criado pelo backend
A criação do pedido no Tiny ERP depende exclusivamente do frontend (`handlePaymentConfirmed`). Se a cliente fecha o navegador após pagar, o Tiny nunca recebe o pedido.

---

## Plano de Correção

### 1. Salvar dados do cliente ANTES do pagamento no `pagarme-create-charge`
Quando a edge function recebe a requisição de cobrança para `pos_sales`, ela já possui todos os dados do cliente no payload (`customer`). Vamos:
- Fazer upsert em `pos_customers` (por CPF ou telefone)
- Salvar `customer_name`, `customer_phone` e `payment_details` (com todos os dados) em `pos_sales` **antes de tentar cobrar**
- Vincular `customer_id` ao pedido

Isso garante que mesmo se o pagamento falhar ou o cliente fechar o navegador, os dados já estarão salvos.

### 2. Criar pedido no Tiny automaticamente após aprovação no `pagarme-create-charge`
Após o pagamento ser aprovado com sucesso (em qualquer gateway da cascata), a edge function vai:
- Buscar os itens em `pos_sale_items`
- Chamar `pos-tiny-create-sale` com os dados do cliente e itens
- Isso elimina a dependência do frontend

### 3. Adicionar criação de Tiny nos webhooks de contingência
Para os webhooks `pagarme-webhook`, `appmax-webhook` e `payment-webhook` (VINDI), quando o status mudar para `paid`:
- Buscar `payment_details` da `pos_sales` para recuperar dados do cliente
- Chamar `pos-tiny-create-sale` automaticamente
- Isso cobre o cenário onde o pagamento é assíncrono (ex: pré-autorização AppMax)

### Arquivos a editar

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/pagarme-create-charge/index.ts` | Salvar dados do cliente em `pos_sales`/`pos_customers` antes da cobrança + criar Tiny após aprovação |
| `supabase/functions/pagarme-webhook/index.ts` | Após marcar como `paid`, buscar dados e criar Tiny |
| `supabase/functions/appmax-webhook/index.ts` | Após marcar como `paid`, buscar dados e criar Tiny |
| `supabase/functions/payment-webhook/index.ts` | Após marcar VINDI como `paid`, buscar dados e criar Tiny |

### Lógica reutilizável (inline em cada função)

```text
1. Buscar pos_sales com payment_details e store
2. Extrair customer_name, cpf, email, phone, endereço de payment_details
3. Buscar pos_sale_items
4. Chamar pos-tiny-create-sale via fetch interno
```

Isso resolve permanentemente o problema: **pagamento aprovado = dados salvos + pedido no Tiny**, independentemente do navegador do cliente.

