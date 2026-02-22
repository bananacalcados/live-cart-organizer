

# Redesign do WhatsApp no POS - Layout Split-View (Estilo WhatsApp Desktop) + Transferencia de Estoque no Tiny

## Visao Geral

Duas entregas neste plano:

### 1. Layout Split-View do Chat

Transformar o chat do POS de um layout "tela unica" (lista OU chat) para um layout side-by-side igual ao WhatsApp Desktop:
- **Painel esquerdo**: Lista de conversas sempre visivel (com busca, filtros, abas de status)
- **Painel direito**: Area de chat da conversa selecionada
- A conversa selecionada fica destacada na lista
- Mensagens novas em outras conversas continuam aparecendo na lista em tempo real
- Nomes de grupos mantidos normalmente
- Todas as funcionalidades existentes preservadas (catalogo Shopify, audios, fotos, suporte, trocas, etc.)
- Em mobile, manter o comportamento atual (tela unica) por falta de espaco

### 2. Transferencia Automatica de Estoque no Tiny ERP

Quando uma transferencia entre lojas for confirmada como "Entregue", o sistema deve automaticamente:
- **Decrementar** o estoque na loja de origem (que enviou o produto)
- **Incrementar** o estoque na loja de destino (que recebeu o produto)

Isso sera feito via a API do Tiny ERP (estoque.atualizar.php), usando os tokens individuais de cada loja.

---

## Detalhes Tecnicos

### Parte 1 - Layout Split-View

**Arquivo: `src/components/pos/POSWhatsApp.tsx`**

Reestruturar o JSX principal:

```text
+--------------------------------------------------+
|  Header verde (WhatsApp)                         |
+------------------+-------------------------------+
|  ConversationList|  ChatView                     |
|  (sempre visivel)|  (conversa selecionada)       |
|                  |                               |
|  [busca]         |  [header do contato]          |
|  [filtros/abas]  |  [API selector]               |
|  [lista convs]   |  [mensagens]                  |
|                  |  [input]                       |
+------------------+-------------------------------+
```

- Usar `flex` com larguras fixas: lista ~35% e chat ~65%
- Passar `selectedPhone` para `ConversationList` para destacar a conversa ativa
- Em telas < 768px (mobile), manter o comportamento atual de tela unica
- O header verde sera unificado no topo, mostrando info do contato quando selecionado

**Arquivo: `src/components/chat/ConversationList.tsx`**

- Adicionar prop opcional `selectedPhone` para highlight visual da conversa ativa
- Aplicar estilo de destaque (background) na conversa selecionada

### Parte 2 - Transferencia de Estoque no Tiny

**Novo arquivo: `supabase/functions/pos-inter-store-stock-transfer/index.ts`**

Edge function que:
1. Recebe `request_id` da transferencia
2. Busca os dados da solicitacao (itens, loja origem, loja destino)
3. Busca os tokens Tiny de ambas as lojas via `pos_stores.tiny_token`
4. Para cada item:
   - Chama `estoque.atualizar.php` na loja de origem decrementando a quantidade
   - Chama `estoque.atualizar.php` na loja de destino incrementando a quantidade
5. Retorna o resultado

**Arquivo: `src/components/pos/POSInterStoreRequests.tsx`**

- No `handleRespond`, quando o status for `"delivered"`, apos atualizar o banco, chamar a nova edge function para ajustar o estoque no Tiny automaticamente
- Exibir feedback de sucesso/erro ao usuario

