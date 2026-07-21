
## Diagnóstico — como o estoque funciona hoje

Existem **três tabelas** envolvidas, com papéis diferentes, e o espelhamento entre elas é **parcial**:

| Tabela | O que é | Onde aparece |
|---|---|---|
| `products_master` (+ `product_variants`) | Cadastro "cabeça" do produto Legacy (SKU root, NCM, peso, dimensão, custo, venda, imagens, marca, categoria) e suas variações (cor/tamanho/GTIN/SKU) | Aba **Legacy** |
| `product_master_data` (PMD) | Cabeçalho paralelo do Catálogo Unificado, com quase os MESMOS campos, chaveado por `parent_sku` | Aba **Catálogo Unificado** |
| `pos_products` | Estoque físico por loja (Centro, Perola, Site/Live) — 1 linha por variação × loja | PDV, dashboards, vendas, Shopify |

**Chave comum:** `products_master.sku_root = product_master_data.parent_sku`. Hoje 456 vs 460 (4 órfãos no PMD, incluindo o "Babuches Banana" que você apagou no Legacy).

### O que já espelha automaticamente

- **Nome do Legacy → `pos_products.name`**: trigger `trg_master_name_to_pos` / `sync_master_to_pos`.
- **`pos_products` → Legacy (`products_master` + `product_variants`)**: trigger `trg_pos_to_catalog` / `sync_pos_product_to_estoque` cria pai/variação no Legacy quando surge algo novo no PDV.
- **Custo do Legacy → `pos_products`**: trigger `trg_mirror_pos_product_cost_price`.
- **Estoque do PDV → dashboard**: trigger `trg_sync_pos_product_to_estoque`, cache multi-loja.
- **Vendas do PDV**: dão baixa em `pos_products` via `apply_pos_sale_stock_movement` (memória: Shopify mirror ativo).

### O que NÃO espelha (causa dos seus bugs)

1. **`products_master` ↔ `product_master_data` não têm nenhum trigger de sincronização.**
   - Editar nome/NCM/peso/dimensão/marca/categoria/custo/venda/imagens no Legacy **não atualiza** o Unificado, e vice-versa.
   - **Deletar** no Legacy **não deleta** no Unificado (por isso o Babuches Banana continua na aba Unificado).
   - Só o **nome** vaza indiretamente via `pos_products` (Legacy→POS→dashboard), mas o cabeçalho do Unificado (PMD) fica congelado.

2. **GTIN/dimensões por variação**: alterar `product_variants.gtin/sku` no Legacy não reflete em `pos_products.barcode/sku`. Idem preço de venda por variação.

3. **Estoque na aba Legacy** usa `product_variants.initial_stock` (fotografia antiga), enquanto o Unificado soma `pos_products.stock` em tempo real. Por isso os dois "totais" divergem.

4. **Exclusão em massa** no Legacy remove `products_master` + `product_variants`, mas nunca toca em PMD nem em `pos_products` — deixa "fantasmas" nas duas abas.

## Plano de correção — 4 etapas incrementais

### Etapa 1 — Unificar a fonte de verdade do cabeçalho (Legacy ↔ Unificado)

Criar **triggers bidirecionais** entre `products_master` e `product_master_data`, com guarda `is_sync_in_progress()` (padrão já usado no projeto) para evitar loop.

Campos espelhados nos dois sentidos:
`name, description, brand, brand_id, category, category_id, ncm, cest, origem, unidade, cost_price, sale_price, weight_kg, height_cm, width_cm, length_cm, images, shopify_product_id, tiny_product_id, is_active, needs_review, review_reason`.

- `AFTER INSERT/UPDATE ON products_master` → upsert em `product_master_data` (`parent_sku = sku_root`).
- `AFTER INSERT/UPDATE ON product_master_data` → upsert em `products_master` (usando `sku_root = parent_sku`; cria SKU root se não existir).
- `AFTER DELETE ON products_master` → delete em `product_master_data` pelo `parent_sku`.
- `AFTER DELETE ON product_master_data` → delete em `products_master` pelo `sku_root` (com `product_variants` caindo por `ON DELETE CASCADE` que já existe).

**Backfill inicial:**
- Reconciliar as 456 linhas hoje divergentes (Legacy vence para os pais que existem nos dois lados).
- Limpar os 4 órfãos do PMD (incluindo o Babuches Banana que você já apagou no Legacy).

### Etapa 2 — Espelhar variações e o que chega ao PDV

- Trigger `AFTER UPDATE ON product_variants` para propagar `sku`, `gtin`, `color`, `size`, `sale_price_override`, `cost_price_override` para as linhas correspondentes em `pos_products` (match por `tiny_variant_id` → `sku` → `gtin`, mesma ordem que `sync_master_to_pos` já usa).
- Ajustar `sync_master_to_pos` para espelhar também `weight_kg`, `dimensions`, `ncm`, `cost_price` (não só nome) — mantém a mesma guarda anti-loop.

### Etapa 3 — Estoque exibido no Legacy vira "tempo real"

Trocar a leitura do card Legacy: em vez de `product_variants.initial_stock`, somar `pos_products.stock` agrupado por `master_id` (via join GTIN/SKU/tiny_id). Isso faz Legacy e Unificado mostrarem exatamente o mesmo número, sempre atualizado por venda.

### Etapa 4 — Exclusão robusta

- No frontend (`LegacyProductsList.deleteMaster` e `UnifiedProductsList` bulk delete): a exclusão passa a chamar uma única RPC `delete_master_cascade(sku_root)` que apaga em ordem: `product_variants` → `products_master` → `product_master_data` → (opcional) desativa `pos_products` para não sumir histórico de vendas (memória: `pos_products` inativo = sem estoque; se ganhar estoque, reativa sozinho).
- Bulk delete idem, usando uma RPC array-in.

## Análise de risco (o que pode quebrar)

| Risco | Probabilidade | Como mitigo |
|---|---|---|
| **Loop infinito** entre os dois novos triggers e o `sync_master_to_pos` existente | Média | Usar a mesma flag `app.sync_in_progress` já usada pelo `sync_master_to_pos` e `sync_pos_product_to_estoque`; testo com uma edição real antes de liberar. |
| **Backfill inicial** sobrescreve dados divergentes (ex.: nome diferente nos dois lados) | Alta em teoria; baixa na prática (456/456 já batem) | Regra explícita: **Legacy vence** no backfill. Rodo um `SELECT` de diffs antes de aplicar e te envio a lista dos casos onde os cabeçalhos divergem para você aprovar. |
| Deletar em cascata apagar produto que ainda tem venda no histórico | Média | Não apago `pos_products`, só desativo (`is_active=false`); vendas passadas continuam consultáveis. O trigger de reativação por estoque continua valendo. |
| Estoque "tempo real" no Legacy ficar mais lento | Baixa | Índices já existem em `pos_products(sku, barcode, tiny_id)`; a query é a mesma agregação que o Unificado já roda hoje. |
| Espelhamento de custo/preço no Legacy sobrescrever override manual por variação | Média | Espelho apenas os campos do **pai**; overrides continuam em `product_variants` (já é o comportamento atual). |
| Fluxos que dependem só de PMD (edge functions `create-master-product-pos`, `delete-master-products`, `apply_catalog_sync_from_pos` — este último já foi removido) | Baixa | Com o espelhamento, escrever em qualquer um dos dois lados fica equivalente. Reviso essas edge functions no mesmo turno para garantir. |
| Shopify (sync de estoque compartilhado) | Muito baixa | O trigger que dispara `shopify-mirror-stock` está em `pos_products`; não muda. Fica ainda mais consistente porque o cabeçalho passa a ser único. |

**Áreas que NÃO serão mexidas** (para não regredir): `apply_pos_sale_stock_movement`, `shopify-mirror-stock`, trigger de reativação por estoque, dedup por barcode, expedição/Tiny (já desacoplado), NF-e golden payload, fluxos de troca/devolução.

## Recomendação

Aprovar a Etapa 1 primeiro (espelhamento de cabeçalho + backfill + limpeza do Babuches Banana). É o que resolve 100% do que você descreveu no bug. Depois seguimos com 2, 3 e 4 sem risco cumulativo — cada etapa é independente e reversível (drop trigger volta ao estado atual).
