
# Plano: Refinamento Completo do PDV - Bugs, Busca, Trocas, Caixa e Chat

## Problemas Identificados e Solucoes

---

## 1. Erro na Criacao de Metas

**Problema**: A tabela `pos_goals` existe e tem todas as colunas corretas. O `saveGoal` faz insert normal. O erro provavelmente vem de politicas RLS que bloqueiam a escrita, ou de tentativas de inserir `goal_value` vazio (a funcao retorna cedo se `!g.goal_value`).

**Solucao**: 
- Adicionar tratamento de erro explicito no `saveGoal` para exibir a mensagem real do erro no toast
- Verificar se o campo `goal_value` esta sendo parseado corretamente (o `parseFloat` de string vazia retorna NaN)
- Garantir que o dialog de metas valide todos os campos obrigatorios antes de submeter

**Arquivo**: `src/components/pos/POSConfig.tsx`

---

## 2. Erro na Sincronizacao de Categorias do Tiny

**Problema**: A Edge Function `tiny-sync-categories` nao tem logs, indicando que nunca foi chamada ou que falha silenciosamente. A funcao busca categorias a partir de contas a pagar/receber, nao de categorias de **produtos**. Para categorias de produtos, a API correta e diferente.

**Solucao**: Verificar de onde o frontend esta chamando essa funcao. A funcao atual extrai categorias de contas financeiras (contas a pagar/receber) que e o uso correto para o modulo financeiro. Se o usuario precisa de categorias de produtos, precisa de uma funcao separada ou usar os dados ja sincronizados em `pos_products.category`. 

**Arquivo**: `supabase/functions/tiny-sync-categories/index.ts` - Adicionar logs mais detalhados e tratamento de erro

---

## 3. Busca de Produtos sem Acento e Case-Insensitive (Aba Vendas)

**Problema**: A busca atual usa `ilike` que e case-insensitive mas nao ignora acentos. Buscar "calcado" nao encontra "Calcado".

**Solucao**: 
- Usar a extensao `unaccent` do PostgreSQL (ja disponivel) para normalizar acentos
- Criar uma funcao SQL `search_products_unaccent` que faca `unaccent(name) ILIKE unaccent(term)`
- Alternativa mais simples no frontend: normalizar o termo de busca removendo acentos antes de enviar

**Implementacao**: No frontend (`POSSalesView.tsx`), normalizar o termo de busca com uma funcao `removeAccents()` e comparar com dados normalizados. Na query local, usar `unaccent()` no SQL.

**Arquivos**: `src/components/pos/POSSalesView.tsx`, migracao SQL para habilitar `unaccent`

---

## 4. Busca de Clientes sem Acento e Case-Insensitive (Aba Pedidos)

**Problema**: Mesmo problema que acima mas na busca de historico de pedidos (POSDailySales).

**Solucao**: Aplicar a mesma normalizacao com `unaccent()` nas queries de busca de clientes.

**Arquivo**: `src/components/pos/POSDailySales.tsx`

---

## 5. Trocas - Nao Puxa Pedidos POS e Tiny / Criar Troca Sem Pedido / Cross-Store

**Problemas identificados**:
1. A busca de pedidos POS filtra por `store_id` - nao encontra pedidos de outras lojas
2. A busca do Tiny usa `search` em vez de `search_term` como parametro da Edge Function
3. Nao ha opcao de criar troca sem pedido original
4. Colunas `original_sale_source`, `original_seller_id`, `original_seller_name` nao existem na tabela `pos_exchanges`

**Solucao**:
- **Migracao SQL**: Adicionar colunas faltantes em `pos_exchanges`
- **Cross-store**: Remover `.eq("store_id", storeId)` da busca POS para puxar de todas as lojas
- **Fix parametro Tiny**: Usar `search_term` em vez de `search`
- **Troca sem pedido**: Adicionar botao "Criar Sem Pedido" que pula direto para o step de detalhes
- **Adicionar badge de loja**: Mostrar de qual loja vem cada pedido nos resultados

**Arquivos**: `src/components/pos/POSExchanges.tsx`, migracao SQL

---

## 6. Cores por Vendedora no Chat Interno

**Problema**: Todas as mensagens no chat da equipe tem a mesma cor.

**Solucao**: Gerar uma cor unica por `sender_name` usando hash do nome. Criar um array de cores predefinidas e mapear cada nome a uma cor.

**Arquivo**: `src/components/pos/POSTeamChat.tsx`

---

## 7. Desconto na Aba Online Nao Funciona

**Problema**: Analisando o codigo, o `discountAmount` e calculado corretamente, o `cartTotal` reflete o desconto, MAS o `cartSubtotal` e usado na exibicao do total no header do carrinho (linha 770: `{fmt(cartTotal)}`). O desconto parece funcionar. 

**Verificacao adicional**: A tabela `pos_sales` NAO tem coluna `discount_amount` - ela tem `discount`. O insert usa `discount_amount` que nao existe, entao o dado e ignorado silenciosamente pelo `as any`.

**Solucao**: 
- Usar a coluna `discount` existente em vez de `discount_amount`
- Verificar que o total salvo e `cartTotal` (com desconto) e nao `cartSubtotal`

**Arquivo**: `src/components/pos/POSOnlineSales.tsx`

---

## 8. Checkout - Nao Mostra Desconto de Forma Chamativa

**Problema**: O `OrderSummary` no checkout mostra o desconto mas de forma discreta.

**Solucao**: Adicionar um banner chamativo tipo "premio" mostrando quanto a pessoa economizou, com cores vibrantes e icone de presente.

**Arquivo**: `src/pages/StoreCheckout.tsx`

---

## 9. Remover Botao "Checkout" da Aba Online / Fix Link Duplicado / Destaque Checkout Loja

**Problemas**:
1. Remover gateway "checkout" da lista `GATEWAYS`
2. O link gerado e sempre o mesmo porque usa `sale.id` do primeiro pedido - o bug e que o link nao esta sendo resetado entre vendas (`resetSale` limpa `generatedLink` mas o `processPayment` pode estar reutilizando dados)
3. O botao "Checkout Loja" deve ser o maior

**Solucao**:
- Remover `{ id: "checkout", ... }` do array GATEWAYS
- Fix: garantir que `resetSale()` e chamado completamente antes de gerar novo link
- Fazer o botao "Checkout Loja" ocupar `col-span-2` com altura maior e estilo destacado
- Adicionar 10 pontos de gamificacao quando venda via checkout loja for finalizada

**Arquivo**: `src/components/pos/POSOnlineSales.tsx`

---

## 10. Forma de Pagamento "Vps" do Tiny

**Problema**: As formas de pagamento personalizadas (como "Vps") ja devem ser puxadas automaticamente pela Edge Function `pos-tiny-payment-methods`, que busca todas as formas de recebimento do Tiny.

**Solucao**: Verificar nos logs se a funcao esta retornando a forma "Vps". Se nao estiver, pode ser um problema de parsing. A funcao v2 usa `formas.recebimento.pesquisa.php` que retorna formas personalizadas. Garantir que o parsing aceita diferentes formatos de resposta.

**Arquivo**: `supabase/functions/pos-tiny-payment-methods/index.ts`

---

## 11. Recebimento de Crediario na Aba Caixa

**Problema**: Nao existe funcionalidade de receber crediarios pendentes.

**Solucao**: 
- Adicionar botao "Receber Crediario" na aba Caixa
- Ao clicar, abre dialog que busca vendas com `payment_method ILIKE '%crediario%'` e `status = 'pending'` ou similar
- Permitir buscar por nome/telefone/CPF do cliente
- Ao receber, selecionar forma de pagamento (dinheiro, cartao, pix)
- Se for dinheiro, registrar como deposito no caixa (reforco)
- Atualizar o status do crediario para "paid"

**Necessita migracao**: Adicionar coluna `crediario_status` e `crediario_paid_at` na tabela `pos_sales` (ou criar tabela separada `pos_crediario_receivables`)

**Arquivo**: `src/components/pos/POSCashRegister.tsx`, migracao SQL

---

## Migracoes SQL Necessarias

```text
1. Habilitar extensao unaccent (para busca sem acento)
   CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;

2. Adicionar colunas faltantes em pos_sales:
   seller_name TEXT
   customer_name TEXT
   customer_phone TEXT
   items_count INTEGER DEFAULT 0
   discount_amount NUMERIC DEFAULT 0

3. Adicionar colunas faltantes em pos_exchanges:
   original_sale_source TEXT
   original_seller_id UUID
   original_seller_name TEXT

4. Tabela pos_crediario (ou colunas em pos_sales):
   crediario_status TEXT DEFAULT 'pending'
   crediario_due_date DATE
   crediario_paid_at TIMESTAMPTZ
   crediario_paid_method TEXT
   crediario_paid_amount NUMERIC
```

---

## Sequencia de Implementacao

1. **Migracoes SQL** - Colunas faltantes + extensao unaccent
2. **Fix metas** - Tratamento de erro + validacao no POSConfig
3. **Fix desconto Online** - Usar coluna `discount` correta + fix link duplicado + remover Checkout + destaque Checkout Loja
4. **Busca sem acento** - POSSalesView + POSDailySales
5. **Trocas cross-store** - POSExchanges (busca todas lojas + troca sem pedido + fix parametro Tiny)
6. **Cores no chat** - POSTeamChat
7. **Checkout desconto chamativo** - StoreCheckout
8. **Crediario no Caixa** - POSCashRegister (nova funcionalidade)
9. **Categorias Tiny** - Verificar/fix Edge Function
10. **Pontos checkout loja** - Gamificacao ao finalizar venda

## Arquivos a Modificar

- Migracao SQL (nova)
- `src/components/pos/POSConfig.tsx` - fix metas
- `src/components/pos/POSOnlineSales.tsx` - fix desconto + remover checkout + destacar checkout loja + fix link
- `src/components/pos/POSSalesView.tsx` - busca sem acento
- `src/components/pos/POSDailySales.tsx` - busca sem acento
- `src/components/pos/POSExchanges.tsx` - cross-store + troca sem pedido + fix Tiny
- `src/components/pos/POSTeamChat.tsx` - cores por vendedora
- `src/pages/StoreCheckout.tsx` - desconto chamativo
- `src/components/pos/POSCashRegister.tsx` - recebimento de crediario
- `supabase/functions/tiny-sync-categories/index.ts` - logs e fix
- `supabase/functions/pos-tiny-payment-methods/index.ts` - verificar Vps
