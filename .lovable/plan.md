

# Plano: Reordenar Disparo — Todos os Blocos por Grupo (não por bloco)

## Problema Atual

Quando você cria uma mensagem com múltiplos blocos (ex: imagem + texto), o sistema salva cada bloco como uma **linha separada** na tabela `group_campaign_scheduled_messages`, cada uma com 5 segundos de diferença no `scheduled_at`.

O cron pega a primeira linha (bloco imagem), envia para os 20 grupos, depois pega a segunda linha (bloco texto) e envia para os 20 grupos. Resultado: Grupo 1 recebe a imagem, depois Grupo 2, 3... 20, e só então Grupo 1 recebe o texto.

## Solução Proposta

Agrupar os blocos de uma mesma mensagem e enviar **todos os blocos para cada grupo antes de avançar** para o próximo grupo.

### Estratégia: Vincular blocos com um `message_group_id`

Em vez de mudar a arquitetura inteira, adicionamos um campo `message_group_id` (UUID) que conecta blocos da mesma mensagem. A Edge Function `zapi-group-scheduled-send` passa a buscar todos os blocos do mesmo grupo e enviá-los sequencialmente para cada grupo VIP.

---

### Passo 1 — Migração SQL

Adicionar coluna `message_group_id` e `block_order` na tabela:

```sql
ALTER TABLE group_campaign_scheduled_messages 
  ADD COLUMN IF NOT EXISTS message_group_id uuid,
  ADD COLUMN IF NOT EXISTS block_order integer DEFAULT 0;
```

Nullable — mensagens existentes (bloco único) continuam funcionando sem mudança.

---

### Passo 2 — Frontend: `CampaignDetailPanel.tsx`

Nas funções `handleAddMessage` e `handleSendNow`, quando houver múltiplos blocos:
- Gerar um UUID único (`message_group_id`) para todos os blocos da mesma mensagem
- Salvar `block_order` (0, 1, 2...) em cada linha
- O **primeiro bloco** mantém o `scheduled_at` original; os demais recebem o **mesmo horário** (em vez de +5s) — porque agora a ordenação será por `block_order`, não por tempo
- Apenas o **primeiro bloco** fica com `status: 'pending'`; os demais ficam com `status: 'grouped'` (novo status que o cron ignora)

---

### Passo 3 — Edge Function: `zapi-group-scheduled-send`

Mudança na lógica do loop de grupos:

```
ANTES:
  Para cada grupo → enviar 1 bloco → delay → próximo grupo

DEPOIS:
  1. Ao receber um scheduledMessageId, verificar se tem message_group_id
  2. Se SIM: buscar TODOS os blocos com mesmo message_group_id, ordenados por block_order
  3. Para cada grupo:
     - Enviar bloco 1 → pequeno delay (1-2s) → bloco 2 → delay → bloco 3...
     - Depois delay normal entre grupos → próximo grupo
  4. Ao final, marcar TODOS os blocos como 'sent'
  
  Se NÃO tem message_group_id: comportamento idêntico ao atual (bloco único)
```

---

### Passo 4 — Edge Function: `cron-scheduled-group-messages`

Adicionar filtro para não pegar blocos com `status: 'grouped'`:

```sql
.eq('status', 'pending')  -- já existe, 'grouped' não será pego
```

Nenhuma mudança necessária — o filtro `.eq('status', 'pending')` já exclui blocos com status 'grouped'.

---

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| Migração SQL | +2 colunas (`message_group_id`, `block_order`) |
| `CampaignDetailPanel.tsx` | Gerar `message_group_id` + `block_order` ao salvar blocos |
| `zapi-group-scheduled-send/index.ts` | Buscar blocos agrupados e enviar todos por grupo |
| `cron-scheduled-group-messages/index.ts` | Nenhuma mudança (filtro já exclui 'grouped') |

## Garantias de Segurança

- Mensagens existentes (sem `message_group_id`) continuam sendo processadas exatamente como hoje — lógica antiga intocada
- O novo fluxo só ativa quando `message_group_id` está presente
- Nenhum outro módulo é afetado
- Fallback total: se algo falhar na busca dos blocos agrupados, envia só o bloco individual

## Risco

**Baixo.** A mudança é aditiva — novas colunas opcionais, novo branch condicional na Edge Function. O caminho existente (bloco único sem `message_group_id`) permanece 100% inalterado.

