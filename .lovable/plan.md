

# Correcoes no WhatsApp POS - Fotos, Busca e Numero Visivel

## 3 Problemas Identificados

### 1. Fotos de Perfil Nao Aparecem

**Causa raiz:** O sistema so busca fotos de perfil para telefones que ja existem na tabela `chat_contacts` mas nao tem foto. Telefones que aparecem nas conversas mas nunca foram salvos na tabela `chat_contacts` sao completamente ignorados.

**Solucao:** Apos carregar os contatos do banco, comparar com a lista de telefones das conversas. Para os telefones que nao estao em `chat_contacts` (e portanto nao tem foto), incluir tambem no lote de busca via `zapi-profile-picture`. Como as conversas carregam depois dos contatos, adicionar um segundo `useEffect` que monitora as conversas e busca fotos dos telefones faltantes.

**Arquivo:** `src/components/pos/POSWhatsApp.tsx`

---

### 2. Busca por Numero Nao Funciona

**Causa raiz:** O filtro de busca (linha 99-101 do `ConversationList.tsx`) faz `c.phone.includes(searchQuery)`, que funciona para digitos exatos. Porem, o usuario pode digitar parcialmente (ex: "9815") e esperar encontrar. O problema real e que o codigo ja deveria funcionar com substring -- mas precisa tambem limpar caracteres nao-numericos do termo de busca para cobrir casos onde o usuario digita com formatacao.

**Solucao:** Antes de comparar, remover todos os caracteres nao-numericos do `searchQuery`. Assim "27 998" vira "27998" e encontra dentro de "5527998151234". A busca parcial por ultimos 4 digitos ja funcionara naturalmente com `includes()`.

**Arquivo:** `src/components/chat/ConversationList.tsx`

---

### 3. Numero de WhatsApp Invisivel Quando Tem Nome

**Causa raiz:** Na lista de conversas, so exibe `customerName || phone`. Quando tem nome, o phone desaparece. No header do chat (barra verde), mesmo comportamento: so mostra nome ou phone, nunca ambos.

**Solucao:**
- Na lista de conversas: exibir o numero do telefone formatado abaixo do nome, em fonte menor e cor mais clara
- No header verde do chat: exibir o numero abaixo do nome do contato
- No painel CRM: adicionar o numero de WhatsApp visivel

**Arquivos:** `src/components/chat/ConversationList.tsx` e `src/components/pos/POSWhatsApp.tsx`

---

## Detalhes Tecnicos

### Alteracoes em `src/components/pos/POSWhatsApp.tsx`

1. Adicionar um `useEffect` que roda quando `conversations` mudam, verificando quais telefones da lista de conversas nao tem foto em `contactPhotos`, e buscando em lote via `zapi-profile-picture`
2. No header verde (linha 508-513), abaixo do nome do contato, exibir o telefone em texto branco/translucido menor
3. No painel CRM (linha 406-467), adicionar o numero de telefone visivel

### Alteracoes em `src/components/chat/ConversationList.tsx`

1. No filtro de busca (linhas 99-101): limpar `searchQuery` removendo `\D` antes de comparar com `c.phone`, mantendo tambem a busca por nome como esta
2. Na renderizacao de cada conversa: quando `customerName` existe, exibir o telefone formatado em uma linha menor abaixo do nome

