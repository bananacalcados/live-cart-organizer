

## Plano: Dashboard em Tempo Real + Catalogo Melhorado + Nova Conversa

---

### Parte 1: Dashboard em Tempo Real com Novas Mensagens

**Problemas atuais:**
- O contador de "sem resposta" usa a tabela `orders` (`has_unread_messages`), que nao reflete o estado real das conversas no WhatsApp
- Nao atualiza em tempo real (usa polling de 30s com `setInterval`)
- Nao mostra contagem de "Novas" conversas (mensagens nao iniciadas)

**Solucao:**

1. **Trocar a fonte de dados** do contador para consultar `whatsapp_messages` diretamente, usando a mesma logica do `ConversationList`:
   - "Sem resposta" (Aguardando): conversas onde a ultima mensagem e `direction = 'incoming'` e ja houve resposta anterior
   - "Novas": conversas onde TODAS as mensagens sao `direction = 'incoming'` (nunca respondemos)

2. **Adicionar card "Novas"** ao dashboard, ao lado do card WhatsApp existente, mostrando quantas conversas novas existem

3. **Adicionar Supabase Realtime** para atualizar os contadores instantaneamente quando novas mensagens chegam ou sao enviadas, em vez de depender do polling de 30s

**Alteracoes em `POSSalesView.tsx`:**
- Substituir a query `orders.has_unread_messages` por query em `whatsapp_messages`
- Adicionar state `newConversations` para contagem de novas
- Adicionar canal Realtime em `whatsapp_messages` para refresh automatico
- Adicionar segundo card no dashboard para "Novas" com navegacao para aba WhatsApp com filtro `not_started`

**Alteracao no `POSWhatsApp.tsx`:**
- Aceitar `initialFilter` com valores `"unanswered"` OU `"new"` para aplicar o filtro correto

---

### Parte 2: Catalogo Melhorado com Filtros e Fotos por Variante

**Problemas atuais:**
- O nome do produto esta muito longo e esconde a variacao (cor/tamanho)
- Todas as variantes mostram a mesma foto (primeira imagem do produto)
- Nao tem filtro por colecao nem tamanho
- Shopify Storefront API retorna imagens por variante atraves do campo `image` na variant, mas o query atual nao busca esse campo

**Solucao:**

1. **Atualizar a query GraphQL em `shopify.ts`** para:
   - Buscar `image { url }` dentro de cada variante (foto especifica da cor/variacao)
   - Buscar `collections(first: 20) { edges { node { title handle } } }` para ter as colecoes
   - Buscar `productType` para categorias

2. **Melhorar a exibicao do produto no catalogo:**
   - Separar o nome do produto do nome da variante
   - Mostrar o nome do produto em uma linha (truncado) e a variacao (cor + tamanho) em outra linha com destaque
   - Usar a imagem especifica da variante em vez da imagem geral do produto

3. **Adicionar filtros no catalogo:**
   - **Filtro por Colecao** (dropdown com colecoes disponiveiscarregadas da Shopify)
   - **Filtro por Tamanho** (dropdown com tamanhos extraidos de `selectedOptions` onde `name = "Tamanho"` ou `"Size"`)
   - Os filtros sao combinaveis: Colecao + Tamanho, ou apenas um, ou busca livre + filtros

**Alteracoes em `shopify.ts`:**
- Adicionar `image { url }` no fragment de variantes da query GraphQL
- Adicionar `collections(first: 20) { edges { node { title handle } } }` no fragment de produtos
- Atualizar o tipo `ShopifyProduct` para incluir os novos campos

**Alteracoes em `POSProductCatalogSender.tsx`:**
- Extrair colecoes e tamanhos unicos dos produtos carregados
- Adicionar dropdowns de filtro por colecao e tamanho
- Usar `variant.image.url` quando disponivel, senao fallback para primeira imagem do produto
- Refatorar a exibicao: nome do produto curto + variacao (cor/tamanho) em destaque abaixo

---

### Parte 3: Botao "Nova Conversa" no WhatsApp

**Problema:** Nao existe forma de iniciar uma conversa com um contato que nao esta no historico do chat.

**Solucao:**

1. **Adicionar botao "+ Nova Conversa"** no header do WhatsApp (quando nao tem conversa selecionada)

2. **Dialog "Nova Conversa"** com os campos:
   - Nome do contato (opcional, sera salvo em `chat_contacts`)
   - Telefone (obrigatorio, com mascara brasileira)
   - Selecao de instancia: Z-API ou Meta API (com seletor de numero Meta)
   - Se Meta API selecionada: opcao de enviar via **template** ou **mensagem normal**

3. **Se escolher template:**
   - Listar templates aprovados da Meta (reutilizando o endpoint `meta-whatsapp-get-templates`)
   - Ao selecionar template, mostrar preview com variaveis
   - Permitir preencher variaveis manualmente OU puxar dados do lead/cliente:
     - Buscar na tabela `customers` e `pos_customers` pelo telefone digitado
     - Se encontrado, disponibilizar variaveis como: `{{nome}}`, `{{email}}`, `{{cidade}}`, `{{estado}}`
   - Enviar via `meta-whatsapp-send-template`

4. **Se escolher mensagem normal** (ou Z-API):
   - Campo de texto livre para digitar a primeira mensagem
   - Enviar via `zapi-send-message` ou `meta-whatsapp-send`

5. **Apos envio:**
   - Salvar mensagem em `whatsapp_messages`
   - Salvar contato em `chat_contacts` com o nome digitado
   - Abrir automaticamente a conversa recem-criada

**Alteracoes em `POSWhatsApp.tsx`:**
- Adicionar botao "+ Nova Conversa" no header
- Criar state e Dialog para nova conversa
- Integrar com `meta-whatsapp-get-templates` para listagem de templates
- Integrar com busca de dados do lead para preenchimento automatico de variaveis

---

### Resumo dos Arquivos

| Arquivo | Acao | Detalhes |
|---------|------|----------|
| `src/components/pos/POSSalesView.tsx` | MODIFICAR | Dashboard real-time com Supabase Realtime, card de "Novas", query em whatsapp_messages |
| `src/components/pos/POSWhatsApp.tsx` | MODIFICAR | Botao "+ Nova Conversa", dialog com templates, aceitar filtro "new" |
| `src/components/pos/POSProductCatalogSender.tsx` | MODIFICAR | Filtros colecao/tamanho, foto por variante, exibicao melhorada |
| `src/lib/shopify.ts` | MODIFICAR | Query GraphQL com image por variante e collections |

### Detalhes Tecnicos

**Query GraphQL atualizada (shopify.ts):**

```text
variants(first: 100) {
  edges {
    node {
      id
      title
      sku
      price { amount }
      compareAtPrice { amount }
      availableForSale
      selectedOptions { name value }
      image { url }          // NOVO: foto especifica da variante
    }
  }
}
collections(first: 20) {     // NOVO: colecoes do produto
  edges {
    node { title handle }
  }
}
```

**Logica do dashboard (POSSalesView.tsx):**

```text
// Query para contar conversas sem resposta
1. Buscar ultimas mensagens por telefone de whatsapp_messages
2. Agrupar por phone
3. Contar onde ultima msg e direction='incoming' E existe msg outgoing anterior -> "Aguardando"
4. Contar onde TODAS msgs sao direction='incoming' -> "Novas"
5. Assinar canal Realtime em whatsapp_messages para refresh automatico
```

**Fluxo "Nova Conversa":**

```text
Vendedor clica "+ Nova Conversa"
  -> Digita nome e telefone
  -> Escolhe instancia (Z-API ou Meta)
  -> Se Meta:
       -> Escolhe: "Template" ou "Mensagem normal"
       -> Se Template:
            -> Lista templates aprovados
            -> Seleciona template
            -> Preenche variaveis (manual ou auto do lead)
            -> Envia via meta-whatsapp-send-template
       -> Se Mensagem normal:
            -> Digita texto
            -> Envia via meta-whatsapp-send
  -> Se Z-API:
       -> Digita texto
       -> Envia via zapi-send-message
  -> Salva em whatsapp_messages + chat_contacts
  -> Abre conversa automaticamente
```

