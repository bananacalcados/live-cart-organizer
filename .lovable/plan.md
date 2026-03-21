

# Plano: Seleção de Instância WhatsApp para Grupos VIP + Correção da Sincronização

## Diagnóstico

Dois problemas encontrados:

1. **Disparo de campanhas usa credenciais fixas (env vars)**: A função `zapi-send-group-message` lê apenas `ZAPI_INSTANCE_ID/TOKEN/CLIENT_TOKEN` do ambiente. Não aceita `whatsapp_number_id` para resolver credenciais dinâmicas. Como a instância Perola está desconectada, todos os disparos falham silenciosamente.

2. **Sincronização já funciona corretamente**: A função `zapi-list-groups` já usa `resolveZApiCredentials(whatsapp_number_id)` e o frontend já envia `selectedNumberId`. O erro 404 que apareceu antes pode ter sido temporário (a função existe e está deployada). Se persistir, basta redeployar.

## Estratégia Cirúrgica

Alterações mínimas, isoladas, sem tocar em nenhum fluxo existente que funcione.

---

### Passo 1 — Banco de dados (1 migração)

Adicionar coluna `whatsapp_number_id` em **2 tabelas**:

```sql
ALTER TABLE group_campaigns 
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid REFERENCES whatsapp_numbers(id);

ALTER TABLE group_campaign_scheduled_messages 
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid REFERENCES whatsapp_numbers(id);
```

Campos nullable, sem impacto em dados existentes.

---

### Passo 2 — Edge Function: `zapi-send-group-message` (cirúrgico)

**Arquivo**: `supabase/functions/zapi-send-group-message/index.ts`

**Mudança**: Substituir as 3 linhas que leem env vars fixas por uma chamada a `resolveZApiCredentials()` (que já existe em `_shared/zapi-credentials.ts`).

```
// ANTES (linhas 28-37):
const instanceId = Deno.env.get('ZAPI_INSTANCE_ID');
const token = Deno.env.get('ZAPI_TOKEN');
const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN');

// DEPOIS:
import { resolveZApiCredentials } from "../_shared/zapi-credentials.ts";
// ...
const { whatsapp_number_id } = reqBody;
const { instanceId, token, clientToken } = await resolveZApiCredentials(whatsapp_number_id);
```

Adicionar `whatsapp_number_id` à interface `SendGroupRequest`. O campo é opcional — se não vier, o fallback para env vars continua funcionando exatamente como antes.

---

### Passo 3 — Edge Function: `zapi-group-scheduled-send` (cirúrgico)

**Arquivo**: `supabase/functions/zapi-group-scheduled-send/index.ts`

**Mudança**: Na hora de montar o `body` para chamar `zapi-send-group-message` (linha ~132), incluir o `whatsapp_number_id` da mensagem agendada ou da campanha:

```typescript
// Adicionar ao body (linha ~132):
body.whatsapp_number_id = msg.whatsapp_number_id || null;
```

Também alterar o select da mensagem agendada para incluir o novo campo (já vem automaticamente com `select('*')`).

---

### Passo 4 — Frontend: `GroupsVipManager.tsx` (cirúrgico)

**Arquivo**: `src/components/marketing/GroupsVipManager.tsx`

**Mudança**: No momento de criar a campanha (função que faz insert em `group_campaigns`), salvar o `selectedNumberId` como `whatsapp_number_id`.

Localizar o insert/create da campanha e adicionar:
```typescript
whatsapp_number_id: selectedNumberId || null,
```

---

### Passo 5 — Frontend: `CampaignDetailPanel.tsx` (cirúrgico)

**Arquivo**: `src/components/marketing/CampaignDetailPanel.tsx`

**Mudança**: Ao criar mensagens agendadas (insert em `group_campaign_scheduled_messages`), propagar o `whatsapp_number_id` da campanha para a mensagem.

---

### Passo 6 — Redeploy

Redeployar as 3 edge functions alteradas:
- `zapi-send-group-message`
- `zapi-group-scheduled-send`
- `zapi-list-groups` (preventivo, para garantir que não dê 404)

---

## Arquivos Alterados (resumo)

| Arquivo | Tipo de mudança |
|---|---|
| Migração SQL | +2 colunas nullable |
| `zapi-send-group-message/index.ts` | Trocar env vars por `resolveZApiCredentials()` (+3 linhas, -6 linhas) |
| `zapi-group-scheduled-send/index.ts` | +1 linha no body |
| `GroupsVipManager.tsx` | +1 linha no insert da campanha |
| `CampaignDetailPanel.tsx` | +1 linha no insert da mensagem agendada |

## Garantias de Segurança

- `resolveZApiCredentials` já tem fallback para env vars — se `whatsapp_number_id` for null, comportamento idêntico ao atual
- Colunas novas são nullable — dados existentes não são afetados
- Nenhum outro módulo (Chat, Expedição, PDV, Eventos) é tocado
- Bloco try/catch existente em todas as functions garante que erros não propagam

