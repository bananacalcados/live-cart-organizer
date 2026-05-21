# Plano A — Broadcast via trigger para `whatsapp_messages`

## Objetivo
Tirar `whatsapp_messages` da publication `supabase_realtime` (elimina 96% do WAL decoding dessa tabela) e substituir por broadcast nativo do Postgres via trigger + `realtime.send()`. Sem impacto visual no chegar de mensagens novas.

## Como vai funcionar

```
ANTES                                  DEPOIS
─────                                  ──────
INSERT/UPDATE → WAL decoder            INSERT → trigger → realtime.send()
  → todos os clientes recebem            → canal "wa_msg_inserts"
                                         → clientes recebem só INSERTs
UPDATE status (×908k/dia)             UPDATE status → nada
  → broadcast desperdiçado              (refetch leve quando chat aberto)
```

## Mudanças

### 1. Migration (banco)
- `ALTER PUBLICATION supabase_realtime DROP TABLE whatsapp_messages`
- Criar função `notify_wa_message_insert()` que chama `realtime.send()` no canal `wa_msg_inserts` com payload mínimo (`id`, `phone`, `whatsapp_number_id`, `direction`, `created_at`)
- Trigger `AFTER INSERT ON whatsapp_messages FOR EACH ROW`
- Política RLS no `realtime.messages` permitindo authenticated escutar o canal

### 2. Refator dos 11 arquivos do chat
Trocar o padrão:
```ts
.on('postgres_changes', { event: 'INSERT', table: 'whatsapp_messages' }, refetch)
.on('postgres_changes', { event: 'UPDATE', table: 'whatsapp_messages' }, refetch)
```
Por:
```ts
.on('broadcast', { event: 'wa_msg_insert' }, refetch)
```

Arquivos afetados:
- `src/pages/Chat.tsx`
- `src/components/GlobalWhatsAppChat.tsx`
- `src/components/DashboardChatPanel.tsx`
- `src/components/WhatsAppChat.tsx`
- `src/components/expedition/SupportWhatsAppChat.tsx`
- `src/components/pos/POSWhatsApp.tsx`
- `src/components/pos/POSWhatsAppDashboard.tsx`
- `src/components/pos/POSSalesView.tsx`
- `src/components/live/LiveWhatsAppChatDialog.tsx`
- `src/components/marketing/LeadWhatsAppDialog.tsx`
- `src/components/events/InstagramDMChat.tsx` (verificar)

### 3. Compensação dos UPDATEs perdidos (status ✓✓)
Adicionar refetch leve de 15s **apenas na conversa atualmente aberta** (não na lista). Implementação: `setInterval` dentro do `useEffect` do componente que mostra mensagens da conversa ativa. Custo: ~1 query/15s por chat aberto vs. 908k broadcasts/dia.

## Garantias de não quebrar nada

| Função | Status | Por quê |
|---|---|---|
| Msg nova chega instantânea (chat aberto) | ✅ Mantido | Broadcast INSERT chega em <1s |
| Lista de conversas atualiza/reordena | ✅ Mantido | Mesmo broadcast |
| Badge/notificação de não-lida | ✅ Mantido | Mesmo broadcast |
| Múltiplos operadores vendo msg sair | ✅ Mantido | Broadcast no INSERT |
| ✓✓ azul de "lida" | ⚠️ Atualiza em até 15s na conversa aberta | Refetch periódico |
| Disparo em massa (broadcast/dispatch) | ✅ Zero impacto | Não depende de Realtime; só de tabelas próprias |
| Automação Jess/Bia/Livete | ✅ Zero impacto | Funcionam via edge functions + webhooks, não Realtime |
| Edição de msg (raríssima) | ⚠️ Não propaga via Realtime | Aparece ao reabrir conversa |

## Rollback (se algo der errado)
1 migration reversa:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages;
DROP TRIGGER notify_wa_msg_insert ON whatsapp_messages;
```
E reverter os 11 arquivos (mantenho commits separados).

## Plano de execução
1. Criar migration (drop publication + trigger + RLS no realtime.messages) — pedir aprovação
2. Refatorar os 11 arquivos
3. Adicionar refetch de 15s na conversa ativa (1-2 lugares)
4. Pedir pra você testar: abrir chat, mandar msg de outro número, ver se sobe na hora
5. Monitorar CPU do banco por 30 min

## Estimativa
- Implementação: ~45 min
- Janela de risco: 5 min após deploy (se algo quebrar, rollback é instantâneo)
- Ganho esperado: **-55 a -60% CPU do banco**
