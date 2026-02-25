
# Plano: Retentativa Transparente Pagarme > Vindi > AppMax + Correção de Falso Positivo

## Problema Identificado

Os logs mostram que o backend **corretamente** identifica a recusa por fraude do Pagar.me (status="failed"), tenta o fallback APPMAX, mas o APPMAX retorna 404 (token/endpoint possivelmente inválido). O backend retorna `success: false`, porém o frontend pode estar mostrando "Pagamento aprovado" indevidamente em certas condições de parsing da resposta.

## Mudancas Planejadas

### 1. Corrigir falso positivo no frontend (`StoreCheckout.tsx`)

- Adicionar validacao extra: alem de checar `data.success`, verificar se `data.transactionId` existe
- Logar no console o response completo para debug
- Garantir que `supabase.functions.invoke` nao retorne um objeto `data` inesperado quando ha erro HTTP

### 2. Criar Edge Function da Vindi (novo arquivo)

**Arquivo:** `supabase/functions/pagarme-create-charge/index.ts` (adicionar funcao `chargeVindi`)

Fluxo Vindi (API v1 - `https://app.vindi.com.br/api/v1`):
- Autenticacao: Basic Auth (token como username, senha vazia)
- Passo 1: Criar customer (`POST /customers`)
- Passo 2: Criar payment_profile com dados do cartao (`POST /payment_profiles`)
- Passo 3: Criar bill avulsa (`POST /bills`) com installments e items
- Verificar se `bill.charges[0].status === "paid"`

### 3. Atualizar cadeia de retentativa

Ordem: **Pagarme -> Vindi -> AppMax**

```text
Pagarme (principal)
   |
   v falhou?
Vindi (segunda opcao)
   |
   v falhou?
AppMax (terceira opcao)
```

Cada gateway loga o erro especifico e passa para o proximo. A mensagem de erro final ao cliente sera a mais descritiva entre os 3.

### 4. Secret necessario

- `VINDI_API_KEY` - Token da API da Vindi (sera solicitado antes da implementacao)

## Detalhes Tecnicos

### Funcao `chargeVindi` (dentro de `pagarme-create-charge/index.ts`)

```text
1. POST /api/v1/customers
   body: { name, email, document, document_type: "cpf", phones: [...] }

2. POST /api/v1/payment_profiles
   body: {
     customer_id, holder_name, card_number, card_expiration: "MM/YYYY",
     card_cvv, payment_method_code: "credit_card"
   }

3. POST /api/v1/bills
   body: {
     customer_id, payment_method_code: "credit_card",
     installments, bill_items: [{ product_id, amount }],
     payment_profile: { id: profile_id }
   }
```

### Cadeia de fallback atualizada no handler principal

```text
let result = await chargePagarme(...)

if (!result.success) {
  const vindiKey = Deno.env.get("VINDI_API_KEY")
  if (vindiKey) {
    result = await chargeVindi(...)
  }

  if (!result.success) {
    const appmaxToken = Deno.env.get("APPMAX_ACCESS_TOKEN")
    if (appmaxToken) {
      result = await chargeAppmax(...)
    }
  }
}
```

### Correcao no frontend

- Adicionar log do response completo antes do check de sucesso
- Validar `data.success === true` de forma estrita (triple equals)
- Mostrar gateway utilizado na tela de confirmacao

## Arquivos Modificados

1. `supabase/functions/pagarme-create-charge/index.ts` - Adicionar `chargeVindi`, reorganizar fallback chain
2. `src/pages/StoreCheckout.tsx` - Corrigir validacao de resposta, adicionar logs

## Passo Prévio

Sera necessario configurar o secret `VINDI_API_KEY` antes de implementar.
