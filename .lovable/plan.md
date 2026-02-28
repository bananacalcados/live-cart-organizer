
# Fase 1: Arquivados, Aguardando Pagamento, Vendedor e Motivo de Finalização

## Visao Geral
Implementar 5 funcionalidades interconectadas no WhatsApp do POS:
1. Aba de conversas **Arquivadas** (ocultas do "Todas")
2. Aba **Aguardando Pagamento** (auto-movida quando envia link/pix)
3. **Seletor de Vendedor** ao abrir o WhatsApp
4. **Atribuicao de conversa** ao vendedor (rastreamento de abertura sem resposta)
5. **Motivo ao Finalizar** conversa (Suporte, Duvida, Compra)

---

## 1. Novas Tabelas (Migracoes)

### `chat_archived_conversations`
Armazena conversas arquivadas pelo usuario.
```text
id UUID PK
phone TEXT UNIQUE NOT NULL
archived_at TIMESTAMPTZ DEFAULT now()
archived_by TEXT (seller_id)
```

### `chat_awaiting_payment`
Conversas com link/pix pendente de pagamento.
```text
id UUID PK
phone TEXT UNIQUE NOT NULL
sale_id UUID (referencia pos_sales)
type TEXT ('checkout' | 'pix')
created_at TIMESTAMPTZ DEFAULT now()
```

### `chat_seller_assignments`
Atribuicao de vendedor a conversa + rastreamento de atividade.
```text
id UUID PK
phone TEXT NOT NULL
seller_id UUID FK pos_sellers
store_id UUID FK pos_stores
assigned_at TIMESTAMPTZ DEFAULT now()
first_reply_at TIMESTAMPTZ (null se abriu mas nao respondeu)
opened_at TIMESTAMPTZ DEFAULT now()
```

### Alteracao em `chat_finished_conversations`
Adicionar coluna `finish_reason` TEXT (valores: 'suporte', 'duvida', 'compra') e `seller_id` UUID.

---

## 2. Arquivados

### Logica
- Adicionar botao "Arquivar" no menu de acoes da conversa (ao lado de Finalizar)
- Criar nova aba "Arquivados" no `ConversationList` (STATUS_TABS)
- Conversas arquivadas NAO aparecem na aba "Todas" nem nas outras abas
- Na aba "Arquivados", botao para desarquivar

### Arquivos afetados
- `src/components/chat/ChatTypes.ts` -- adicionar 'archived' ao ConversationStatusFilter
- `src/components/chat/ConversationList.tsx` -- nova aba + filtro
- `src/components/pos/POSWhatsApp.tsx` -- carregar arquivados, botao arquivar
- `src/hooks/useConversationEnrichment.ts` -- enriquecer com flag `isArchived`

---

## 3. Aguardando Pagamento

### Logica
- Quando o vendedor gera um link de checkout ou PIX pelo chat, inserir registro em `chat_awaiting_payment`
- Nova aba "Aguard. Pgto" no ConversationList com badge amarela
- Quando o pagamento for confirmado (webhook ou polling), remover da tabela automaticamente
- A conversa com pagamento confirmado pisca em verde (ja existe logica similar)

### Arquivos afetados
- `src/components/pos/POSWhatsAppCheckoutDialog.tsx` -- inserir em chat_awaiting_payment ao gerar link
- `src/components/pos/POSWhatsAppPixDialog.tsx` -- inserir em chat_awaiting_payment ao gerar pix
- `src/components/chat/ConversationList.tsx` -- nova aba
- `src/hooks/useConversationEnrichment.ts` -- enriquecer com flag `isAwaitingPayment`

---

## 4. Seletor de Vendedor no WhatsApp

### Logica
- Ao abrir a aba WhatsApp no POS, exibir um dialog de selecao de vendedor (reutilizando o design do POSSellerGate porem simplificado)
- O vendedor selecionado fica armazenado em estado local (nao precisa de tabela nova, usa o `storeId` que ja existe + os sellers ja carregados na pagina POS)
- O nome do vendedor sera incluido como assinatura opcional nas mensagens (ex: "- Vendedora Maria")
- O vendedor selecionado e salvo em sessionStorage para persistir durante a sessao

### Arquivos afetados
- `src/components/pos/POSWhatsApp.tsx` -- adicionar state `selectedSellerId`, dialog de selecao, carregar sellers
- Novo componente: `src/components/pos/POSWhatsAppSellerGate.tsx` -- dialog simplificado de selecao

---

## 5. Atribuicao de Conversa ao Vendedor

### Logica
- Quando o vendedor clica em uma conversa, registrar em `chat_seller_assignments` (opened_at)
- Quando o vendedor RESPONDE, atualizar `first_reply_at`
- Se o vendedor abriu mas nao respondeu em X minutos, isso fica registrado como "abriu e nao respondeu"
- A conversa fica "atrelada" ao vendedor para follow-up

### Arquivos afetados
- `src/components/pos/POSWhatsApp.tsx` -- em handleSelectConversation, inserir/atualizar assignment; em handleSendMessage, atualizar first_reply_at

---

## 6. Motivo ao Finalizar Conversa

### Logica
- Ao clicar "Finalizar", abrir um dialog com 3 opcoes: Suporte, Duvida, Compra
- O motivo e salvo em `chat_finished_conversations.finish_reason`
- O seller_id do vendedor logado tambem e salvo
- Esses dados serao usados na Fase 2 para calcular taxa de conversao

### Arquivos afetados
- `src/components/pos/POSWhatsApp.tsx` -- substituir click direto por dialog
- Novo componente: `src/components/pos/POSFinishConversationDialog.tsx`
- `src/hooks/useConversationEnrichment.ts` -- passar reason ao finalizar

---

## Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| Migracao SQL | Criar 3 tabelas + alterar 1 |
| `ChatTypes.ts` | Adicionar tipos |
| `ConversationList.tsx` | 2 novas abas (Arquivados, Aguard. Pgto) |
| `POSWhatsApp.tsx` | Seller gate, atribuicao, arquivar |
| `useConversationEnrichment.ts` | Enriquecer com archived + awaiting payment |
| `POSWhatsAppCheckoutDialog.tsx` | Inserir awaiting payment |
| `POSWhatsAppPixDialog.tsx` | Inserir awaiting payment |
| `POSWhatsAppSellerGate.tsx` | Novo - dialog selecao vendedor |
| `POSFinishConversationDialog.tsx` | Novo - dialog motivo finalizacao |

---

## Fase 2 (Proxima iteracao)
- Follow-up automatico com timer apos envio de link
- Dashboard de qualidade do vendedor (tempo de resposta, taxa de conversao)
- Sistema NPS via WhatsApp
