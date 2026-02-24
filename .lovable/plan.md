

## Problema

Pedidos com status "Enviado" (situacao=6) e "Faturado" (situacao=5) no Tiny estao sendo importados e ficando como "Aprovado" na Expedição Beta. Exemplo: Elzina de Oliveira Bernardo (pedido 4144) esta marcada como "Enviado" no Tiny mas aparece como "Aprovado" aqui.

O Tiny mostra 67 pedidos aprovados, mas o sistema puxou 64 -- a diferença sao pedidos enviados/faturados que nao deveriam estar na aba de aprovados.

## Solução

### 1. Filtrar pedidos na API do Tiny (edge function)

Adicionar o parâmetro `situacao=3` (aprovado) na chamada à API `/pedidos` para que o Tiny retorne **apenas** pedidos aprovados, em vez de trazer todos e filtrar localmente. Isso:
- Reduz o volume de dados processados
- Evita importar pedidos enviados/faturados/cancelados desnecessariamente
- Alinha a contagem com o que o Tiny mostra (67 aprovados)

### 2. Corrigir pedidos já importados errados

Na mesma função de sync, adicionar uma verificação para pedidos existentes: se o `detailSituacao` do Tiny for 5 (faturado) ou 6 (enviado), atualizar o status local para `dispatched`. Isso corrige retroativamente pedidos como o da Elzina.

### 3. Manter busca complementar para pedidos despachados

Fazer uma segunda passagem na API com `situacao=6` (enviado) para atualizar pedidos existentes que mudaram de status, garantindo que o código de rastreio seja capturado e o status local atualizado para `dispatched`.

---

### Detalhes Técnicos

**Arquivo:** `supabase/functions/expedition-beta-initial-sync/index.ts`

Mudanças:
- Adicionar `situacao: '3'` nos parâmetros da chamada `tinyV3Get(token, '/pedidos', { ... })` para filtrar apenas aprovados
- Adicionar `DISPATCHED_SITUACAO = new Set([5, 6])` para detectar pedidos faturados/enviados
- Na verificação de pedidos existentes, se `detailSituacao` estiver em `DISPATCHED_SITUACAO`, atualizar para `dispatched`
- Fazer uma segunda passagem com `situacao: '6'` para capturar códigos de rastreio de pedidos enviados e atualizar registros existentes
- Manter a passagem com `situacao: '9'` para cancelados

Fluxo da função:
```text
Passagem 1: GET /pedidos?situacao=3 (aprovados)
  -> Importar novos pedidos como 'approved'
  -> Backfill itens em pedidos existentes sem itens

Passagem 2: GET /pedidos?situacao=6 (enviados)
  -> Atualizar pedidos existentes para 'dispatched'
  -> Capturar código de rastreio

Passagem 3: GET /pedidos?situacao=9 (cancelados)
  -> Atualizar pedidos existentes para 'cancelled'
```

Isso garante que:
- Apenas pedidos realmente aprovados apareçam na aba "Aprovado"
- Pedidos que mudaram de status no Tiny sejam atualizados localmente
- Códigos de rastreio sejam capturados para pedidos despachados
