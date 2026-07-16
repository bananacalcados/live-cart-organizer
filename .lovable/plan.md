# Plano de Limpeza e Exclusão em Massa dos Catálogos

## Contexto: Legacy ↔ Unificado estão vinculados?

Praticamente sim, mas não 100%:

- **Unificado → Legacy:** 519 dos 522 pais únicos do Catálogo Unificado têm o master correspondente no Legacy (99,4 %). Existem apenas **3 exceções** (`7142.101 TAMANCO MASSAGEADOR EM X`, `Tênis Nice`, `SANDALIA ULTRACONFORTO MARLLY`).
- **Legacy → Unificado:** 186 masters existem no Legacy sem espelho no Unificado — são os produtos que nunca foram "Enviados ao PDV".

O vínculo é feito pelo campo **`parent_sku` do Unificado = `sku_root` do Legacy**. Não existe FK dura entre as duas tabelas — é um vínculo lógico por string.

Por isso a cascata só deve ser aplicada quando o par de fato existir; nos casos órfãos, a exclusão em um lado não deve travar por falta do outro.

## Item 1 — Limpar os 162 órfãos do Legacy

Órfãos = registros em `products_master` **sem nenhuma linha em `product_variants`**. São o rastro deixado pela extinta `apply_catalog_sync_from_pos`.

Ação: `DELETE FROM products_master WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.master_id = id)`.

Salvaguardas antes do delete:
- Não apagar nenhum que esteja referenciado em `product_master_data` (parent_sku), `pos_products` (parent_sku) ou `purchase_invoice_items` — se algum órfão estiver amarrado a essas tabelas, mantém e loga.
- Migration única, transacional. Grava o número de linhas deletadas em `catalog_sync_log` (operation = `cleanup_orphan_masters`).

Nenhum efeito sobre PDV, Shopify ou vendas — órfãos não têm variantes nem estoque associado.

## Item 2 — Corrigir `sync-master-product-stock`

Hoje o default é `distribute_pos: 'replicate'`, que espalhou 3 pares do Modare Vitória em TODAS as lojas, inclusive Site/Live.

Mudanças na edge function:
- Remover o modo `replicate` como padrão. Passar a exigir `store_id` (loja de origem obrigatória).
- Estoque das variantes vai apenas para a loja indicada; demais lojas recebem 0 quando o SKU não existe, ou permanecem intocadas quando já existem.
- Nunca escrever em lojas com `is_simulation = true` (já ok) **e nunca em lojas com nome `Site/Live`, `Site + Centro`, `Lojas + Live`** (lista mantida no código a partir de uma flag `is_online_bucket` em `pos_stores` que já usamos ou por padrão de nome).
- Ajustar `LegacyProductsList.tsx → syncStock`: perguntar loja de origem antes de chamar (`Select` com lojas físicas).

Nada muda no fluxo de vendas nem no espelho Shopify.

## Item 3 — Multi-seleção + exclusão em massa (Legacy e Unificado)

### Legacy (`LegacyProductsList.tsx`)
- Adicionar `Checkbox` na 1ª coluna de cada linha + checkbox "Selecionar todos" no cabeçalho (respeitando o filtro/aba ativa).
- Já existe estado `selected: Set<string>` usado por "Unificar" — reaproveitar.
- Botão **"Excluir selecionados"** (destructive) ao lado dos botões atuais, com `AlertDialog` de confirmação mostrando quantos e listando os primeiros 10 nomes.
- Ao confirmar: chama uma edge function nova `delete-master-products` (ver seção técnica).

### Unificado (`UnifiedProductsList.tsx`)
- Mesmo padrão: Checkbox por linha do agrupamento pai + "Selecionar todos".
- Botão **"Excluir selecionados"** com confirmação.
- Chama a mesma edge function passando `parent_skus`.

### Cascata bidirecional
Ao excluir por qualquer lado, a edge function faz:
1. Resolve pares: para cada `master_id` recebido, busca `sku_root`; para cada `parent_sku` recebido, busca `master_id` correspondente.
2. Exclui **em cascata** nas duas tabelas quando o par existir:
   - `products_master` + `product_variants` (cascade FK já existe) + linhas em `product_master_data` com mesmo `parent_sku` + linhas em `pos_products` com mesmo `parent_sku`.
3. Se o par não existir (órfão de um dos lados), exclui só o que foi pedido — sem falhar.
4. Antes de apagar, checa se existe **venda vinculada em `pos_sale_items`** (por sku/parent_sku). Se sim, bloqueia esse item específico e devolve na resposta como `blocked: [...]` para o front mostrar aviso. Não bloqueia o lote inteiro — só o item com histórico de venda.
5. Loga cada exclusão em `catalog_sync_log` (operation = `bulk_delete_from_legacy` ou `bulk_delete_from_unified`).

Toast final: `"X excluídos · Y bloqueados por histórico de venda"`.

## Detalhes técnicos

**Migration 1 — cleanup órfãos:**
```sql
WITH orphans AS (
  SELECT id FROM products_master m
  WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.master_id = m.id)
    AND NOT EXISTS (SELECT 1 FROM product_master_data d WHERE d.parent_sku = m.sku_root)
    AND NOT EXISTS (SELECT 1 FROM pos_products p WHERE p.parent_sku = m.sku_root)
    AND NOT EXISTS (SELECT 1 FROM purchase_invoice_items i WHERE i.master_id = m.id)
)
DELETE FROM products_master WHERE id IN (SELECT id FROM orphans);
```

**Edge function `delete-master-products`:**
- Input: `{ master_ids?: string[], parent_skus?: string[] }`
- Service role, verify_jwt = false, CORS.
- Passos: resolver pares → checar bloqueios (`pos_sale_items`) → deletar → logar.
- Retorno: `{ deleted: {legacy: n, unified: n, pos_products: n}, blocked: [{sku_root, reason}] }`.

**Edge function `sync-master-product-stock` (correção):**
- Novo body: `{ master_id, store_id, target }`. `store_id` passa a ser obrigatório para `target ∈ {pos, both}`.
- Remove o loop `for storeId of storeIds` — atualiza apenas 1 loja.
- Manter o path do Shopify inalterado.

**Front (arquivos):**
- `src/components/inventory/LegacyProductsList.tsx` — checkbox coluna, botão "Excluir selecionados", diálogo do syncStock com Select de loja.
- `src/components/inventory/UnifiedProductsList.tsx` — checkbox no card-header do pai, botão "Excluir selecionados".
- Novo arquivo: `src/components/inventory/BulkDeleteDialog.tsx` — reutilizável nos dois.

**Não são tocados:**
- Fluxo de vendas, `process_pos_sale_sale_event`, triggers de estoque, `create-master-product-pos`, espelho Shopify, PDV.

## Ordem de execução
1. Migration limpeza dos 162 órfãos.
2. Edge function `delete-master-products` (nova).
3. Ajustes front (checkboxes + bulk delete + diálogo do sync).
4. Correção `sync-master-product-stock` (Item 2).

Aguardo aprovação para implementar.