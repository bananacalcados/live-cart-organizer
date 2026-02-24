
# Verificar Rastreio e Filtro de Pedidos do Dia

## Problema
Pedidos que ja foram despachados no Tiny (como o da Cenira Santi, que ja tem codigo de rastreio JLH2P2YU) continuam aparecendo como "Aprovado" na Expedição Beta. Alem disso, falta um filtro rapido para ver apenas pedidos do dia.

## Solução

### 1. Verificar codigo de rastreio durante a sincronização
Alterar a Edge Function `expedition-beta-initial-sync` para:
- Ao buscar os detalhes de cada pedido no Tiny V3, verificar se o campo de rastreamento (`codigoRastreamento` ou campo equivalente na resposta V3) esta preenchido
- Se o pedido ja tem rastreio, inserir com `expedition_status: 'dispatched'` ao inves de `'approved'`
- Para pedidos ja existentes no banco, tambem atualizar: se antes estava como `approved` mas agora no Tiny tem rastreio, atualizar para `dispatched`

### 2. Adicionar coluna de codigo de rastreio
- Criar migration adicionando coluna `tracking_code TEXT` na tabela `expedition_beta_orders`
- Gravar o codigo de rastreio quando disponivel durante o sync

### 3. Atualizar pedidos existentes no sync
A logica atual faz `skip` se o pedido ja existe. Mudar para: se ja existe, verificar se o Tiny agora tem rastreio e, caso tenha, atualizar o status para `dispatched` e gravar o `tracking_code`.

### 4. Filtro "Pedidos do Dia" na UI
No `ExpeditionBeta.tsx`, adicionar um botão rapido "Hoje" ao lado dos filtros de data existentes que:
- Seta `dateFrom` e `dateTo` para a data atual
- Facilita filtrar apenas os pedidos criados no dia

### 5. Exibir codigo de rastreio na lista de pedidos
No `BetaOrdersList.tsx`, dentro do `BetaOrderRow`:
- Mostrar o codigo de rastreio quando disponivel (badge ou texto ao lado do status)

---

## Detalhes Tecnicos

### Migration SQL
```sql
ALTER TABLE expedition_beta_orders ADD COLUMN tracking_code TEXT;
```

### Edge Function (`expedition-beta-initial-sync`)
- Para cada pedido buscado no detalhe (`/pedidos/{id}`), extrair `codigoRastreamento` (ou o campo correto da API V3)
- Logica de insert: se tem rastreio, `expedition_status = 'dispatched'`
- Logica de update (pedido ja existente): se agora tem rastreio e status atual nao e `dispatched`, atualizar status e gravar tracking_code

### UI (`ExpeditionBeta.tsx`)
- Adicionar botão "Hoje" que define dateFrom/dateTo para hoje

### UI (`BetaOrdersList.tsx`)
- Exibir `order.tracking_code` como badge quando presente
- Pedidos despachados ja ficam filtrados por padrão (filtro "Não despachados" ativo)

### Arquivos alterados
- `supabase/functions/expedition-beta-initial-sync/index.ts`
- `src/pages/ExpeditionBeta.tsx`
- `src/components/expedition-beta/BetaOrdersList.tsx`
- Nova migration para coluna `tracking_code`
