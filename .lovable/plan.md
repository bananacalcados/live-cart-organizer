

# Plano: Monitor de Checkout para Eventos

## Problema

Pedidos ficam em "Aguardando Pagamento" mas clientes dizem que pagaram. Não há visibilidade sobre as tentativas de pagamento (sucesso, falha, processando) dos pedidos de eventos.

## Solução

Adicionar uma nova aba **"Pagamentos"** na página de Eventos (`/events`) que consulta a tabela `pos_checkout_attempts` filtrando pelos pedidos de cada evento, mostrando todas as tentativas de pagamento com status, gateway, valor, erro, etc.

---

### Passo 1 — Novo componente: `EventCheckoutMonitor.tsx`

**Arquivo**: `src/components/events/EventCheckoutMonitor.tsx`

Componente que:
1. Recebe a lista de eventos como prop (ou busca internamente)
2. Permite filtrar por evento específico ou ver todos
3. Consulta `pos_checkout_attempts` fazendo JOIN com `orders` para filtrar apenas pedidos de eventos:
   - Busca os `order.id` dos eventos selecionados
   - Filtra `pos_checkout_attempts.sale_id` por esses IDs
4. Exibe uma tabela com:
   - **Cliente** (nome, telefone)
   - **Evento** (nome)
   - **Valor**
   - **Método** (PIX/Cartão)
   - **Gateway** (Pagar.me, MercadoPago, AppMax)
   - **Status** (badge colorido: sucesso/falha/processando)
   - **Erro** (se houver)
   - **Data/Hora**
   - **Link do checkout** (botão para abrir `checkout.bananacalcados.com.br/checkout/order/{sale_id}`)
5. Filtros: por status (todos/sucesso/falha/processando), por evento, busca por nome/telefone
6. Botão de refresh manual
7. Badge de contagem de falhas visível na aba

---

### Passo 2 — Integrar na página Events.tsx

Adicionar uma terceira aba ao `TabsList`:

```
<TabsTrigger value="payments">
  <CreditCard /> Pagamentos
</TabsTrigger>
```

Com o conteúdo:
```
<TabsContent value="payments">
  <EventCheckoutMonitor events={events} />
</TabsContent>
```

---

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| `src/components/events/EventCheckoutMonitor.tsx` | Novo componente |
| `src/pages/Events.tsx` | +1 aba "Pagamentos" |

## Garantias

- Nenhuma tabela nova — usa `pos_checkout_attempts` e `orders` existentes
- Nenhuma Edge Function nova — consulta direta via SDK
- Nenhum outro módulo afetado
- Leitura apenas (SELECT) — sem modificar dados

