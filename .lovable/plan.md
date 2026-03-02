

## Protecao contra Pagamentos Duplicados no Checkout

### Problema
Clientes clicam no botao "Pagar" multiplas vezes durante o processamento, gerando cobranças duplicadas nos gateways (Pagar.me, VINDI, AppMax). Isso causa aprovacoes seguidas de cancelamentos.

### Solucao em 3 camadas

---

### 1. Frontend - Bloqueio visual e de estado (ambos checkouts)

**Arquivos:** `src/pages/TransparentCheckout.tsx` e `src/pages/StoreCheckout.tsx`

Nos dois componentes `CardPaymentForm`:

- Adicionar estado `paymentAttemptId` (gerado ao clicar em Pagar) para rastrear a tentativa atual
- Substituir o botao "Pagar" por um estado visual de processamento persistente:
  - Quando `isProcessing = true`: exibir um card amarelo/laranja com animacao de loading e texto "Seu pagamento esta sendo processado pela operadora do cartao. Aguarde, nao feche esta pagina."
  - Desabilitar TODOS os campos do formulario (numero, nome, validade, CVV, parcelas)
  - Esconder o botao "Pagar" completamente e substituir pelo card de status
- Usar `useRef` para controle de concorrencia (`processingRef.current`) alem do estado React, pois o ref atualiza sincronamente e evita race conditions de cliques rapidos
- Salvar `paymentAttemptId` em `sessionStorage` com chave `checkout_payment_{orderId}` para persistir entre refreshes da pagina
- Ao montar o componente, checar se existe uma tentativa em andamento no `sessionStorage` e, se sim, entrar direto no modo "aguardando" com polling no backend

**Fluxo pos-processamento:**
- Se aprovado: exibir tela de sucesso (ja existente)
- Se recusado em todos os gateways: exibir mensagem "A operadora do seu cartao nao aprovou a compra. Revise os dados ou tente com outro cartao." e liberar o formulario novamente para nova tentativa
- Ao liberar, limpar o `sessionStorage` para permitir novo envio

---

### 2. Backend - Idempotencia no Edge Function

**Arquivo:** `supabase/functions/pagarme-create-charge/index.ts`

- No inicio do handler (apos validar campos), verificar se o pedido ja foi pago consultando a tabela correspondente (`orders.is_paid` ou `pos_sales.status = 'paid'`). Se sim, retornar `{ success: true, already_paid: true }` sem cobrar novamente. (Essa verificacao parcialmente ja existe, mas precisa retornar de forma limpa.)
- Aceitar um campo opcional `paymentAttemptId` no body da requisicao
- Antes de iniciar a cascata de gateways, verificar em `pos_checkout_attempts` se ja existe uma tentativa com esse `paymentAttemptId` com status `processing`. Se sim, retornar `{ success: false, error: "Pagamento ja em processamento. Aguarde." }`
- Inserir um registro em `pos_checkout_attempts` com status `processing` no inicio da execucao, e atualizar para `success` ou `failed` ao final
- Isso garante que mesmo se o cliente fizer refresh e o frontend enviar outra requisicao, o backend rejeita duplicatas

---

### 3. Feedback visual detalhado durante processamento

**Nos dois checkouts (`TransparentCheckout` e `StoreCheckout`):**

Substituir o simples "Processando..." por um componente `PaymentProcessingOverlay` inline que mostra:

```text
+------------------------------------------+
|  [animacao loading]                       |
|                                           |
|  Processando seu pagamento...             |
|  Estamos verificando com a operadora      |
|  do seu cartao de credito.                |
|                                           |
|  Nao feche esta pagina.                   |
|  Isso pode levar alguns segundos.         |
+------------------------------------------+
```

- O overlay substitui todo o formulario de cartao enquanto o pagamento esta em andamento
- Nao ha botao clicavel durante esse estado
- Se o pedido ja estiver pago (refresh), mostra direto a tela de sucesso

---

### Resumo das alteracoes

| Arquivo | Alteracao |
|---|---|
| `src/pages/TransparentCheckout.tsx` | Adicionar `processingRef`, `sessionStorage` lock, overlay de processamento, mensagem de erro amigavel, bloqueio de re-envio |
| `src/pages/StoreCheckout.tsx` | Mesmas protecoes do TransparentCheckout |
| `supabase/functions/pagarme-create-charge/index.ts` | Idempotencia via `paymentAttemptId`, registro de status `processing` em `pos_checkout_attempts`, rejeicao de duplicatas |

### Detalhes tecnicos

- O `paymentAttemptId` sera um UUID gerado no frontend via `crypto.randomUUID()`
- A coluna `transaction_id` em `pos_checkout_attempts` sera reutilizada para armazenar o `paymentAttemptId` no registro de status `processing`
- Nao e necessaria migracao de banco — os campos existentes (`status`, `transaction_id`, `metadata`) sao suficientes
- O polling pos-timeout que ja existe sera mantido, mas agora so executa se nao houver um resultado definitivo

