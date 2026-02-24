
## Plano: Cross-Sell por Tamanho, Conferencia Online, Trocas com Pedido Original, Limpeza de Vendedores

Este plano cobre 4 areas principais de correcao e novas funcionalidades.

---

### 1. Sugestoes Inteligentes - Filtro por Tamanho Real + Deduplicacao

**Problema:** O campo `size` no banco de dados e inconsistente -- muitos produtos tem cores (ex: "Bege", "Caramelo") ao inves de numeracao. Alem disso, o sistema sugere o mesmo modelo em cores/tamanhos diferentes, ao inves de produtos variados.

**Correcao no `POSCrossSellSuggestions.tsx`:**
- Extrair tamanho REAL do nome do produto (regex no padrao `- 34 -` ou `- 34` no final) ao inves de confiar no campo `size`
- Aplicar mesma logica para produtos do carrinho: extrair tamanho do `name` do cart item
- Filtrar por tamanho numerico exato (ex: se carrinho tem "34", so sugerir produtos com "34" no nome)
- Deduplicar por "produto pai" (nome base antes do primeiro ` - `), exibindo apenas 1 variacao por modelo
- Diversificar curvas: garantir mix de Curva A (sem desconto), Curva B (15%), Curva C (30%) e Dead Stock (50%)
- Priorizar categorias diferentes do item ja no carrinho (ex: se tem tenis, sugerir sandalia, sapatilha)

**Logica de extracao de tamanho:**
```text
Nome: "993005 TENIS FEMININO NICE - 34 - Bege"
Regex: / - (\d{2,3}(?:\/\d{2,3})?) (?:- |$)/
Resultado: "34"
```

---

### 2. Conferencia de Pedido Online (Aba ONLINE)

**Novo processo em `POSOnlineSales.tsx`:**

Apos finalizar a venda online, antes de fechar, exibir uma etapa de conferencia:

- **Bipagem/Busca**: Campo para escanear codigo de barras ou buscar produto por nome. O sistema verifica se o produto bipado corresponde a um item do pedido
- **Checklist por item**:
  - "Pes verificados" (checkbox)
  - "Sem defeitos" (checkbox)
- Todos os itens devem ser conferidos antes de liberar o pedido
- Ao concluir conferencia com sucesso, o vendedor ganha pontos de bonus (registrado em uma tabela `pos_seller_bonus` ou incrementado na tabela existente)
- Salvar registro de conferencia no `pos_sales` (campo `verified_at`, `verified_by`)

**Migracao SQL:** Adicionar colunas em `pos_sales`:
```text
verified_at        timestamptz nullable
verified_by        uuid nullable
verification_data  jsonb nullable  -- detalhes dos itens conferidos
```

---

### 3. Trocas/Devolucoes com Busca de Pedido Original

**Reestruturacao do fluxo em `POSExchanges.tsx`:**

**Passo 1 - Buscar Pedido Original (obrigatorio):**
- Campo de busca unificado: pesquisar por GTIN, nome do produto, nome do cliente, telefone, CPF
- Buscar em DUAS fontes:
  - Tabela local `pos_sales` + `pos_sale_items` (vendas recentes do POS)
  - API do Tiny via `pos-tiny-search-orders` (vendas antigas)
- Exibir lista de resultados com: data, cliente, total, itens
- Ao selecionar um pedido, carregar automaticamente:
  - Os itens do pedido (para selecionar quais estao sendo devolvidos)
  - O vendedor que realizou a venda (para rastreamento)

**Passo 2 - Selecionar Itens Devolvidos:**
- Exibir itens do pedido original como checkboxes
- Motivos especificos por item: "Defeito", "Pes trocados", "Tamanho errado", "Outro"
- Campo `original_seller_id` preenchido automaticamente

**Passo 3 - Registrar Reclamacao:**
- Quando motivo = "pes_trocados" ou "defeito", registrar automaticamente na nova tabela `pos_seller_complaints`:

```text
id              uuid PK
store_id        uuid FK
seller_id       uuid FK -> pos_sellers
exchange_id     uuid FK -> pos_exchanges
sale_id         text nullable  -- referencia ao pedido original
complaint_type  text NOT NULL  -- 'wrong_feet', 'defective'
product_name    text
notes           text nullable
created_at      timestamptz
```

**Migracao SQL:** Criar tabela `pos_seller_complaints` + adicionar colunas em `pos_exchanges`:
```text
original_sale_id       text nullable      -- ID do pedido original (POS ou Tiny)
original_sale_source   text nullable      -- 'pos' ou 'tiny'
original_seller_id     uuid nullable FK   -- vendedor da venda original
original_seller_name   text nullable
```

**Dashboard:** Adicionar em `POSDashboard.tsx` um card mostrando:
- Reclamacoes por vendedor (pes trocados / defeitos)
- Ranking de vendedores com mais ocorrencias

---

### 4. Limpeza de Vendedores Duplicados (Perola)

**Problema:** A loja Perola tem vendedores duplicados -- ex: "Live Shopping" aparece 8 vezes com o mesmo `tiny_seller_id`.

**Solucao:**
- Modificar o `pos-tiny-sellers` edge function para:
  1. Antes de sincronizar, buscar vendedores ativos da API do Tiny
  2. Deletar TODOS os vendedores da loja no banco (`pos_sellers WHERE store_id = X`)
  3. Re-inserir apenas os vendedores ativos retornados pela API
  4. Na API v2, filtrar por `situacao = 'A'` (o filtro atual nao funciona corretamente porque o campo `situacao` nao esta sendo mapeado no retorno)
- Isso resolve duplicatas e garante que vendedores inativos/excluidos nao aparecam

---

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| Migracao SQL | Criar `pos_seller_complaints` + expandir `pos_exchanges` + expandir `pos_sales` |
| `src/components/pos/POSCrossSellSuggestions.tsx` | Filtro por tamanho real + deduplicacao por produto pai + diversidade de curvas |
| `src/components/pos/POSOnlineSales.tsx` | Adicionar etapa de conferencia pos-venda |
| `src/components/pos/POSExchanges.tsx` | Refazer fluxo: buscar pedido original, selecionar itens, registrar reclamacao |
| `supabase/functions/pos-tiny-sellers/index.ts` | Limpar duplicatas: deletar todos e re-inserir apenas ativos |
| `src/components/pos/POSDashboard.tsx` | Card de reclamacoes por vendedor |

### Ordem de Implementacao

1. Migracao SQL (novas tabelas e colunas)
2. Fix cross-sell (tamanho real + deduplicacao)
3. Limpeza vendedores duplicados (edge function)
4. Conferencia de pedido online
5. Trocas com pedido original + reclamacoes + dashboard
