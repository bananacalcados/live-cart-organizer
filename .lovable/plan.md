# Solução Definitiva: Conversa por (telefone + instância)

## Objetivo

Eliminar de vez o bug de troca silenciosa de instância. Cada par `(telefone, whatsapp_number_id)` é uma **conversa independente** em todo o sistema. A instância de envio NUNCA é decidida pelo seletor global — sempre vem da conversa aberta.

---

## Camada 1 — Modelo de dados

1. **Migration**
   - Adicionar coluna `whatsapp_number_id uuid` em `chat_contacts` (se ainda não existir como obrigatória).
   - Trocar UNIQUE de `chat_contacts.phone` para UNIQUE `(phone, whatsapp_number_id)`.
   - Índice composto em `whatsapp_messages (phone, whatsapp_number_id, created_at desc)`.
   - Função SQL `public.get_conversation_instance(p_phone text)` que retorna o `whatsapp_number_id` da última mensagem incoming daquele telefone (usado como autoridade para guard).

2. **Backfill**
   - Para `chat_contacts` sem `whatsapp_number_id`, popular com a instância da última mensagem do telefone. Se não houver, manter `null` (legado).

---

## Camada 2 — Edge functions (guard de envio)

Tanto `meta-whatsapp-send` quanto `zapi-send-message` recebem um guard:

```
1. Se request veio com whatsapp_number_id → usar esse.
2. Buscar a última mensagem incoming do telefone:
   - Se existir e tiver whatsapp_number_id diferente → 409 STRICT_MISMATCH
     (a menos que header X-Force-Instance: true seja passado, para casos justificados).
3. Se nenhum whatsapp_number_id veio E não há histórico → usar default da instância.
```

Já existe a regra `instance-routing-strict-validation` na memória — esta é a implementação formal dela em edge functions.

---

## Camada 3 — Frontend

1. **Hook compartilhado `useConversationInstance(phone)`**
   - Retorna `{ boundNumberId, boundNumber, isLocked }` derivado de mensagens.
   - Centraliza a lógica que já está no `POSWhatsApp` e no `WhatsAppChat` corrigido nesta sessão.

2. **Lista de conversas: uma linha por (phone, instance)**
   - Em `ConversationList` (POS já faz via `conversationKey`).
   - Em `WhatsAppChat` (eventos): se o `order.whatsapp` tem histórico em 2 instâncias, abrir a da `events.whatsapp_number_id` do pedido; caso contrário, a última.
   - Badge da instância visível em cada item, mesmo telefone aparece duas vezes se realmente conversou em duas instâncias.

3. **WhatsAppNumberSelector**
   - Em chat aberto: vira **read-only** mostrando a instância vinculada (já fiz isso no `WhatsAppChat`).
   - Vira filtro de listagem apenas; nunca decide envio.

4. **Eventos**
   - Ao criar um pedido a partir de um evento, gravar `latest_message.whatsapp_number_id = event.whatsapp_number_id` para que o chat já abra travado na instância correta desde a 1ª mensagem.

---

## Camada 4 — Limpeza

- Remover toda referência a `selectedNumberId` em paths de envio (`WhatsAppChat`, `SendWhatsAppDialog`, `LeadWhatsAppDialog`, `SupportWhatsAppChat`, etc.). Substituir por `effectiveNumberId` vindo do hook.
- Memory note novo: `mem://features/whatsapp/conversation-by-instance-architecture` consolidando a regra.

---

## Ordem de execução (PRs incrementais)

```text
PR1  Hook useConversationInstance + aplicar em WhatsAppChat, SendWhatsAppDialog,
     LeadWhatsAppDialog, SupportWhatsAppChat (frontend-only, zero risco de DB)
PR2  Migration: índice composto + função get_conversation_instance + backfill
PR3  Guard nas edge functions meta-whatsapp-send e zapi-send-message
PR4  UNIQUE composta em chat_contacts + ajuste de inserts duplicados existentes
PR5  Memory update + remover dead code do seletor global em paths de envio
```

## Riscos e mitigações

- **Risco**: Conversas legadas sem `whatsapp_number_id` quebrando guard → guard só rejeita quando há **conflito explícito**, não quando o histórico é `null`.
- **Risco**: Cliente que migra de instância (ex: a loja troca z-api) → header `X-Force-Instance: true` em um botão admin "Trocar instância desta conversa".
- **Risco**: UNIQUE composta falhar com duplicados existentes → backfill primeiro, depois UNIQUE com `NOT VALID` + validação.

---

## O que NÃO faz parte (intencional)

- Não mexe na unificação dos 5 chats em `<UnifiedWhatsAppChat />` (continua sendo o próximo passo após este).
- Não toca em IG/Messenger (já são naturalmente por instância Meta).
- Não migra histórico antigo para "splitar" conversas que misturaram instâncias — só impede que novos envios continuem misturando.
