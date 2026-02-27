

# Webhooks de Pagamento: Pagar.me e AppMax

## Problema
Quando um pagamento entra em analise de antifraude, o checkout retorna "em analise" ou da timeout. O pedido fica preso em `online_pending` indefinidamente porque nao existe nenhum mecanismo para receber a notificacao de aprovacao/rejeicao posterior.

## Solucao
Criar duas Edge Functions de webhook (uma para cada gateway) que recebem notificacoes automaticas de mudanca de status e atualizam `orders` ou `pos_sales` conforme necessario.

---

## 1. Edge Function: `pagarme-webhook`

Recebe POST da Pagar.me quando o status de um pedido/cobranca muda.

**Fluxo:**
1. Recebe o payload da Pagar.me (evento `order.paid`, `order.payment_failed`, `charge.paid`, etc.)
2. Extrai o `order_id` do campo `code` ou `metadata` do pedido Pagar.me (que sera preenchido na criacao)
3. Busca o pedido em `orders` ou `pos_sales`
4. Se status = `paid`: atualiza para pago, registra gateway e transaction_id
5. Se status = `failed`/`canceled`: registra log em `pos_checkout_attempts`
6. Retorna 200 OK

**Seguranca:** Validacao opcional via header de assinatura da Pagar.me (se disponivel).

## 2. Edge Function: `appmax-webhook`

Recebe POST da AppMax quando uma transacao muda de status.

**Fluxo:**
1. Recebe o payload da AppMax (evento de pagamento aprovado/recusado)
2. Extrai o ID do pedido do campo de metadata ou referencia
3. Busca em `orders` ou `pos_sales`
4. Se aprovado: atualiza status para pago
5. Se recusado: registra log
6. Retorna 200 OK

## 3. Vincular ID do pedido ao gateway

**Alteracao em `pagarme-create-charge`:**
- No body do pedido enviado a Pagar.me, adicionar o campo `code` com o `orderId` do sistema, para que o webhook consiga identificar de volta qual pedido foi pago.
- Na AppMax, incluir metadata ou referencia com o `orderId`.

## 4. Registro em `pos_checkout_attempts`

Ambos os webhooks registram o resultado na tabela `pos_checkout_attempts` para rastreabilidade no monitor de checkout do PDV.

## 5. Configuracao

- Registrar ambas as funcoes no `supabase/config.toml` com `verify_jwt = false` (sao endpoints publicos chamados pelos gateways)
- A URL dos webhooks sera:
  - Pagar.me: `https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/pagarme-webhook`
  - AppMax: `https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/appmax-webhook`
- Essas URLs precisarao ser cadastradas nos paineis da Pagar.me e AppMax pelo usuario.

---

## Detalhes Tecnicos

### pagarme-webhook/index.ts
```text
POST recebe payload Pagar.me
  -> Extrai event type (order.paid, order.canceled, charge.*)
  -> Extrai code (= nosso orderId) do payload
  -> Busca em orders ou pos_sales
  -> Se paid e nao estava pago: atualiza status + registra log
  -> Se failed/canceled: registra log
  -> Retorna 200
```

### appmax-webhook/index.ts
```text
POST recebe payload AppMax
  -> Extrai status e order reference
  -> Busca em orders ou pos_sales
  -> Se approved: atualiza status + registra log
  -> Se declined: registra log
  -> Retorna 200
```

### Alteracao em pagarme-create-charge/index.ts
- Adicionar `code: params.orderId` no `orderBody` enviado a Pagar.me (para rastreabilidade no webhook)
- Adicionar referencia do orderId nos metadados da AppMax

---

## Proximo passo do usuario
Apos a implementacao, o usuario precisara cadastrar as URLs de webhook nos paineis administrativos da Pagar.me e da AppMax.

