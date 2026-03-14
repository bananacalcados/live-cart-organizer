

## Plano: Frete grátis automático para 2ª compra no mesmo evento + Remover campo de frete manual do OrderDialogDb

### Problema
1. O campo "Frete" manual no diálogo de pedidos (`OrderDialogDb.tsx`) não é mais necessário — o frete agora é calculado dinamicamente no checkout.
2. Quando um cliente faz mais de um pedido na mesma live, ele não deveria pagar frete novamente na 2ª compra.

### Solução

**1. Remover campo de frete manual do OrderDialogDb**
- Remover o input `customShippingCost` e toda lógica associada do `OrderDialogDb.tsx`
- Pedidos novos sempre iniciam com `shipping_cost: 0` e `custom_shipping_cost: null` — o frete será definido no checkout

**2. Detectar frete já pago no checkout (Edge Function)**
- Na Edge Function `checkout-quote-freight`, adicionar um parâmetro opcional `order_id`
- Se recebido, buscar o `event_id` e `customer_id` do pedido
- Verificar se existe outro pedido **pago** (`is_paid = true` ou `paid_externally = true`) do mesmo `customer_id` no mesmo `event_id` com `shipping_cost > 0`
- Se sim, retornar uma flag `repeat_customer_free_shipping: true` junto com as cotações, e adicionar automaticamente uma opção especial no topo: **"Frete já pago em compra anterior — Grátis"**

**3. Ajustar o StepDelivery no TransparentCheckout**
- Passar o `orderId` para a chamada de `checkout-quote-freight`
- Se a resposta vier com `repeat_customer_free_shipping: true`, pré-selecionar automaticamente a opção de frete grátis e exibir um badge/destaque informando que o cliente já pagou frete neste evento

### Fluxo final
```text
Cliente abre checkout do 2º pedido no mesmo evento
  → CEP preenchido → quoteFreight chamado com order_id
  → Edge Function detecta pedido pago anterior com frete
  → Retorna opção "Frete já pago — Grátis" + demais opções
  → Opção grátis pré-selecionada automaticamente
  → Cliente pode trocar se quiser (ex: outra transportadora)
```

### Arquivos alterados
- `src/components/OrderDialogDb.tsx` — remover seção de frete manual
- `supabase/functions/checkout-quote-freight/index.ts` — adicionar lógica de detecção de repeat customer
- `src/pages/TransparentCheckout.tsx` — passar `orderId` no body da chamada e tratar a flag de frete grátis

