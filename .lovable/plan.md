
# Plano: Melhorias no PDV - Busca, Chat e Limpeza de Abas

## 1. Corrigir Build Error (cn import)

**Arquivo**: `src/components/pos/POSConfig.tsx` (linha 1364)
- Adicionar `import { cn } from "@/lib/utils"` que esta faltando

---

## 2. Scroll Vertical nos Resultados de Busca de Produtos

**Arquivo**: `src/components/pos/POSSalesView.tsx` (linhas 1128-1148)
- Atualmente os resultados da busca sao renderizados em um `div` sem limite de altura
- Envolver os resultados em um container com `max-h-[300px] overflow-y-auto` para permitir rolagem vertical quando ha muitas variacoes

---

## 3. Renomear "Vendas Dia" para "Pedidos de Vendas"

**Arquivo**: `src/pages/POS.tsx` (linha 40)
- Alterar o label da secao `daily` de `"Vendas Dia"` para `"Pedidos de Vendas"`
- O header dentro do `POSDailySales.tsx` (linha 637) tambem sera atualizado de "Vendas" para "Pedidos de Vendas"

---

## 4. Refinar Busca do Tiny (Problema Principal)

**Problema**: A API do Tiny (`pedidos.pesquisa.php`) faz busca generica e retorna pedidos irrelevantes (ex: buscar "Matthews" traz "Maeda Mariane", "Kelly Cristiane Romero" etc.)

**Solucao**: Filtrar os resultados do Tiny no backend antes de devolver ao frontend.

**Arquivo**: `supabase/functions/pos-tiny-search-orders/index.ts`
- Apos receber os resultados do Tiny, filtrar `customer_name` para verificar se contem o termo buscado (case-insensitive)
- Apenas retornar pedidos cujo nome do cliente realmente corresponde ao termo de busca
- Isso elimina resultados falso-positivos da API do Tiny

---

## 5. Busca Cross-Store (Todas as Lojas) no Historico

**Problema atual**: A busca local (`searchAllPeriods`) filtra apenas por `store_id` da loja atual. O usuario quer ver compras de TODAS as lojas.

**Arquivo**: `src/components/pos/POSDailySales.tsx` (funcao `searchAllPeriods`)
- Remover o filtro `.eq("store_id", storeId)` da query de vendas globais para buscar em todas as lojas
- Carregar a lista de lojas (`pos_stores`) para exibir o nome da loja em cada resultado
- No `renderSaleCard`: adicionar badge com o nome da loja quando for de outra loja
- Na busca do Tiny: buscar em TODAS as lojas (iterar pelos tokens de cada store), nao apenas na loja atual

---

## 6. Informar Vendedor nos Detalhes do Pedido Tiny

**Arquivo**: `supabase/functions/pos-tiny-search-orders/index.ts`
- No modo `detail`: extrair o campo `vendedor` do pedido Tiny (normalmente em `pedido.vendedor` ou `pedido.nome_vendedor`)
- Retornar como campo `seller_name` no objeto `detail`

**Arquivo**: `src/components/pos/POSSaleDetailDialog.tsx`
- Exibir o nome do vendedor nos detalhes do pedido Tiny (campo `seller_name`)

---

## 7. Excluir Aba "Ranking" (Gamification)

**Arquivo**: `src/pages/POS.tsx`
- Remover a entrada `{ id: "gamification", label: "Ranking", icon: Trophy }` do array `SECTIONS`
- Remover o render condicional `{section === "gamification" && <POSGamificationMini ... />}`
- Remover import do `POSGamificationMini`
- Nota: O arquivo `POSGamificationMini.tsx` sera mantido pois pode ser reutilizado no futuro

---

## 8. Excluir Aba "Estoque Exp." (Stock Requests da Expedicao)

**Arquivo**: `src/pages/POS.tsx`
- Remover a entrada `{ id: "stockcheck", label: "Estoque Exp.", icon: Package, badge: true }` do array `SECTIONS`
- Remover o render condicional `{section === "stockcheck" && <POSStockRequests ... />}`
- Remover import do `POSStockRequests`
- As solicitacoes de estoque da expedicao ja chegam na aba "Solicitacoes" (`POSInterStoreRequests`) que e o destino correto

---

## 9. Chat da Equipe - Envio de Imagens, Audios e Confirmacao de Leitura

**Arquivo**: `src/components/pos/POSTeamChat.tsx`

### Envio de Imagens
- Adicionar botao de anexo (icone de imagem/paperclip) ao lado do input
- Usar `uploadMediaToStorage` (ja disponivel no projeto) para fazer upload
- Inserir mensagem com `message_type: 'image'` e `metadata: { media_url: ... }`
- No `renderMessage`: renderizar imagens inline quando `message_type === 'image'`

### Envio de Audios
- Adicionar botao de microfone (similar ao `ChatView.tsx` que ja tem essa funcionalidade)
- Gravar audio usando `MediaRecorder`, fazer upload via `uploadMediaToStorage`
- Inserir mensagem com `message_type: 'audio'` e `metadata: { media_url: ... }`
- No `renderMessage`: renderizar player de audio quando `message_type === 'audio'`

### Confirmacao de Leitura
- Necessaria nova tabela ou coluna no banco para rastrear quem leu cada mensagem
- Adicionar tabela `team_chat_reads` com colunas: `id`, `message_id`, `reader_name`, `read_at`
- Quando o usuario visualiza mensagens, inserir registros de leitura para mensagens nao lidas
- Exibir abaixo de cada mensagem os nomes de quem ja leu (ex: "Lido por: Ana, Bia")
- Usar Realtime para atualizar confirmacoes em tempo real

---

## Migracao SQL Necessaria

```text
team_chat_reads (NOVA)
  id UUID PK DEFAULT gen_random_uuid()
  message_id UUID NOT NULL (FK para team_chat_messages.id)
  reader_name TEXT NOT NULL
  read_at TIMESTAMPTZ DEFAULT now()
  UNIQUE(message_id, reader_name)
```

---

## Sequencia de Implementacao

1. Fix build error (`cn` import) - imediato
2. Scroll nos resultados de busca de produtos
3. Renomear aba "Vendas Dia" -> "Pedidos de Vendas"
4. Excluir abas "Ranking" e "Estoque Exp."
5. Refinar busca do Tiny (filtro no backend)
6. Busca cross-store no historico
7. Vendedor nos detalhes do Tiny
8. Chat: imagens, audios e confirmacao de leitura (migracao + frontend)

## Arquivos a Modificar

- `src/components/pos/POSConfig.tsx` - fix cn import
- `src/components/pos/POSSalesView.tsx` - scroll nos resultados
- `src/pages/POS.tsx` - renomear aba, excluir Ranking e Estoque Exp
- `src/components/pos/POSDailySales.tsx` - busca cross-store, header rename
- `supabase/functions/pos-tiny-search-orders/index.ts` - filtro de nome + vendedor
- `src/components/pos/POSSaleDetailDialog.tsx` - exibir vendedor do Tiny
- `src/components/pos/POSTeamChat.tsx` - imagens, audios, confirmacao de leitura
