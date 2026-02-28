

# Dashboard WhatsApp - Contadores de Status Clicaveis + Filtro Follow Up

## Resumo

Adicionar 4 contadores clicaveis no dashboard do WhatsApp (Novas Mensagens, Aguardando Resposta, Aguardando Pagamento, Follow Up) que ao clicar levam direto para o chat com o filtro correspondente. Tambem adicionar o novo filtro "Follow Up" na lista de conversas.

## O que muda

### 1. Novo status "Follow Up" (awaiting_customer renomeado)

O status `awaiting_customer` ja existe e significa exatamente "vendedora respondeu e cliente nao falou mais nada". Vamos usar esse status como base para o filtro "Follow Up" na lista de conversas:

- **Novas Mensagens** = `not_started` (cliente mandou msg e ninguem respondeu)
- **Aguardando Resposta** = `awaiting_reply` (vendedora ja conversou, cliente respondeu, mas ninguem viu/respondeu)
- **Aguardando Pagamento** = `awaiting_payment` (link/pix enviado, sem pagamento)
- **Follow Up** = `awaiting_customer` (vendedora respondeu, cliente sumiu)

### 2. Dashboard - Contadores clicaveis

No `POSWhatsAppDashboard.tsx`, adicionar uma nova secao acima dos KPIs com 4 cards/botoes grandes e coloridos:

- Cada card mostra o icone, titulo e contagem em tempo real
- Ao clicar, chama `onGoToChat` passando o filtro correspondente
- Os dados vem das conversas carregadas no momento (mesma logica do `ConversationList`)

Para isso, o dashboard precisa carregar as conversas e calcular os contadores. A prop `onGoToChat` sera expandida para aceitar um filtro opcional: `onGoToChat(filter?: ConversationStatusFilter)`.

### 3. ConversationList - Novo filtro "Follow Up"

Adicionar "Follow Up" como nova aba nos `STATUS_TABS` da `ConversationList`, mapeando para `awaiting_customer`.

### 4. POSWhatsApp - Conectar o fluxo

Quando o dashboard chamar `onGoToChat('not_started')` por exemplo, o `POSWhatsApp` vai:
1. Fechar o dashboard (`setShowDashboard(false)`)
2. Setar o `statusFilter` correspondente

---

## Detalhes Tecnicos

### Arquivos modificados

**`src/components/chat/ChatTypes.ts`**
- Nenhuma mudanca necessaria - os tipos ja suportam tudo

**`src/components/chat/ConversationList.tsx`**
- Adicionar entrada `{ value: 'awaiting_customer', label: 'Follow Up', shortLabel: 'Follow Up' }` no array `STATUS_TABS` (antes de `awaiting_payment`)

**`src/components/pos/POSWhatsAppDashboard.tsx`**
- Mudar prop `onGoToChat` de `() => void` para `(filter?: ConversationStatusFilter) => void`
- Adicionar carregamento de conversas (query `whatsapp_messages` + `chat_finished_conversations` + `chat_awaiting_payment`) para calcular contagens
- Usar o hook `useConversationEnrichment` para computar status das conversas
- Renderizar 4 cards clicaveis no topo: Novas, Aguardando Resposta, Aguardando Pagamento, Follow Up
- Cada card com cor distinta, icone e contagem
- Clicar chama `onGoToChat(filtro)`

**`src/components/pos/POSWhatsApp.tsx`**
- Alterar o handler `onGoToChat` do dashboard para aceitar filtro:
  ```
  onGoToChat={(filter) => {
    setShowDashboard(false);
    if (filter) setStatusFilter(filter);
  }}
  ```

### Cores dos contadores
- Novas Mensagens: azul (blue-500)
- Aguardando Resposta: amarelo/amber (amber-500)
- Aguardando Pagamento: roxo/violeta (violet-500)
- Follow Up: laranja (orange-500)

