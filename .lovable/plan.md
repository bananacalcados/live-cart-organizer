
# Corrigir vinculacao de dados do cliente no checkout online

## Problema identificado

O checkout da loja (`StoreCheckout.tsx`) coleta todos os dados do cliente (nome, CPF, email, WhatsApp, endereco), mas na hora de salvar apos o pagamento (`handlePaymentConfirmed`), tenta gravar `customer_name` e `customer_phone` diretamente na tabela `pos_sales` -- porem **essas colunas nao existem**. O `as any` no TypeScript silencia o erro, mas o Supabase simplesmente ignora os campos inexistentes.

Resultado: o pedido fica com `customer_id = null` e os dados da cliente se perdem. O unico lugar onde os dados ficam e na tabela `pos_checkout_attempts`, que e apenas um log.

## Solucao em 2 partes

### Parte 1: Corrigir o fluxo automatico (novas compras)

**Arquivo: `src/pages/StoreCheckout.tsx`** - Funcao `handlePaymentConfirmed`

Alterar a logica para:
1. Buscar se ja existe um `pos_customer` com o mesmo CPF ou WhatsApp
2. Se nao existir, criar um novo registro em `pos_customers` com todos os dados coletados (nome, CPF, email, WhatsApp, endereco completo)
3. Se existir, atualizar os campos que estiverem vazios
4. Atualizar `pos_sales.customer_id` com o ID do cliente criado/encontrado
5. Remover o `as any` e os campos inexistentes (`customer_name`, `customer_phone`)

```text
Fluxo corrigido:
Pagamento aprovado
   |
   v
Busca pos_customer por CPF ou WhatsApp
   |
   +--> Nao existe: INSERT em pos_customers --> retorna ID
   |
   +--> Existe: UPDATE campos vazios --> usa ID existente
   |
   v
UPDATE pos_sales SET customer_id = <id>, status = 'completed'
   |
   v
Envia para Tiny com dados do cliente
```

### Parte 2: Backfill -- recuperar dados de clientes que ja pagaram

**Novo botao no `POSSaleDetailDialog.tsx`** - Quando o pedido e `online` e `customer_id` e nulo:

Adicionar um botao "Recuperar Dados do Cliente" que:
1. Busca em `pos_checkout_attempts` o registro de `status = 'success'` para aquele `sale_id`
2. Extrai `customer_name`, `customer_phone`, `customer_email`
3. Cria/atualiza um `pos_customer` e vincula ao `pos_sales.customer_id`
4. Atualiza a UI imediatamente

**Tambem: Acao em lote no `POSDailySales.tsx`** - Um botao "Recuperar clientes pendentes" que faz o backfill automatico para todas as vendas online sem `customer_id` que tenham um `pos_checkout_attempts` com `status = 'success'`.

---

## Detalhes tecnicos

### StoreCheckout.tsx - handlePaymentConfirmed (alteracoes)

```typescript
// 1. Upsert customer
const cpfDigits = customerForm.cpf.replace(/\D/g, "");
const phoneDigits = customerForm.whatsapp.replace(/\D/g, "");

// Try to find existing customer by CPF
let customerId: string | null = null;
if (cpfDigits) {
  const { data: existing } = await supabase
    .from("pos_customers")
    .select("id")
    .eq("cpf", cpfDigits)
    .maybeSingle();
  if (existing) customerId = existing.id;
}
// Fallback: find by phone
if (!customerId && phoneDigits) {
  const { data: existing } = await supabase
    .from("pos_customers")
    .select("id")
    .eq("whatsapp", phoneDigits)
    .maybeSingle();
  if (existing) customerId = existing.id;
}

const customerPayload = {
  name: customerForm.fullName,
  cpf: cpfDigits,
  email: customerForm.email,
  whatsapp: phoneDigits,
  address: customerForm.address,
  address_number: customerForm.addressNumber,
  complement: customerForm.complement,
  neighborhood: customerForm.neighborhood,
  city: customerForm.city,
  state: customerForm.state,
  cep: customerForm.cep.replace(/\D/g, ""),
};

if (customerId) {
  await supabase.from("pos_customers").update(customerPayload).eq("id", customerId);
} else {
  const { data: newCust } = await supabase
    .from("pos_customers")
    .insert(customerPayload)
    .select("id")
    .single();
  customerId = newCust?.id || null;
}

// 2. Update sale with customer_id
await supabase.from("pos_sales").update({
  status: "completed",
  customer_id: customerId,
}).eq("id", saleData.id);
```

### POSSaleDetailDialog.tsx - Botao de recuperacao

Quando `sale.sale_type === 'online'` e `!sale.customer_id`:
- Mostrar botao "Recuperar Dados do Checkout"
- Ao clicar: busca `pos_checkout_attempts` com `status = 'success'` para o `sale.id`
- Cria `pos_customer` e vincula ao pedido
- Atualiza a tela

### POSDailySales.tsx - Backfill em lote

Adicionar botao no header da secao de vendas online que:
- Identifica todas as vendas online sem `customer_id`
- Para cada uma, busca dados no `pos_checkout_attempts`
- Cria/vincula clientes automaticamente
- Mostra progresso e resultado

### Envio ao Tiny

O envio ao Tiny ja recebe os dados do customer corretamente no body da funcao. A correcao garante que o `customer_id` esteja linkado para que o `POSSaleDetailDialog` tambem consiga exibir os dados ao reenviar.
