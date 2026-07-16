
## Diagnóstico

Investigando **Bota Texana em Couro Anita** (`parent_sku=100025`):
- Módulo Estoque tem 12 variantes corretas em `product_variants` (Cafe/Preto × 34-39) com barcodes reais (`7892719060016`, `7891806186530`, ...).
- No PDV (`pos_products`) existem 2 cadastros por variação/loja: um com SKU `100025-CAFE-35` (barcode que casa com `product_variants` → vinculado ao Estoque) e outro com SKU `7899304763598` (barcode diferente → aparece em Divergências).
- Ambos foram criados em 10/jun/2026 na mesma sincronização. **Alguns duplicados têm estoque** (ex.: Cafe 35 na Pérola = 1 par no cadastro fantasma).
- Risco: vendas podem sair do cadastro fantasma sem abater o Estoque real.

**Padrão para identificar o cadastro certo:** para um `pos_products` divergente `(parent_sku, color, size, barcode X)`, existe outro `pos_products` **mesma tripla** `(parent_sku, color, size)` cujo `barcode` bate com uma linha em `product_variants` (mesmo `sku_root`, `color`, `size`) — esse é o oficial; o divergente é o duplicado.

## O que muda na aba Divergências PDV

### 1. Novo agrupamento visual por pai
- Substituir a lista plana por lista agrupada em **card por `parent_sku`**, mostrando:
  - Nome-base do modelo + `parent_sku`.
  - Se existe pai correspondente em `products_master` (sku_root), badge verde "vinculado ao Estoque"; senão badge âmbar "sem pai no Estoque".
  - Linhas filhas expansíveis: cor · tamanho · barcode divergente · lojas · e coluna **"Cadastro correto encontrado"** (mostra SKU/barcode do irmão vinculado ao Estoque quando existir, ou "—" quando não).
  - Botão **Excluir divergentes** (por linha e por pai inteiro) — só habilita quando existir cadastro correto irmão.
  - Botão **Unificar** por pai (chama o consolidate existente com escopo neste `parent_sku`).

### 2. Nova RPC `list_pos_estoque_divergences_grouped(p_search, p_limit, p_offset)`
- Retorna: `parent_sku`, `parent_name`, `has_master`, e `variants jsonb[]` cada uma com `{sku, barcode, color, size, store_count, correct_sku, correct_barcode, correct_stock_sum, divergent_stock_sum}`.
- `correct_*` = `pos_products` irmão (mesmo `parent_sku+color+size`) cujo `barcode` casa com `product_variants` (via `sku_root/color/size`).

### 3. Nova RPC `delete_pos_divergent_variant(p_parent_sku, p_barcode)` — SECURITY DEFINER
Executa em transação para todas as lojas:
1. Localiza a linha "correta" por loja: `pos_products` com mesmo `(parent_sku, color, size)` cujo `barcode` casa com `product_variants`. Se não existir em alguma loja com estoque no divergente > 0, **cria** a linha correta copiando price/cost/name do divergente + barcode/sku oficial.
2. Migra estoque: `correta.stock += divergente.stock`.
3. Registra 2 linhas em `pos_stock_adjustments` (`type='entrada'` no correto, `type='saida'` no divergente, `reason='Fusão de cadastro duplicado PDV'`).
4. `DELETE FROM pos_products WHERE parent_sku=... AND barcode=... AND barcode <> correct_barcode`.
5. Retorna `jsonb` com contagens: `rows_deleted`, `stock_migrated`, `stores_affected`.

Só permite excluir quando existe cadastro correto (`correct_barcode` não nulo) — protege contra apagar sem migrar. Se o usuário quiser eliminar um divergente sem cadastro correto, precisa antes rodar Unificar (consolidate) para criar o pai.

### 4. RPC auxiliar `delete_pos_divergent_parent(p_parent_sku)`
Loop chamando `delete_pos_divergent_variant` para todos os divergentes daquele pai (batch).

### 5. UI (`InventoryPosDivergences.tsx`)
- Trocar `list_pos_estoque_divergences` por `list_pos_estoque_divergences_grouped`.
- Renderizar collapsible por pai (usar `Accordion` do shadcn).
- Diálogo de confirmação (`AlertDialog`) antes de excluir, mostrando: nº de variações, nº de lojas, pares que serão migrados.
- Toast com resumo pós-exclusão + `loadRows` local sem reload da página inteira.

## Segurança
- Nenhuma alteração em `product_variants`/`products_master`.
- Trigger existente `trg_reactivate_pos_product_on_stock` continua funcionando (o "correto" pode virar `is_active=true` ao ganhar estoque).
- Espelho Shopify roda normal (via SUM por barcode compartilhado).
- Ajustes gravados em `pos_stock_adjustments` deixam trilha completa e permitem estorno manual se necessário.

## Arquivos

**Nova migration** (RPCs + grants):
- `list_pos_estoque_divergences_grouped`
- `delete_pos_divergent_variant`
- `delete_pos_divergent_parent`

**Editado:**
- `src/components/inventory/InventoryPosDivergences.tsx` — agrupamento, botões Excluir/Unificar por pai, dialogs de confirmação, refresh local.

Nenhum arquivo do fluxo de vendas, expedição ou espelhamento é tocado.
