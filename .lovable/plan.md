## Diagnóstico atual

- **17.468 produtos** em `pos_products` — apenas 95 têm algo em `category` (e mesmo assim valores tipo "S" e "Teste", inúteis).
- `products_master` (721 SKUs root) já tem coluna `category` mas também praticamente vazia.
- Não existe coluna de **gênero**, **faixa etária** ou **faixa de preço**.
- Coluna `size` está poluída (às vezes guarda cor como "Avelã", "PRETO"). Precisaremos extrair tamanho real do nome/variant também.
- Nomes seguem padrões fortes ("TENIS CASUAL...", "CHINELO MASCULINO...", "SANDALIA FEMININA...", "BIRKEN", "SALTO BEIRA RIO FEM...", "TAMANCO ANABELA FEMININA...") — dá pra classificar 80–90% por regras.

## O que vou implementar

### 1. Esquema novo

Tabela **`product_categories`** (catálogo fixo, editável):
- 15 categorias que você listou: Tênis Casual, Papetes, Tênis Esportivo, Saltos, Sandálias Baixas, Rasteirinhas, Chinelos, Tamancos, Botas, Babuches, Mocassim, Sapatilhas, Bolsas, Sapato Social Masculino, Chuteiras.
- Campos: `name`, `slug`, `keywords[]` (palavras que disparam match no nome), `default_gender` (quando a categoria força um gênero, ex.: "Saltos"→F, "Sapato Social Masculino"→M, "Rasteirinhas"→F, "Sapatilhas"→F, "Chuteiras"→M).

Tabela **`price_tiers`** (faixas de preço, editáveis):
- Seed: até 100 / 100-160 / 161-200 / 201-300 / 300+.
- Campos: `label`, `min_price`, `max_price`, `color` (cor pra dashboard).

Colunas novas em **`pos_products`** e **`products_master`**:
- `category_id uuid` (FK → product_categories)
- `gender text` ('masculino' | 'feminino' | 'unissex' | 'infantil')
- `age_group text` ('adulto' | 'infantil')
- `price_tier_id uuid` (FK → price_tiers; recalculado por trigger sempre que `price` mudar)
- `auto_classified boolean` (true quando feito por regra; permite override manual)
- `classification_confidence numeric` (0–1, útil pra revisão)

### 2. Motor de classificação automática

Edge function `inventory-auto-classify` que processa todos os produtos em lote:

**Categoria** — match por keywords no nome (case-insensitive, ordem de prioridade):
- "CHUTEIRA" → Chuteiras
- "BIRKEN", "PAPETE" → Papetes
- "BABUCHE", "BABUCHES" → Babuches
- "MOCASSIM", "MOCASSINS" → Mocassim
- "SAPATILHA" → Sapatilhas
- "RASTEIRINHA", "RASTEIRA" → Rasteirinhas
- "CHINELO" → Chinelos
- "TAMANCO", "ANABELA" → Tamancos
- "BOTA", "BOTINHA", "COTURNO" → Botas
- "SALTO", "SCARPIN", "PEEP TOE" → Saltos
- "SAPATO SOCIAL", "SOCIAL MASC" → Sapato Social Masculino
- "SANDALIA", "SANDÁLIA" (sem "salto") → Sandálias Baixas
- "TENIS ESPORTIVO", "RUNNING", "CORRIDA", "TRAINING" → Tênis Esportivo
- "TENIS", "TÊNIS" (default) → Tênis Casual
- "BOLSA", "BOLSINHA", "MOCHILA" → Bolsas

**Gênero** — prioridade:
1. Se categoria força gênero (Saltos→F, Social Masc→M, etc.) → usa esse.
2. Palavras no nome: "MASC", "MASCULINO", "HOMEM" → masculino. "FEM", "FEMININO", "MULHER", "DAMA" → feminino.
3. Por grade de tamanhos numéricos do SKU root (agrupando todas as variantes do mesmo `parent_sku`):
   - Maior tamanho ≤ 35 → infantil
   - Grade típica 34–40 / 34–41 → feminino
   - Grade típica 37–44 / 38–45 → masculino
   - Grade que cobre 34–44 (rara) → unissex
4. Fallback: unissex.

**Faixa etária**:
- Se gênero = infantil → infantil.
- Se algum tamanho da grade ≥ 36 → adulto.
- Senão → infantil.

**Faixa de preço** — trigger automático no insert/update de `price` cruza com `price_tiers` e preenche `price_tier_id`.

**Confiança**: regra forte (keyword + gênero no nome + grade coerente) → 1.0. Apenas keyword → 0.7. Fallback → 0.4. Produtos com confidence < 0.6 entram na fila "needs review".

### 3. UI no módulo Estoque

- **Página de Categorias** (`/inventory/categories`): CRUD da tabela `product_categories` e `price_tiers`. Mostra contagem de produtos por categoria.
- **Filtros novos** em `UnifiedProductsList.tsx`: categoria, gênero, faixa etária, faixa de preço.
- **Bulk edit**: selecionar N produtos e atribuir categoria/gênero manualmente (override).
- **Fila de revisão**: lista de produtos com `auto_classified=true AND confidence<0.6` pra você confirmar/corrigir em um clique.
- **Dashboard de saúde de estoque** (nova aba): pra cada combinação categoria × gênero × faixa de preço mostra:
  - Total de pares em estoque
  - Pares vendidos no período (cruzando com `orders`)
  - Cobertura por numeração (% de SKUs com pelo menos X unidades nas numerações 35-42)
  - Alerta vermelho quando faixa "atrai cliente" (60–100) está com grade incompleta nas numerações populares.

### 4. Rollout

1. Migração (cria tabelas, colunas, triggers, seeds).
2. Rodar `inventory-auto-classify` em background contra os 17k produtos (estimo 2–4 min).
3. Te entrego relatório: quantos foram classificados com alta confiança vs. quantos precisam revisão manual.
4. Você revisa a fila (estimo < 500 produtos duvidosos) e ajusta keywords se algum padrão sair errado.
5. Depois disso o agente de IA de estoque passa a ter contexto preciso pra responder "quantos pares de bota feminina adulto na faixa 100–160 temos com grade completa?".

## Detalhes técnicos

- Triggers garantem `price_tier_id` sempre consistente quando `price` muda.
- Regra de gênero por grade usa `parent_sku` pra agrupar variantes; quando não houver `parent_sku`, usa prefixo do SKU antes do hífen.
- Tudo idempotente: re-rodar o classificador NÃO sobrescreve produtos com `auto_classified=false` (overrides manuais ficam preservados).
- RLS: leitura aberta autenticado, escrita exige role admin/manager (mesmo padrão atual de `pos_products`).

Aprovando, executo a migração e o classificador na sequência.