
# Plano — Categorias, Marcas, Filtros e Ações em Massa

## Diagnóstico raiz

Hoje `product_master_data` guarda **`category`** e **`brand`** como texto livre. As abas "Categorias" e "Marcas" mostram `0 produtos` porque a contagem tenta casar por `category_id`/`brand_id` (que não existem) ou pelo nome exato, mas os produtos foram salvos com variações de grafia ("Banana", "Banana calçados", "Banana Calcados"). Nada está de fato vinculado — apenas convivem strings soltas.

Para não quebrar nada, mantemos as colunas de texto existentes e adicionamos IDs em paralelo com sincronização automática.

---

## Etapa 1 — Vincular Categoria e Marca (base de dados)

**Objetivo:** deixar contagem correta e vincular sem quebrar telas antigas.

1. Adicionar `category_id` e `brand_id` em `product_master_data` (FK opcional).
2. Backfill: casar por `slug(name)` normalizado (lowercase, sem acento) contra `product_categories`/`product_brands`.
3. Trigger `BEFORE INSERT/UPDATE`: quando `category`/`brand` (texto) muda, resolver o ID; quando `category_id`/`brand_id` muda, preencher o texto. Mantém as duas colunas coerentes → telas antigas continuam funcionando.
4. RPC `count_products_by_category()` e `count_products_by_brand()` para as abas usarem os totais reais.

## Etapa 2 — Categorias: listar produtos + vincular pela aba

Na sub-aba "Categorias" (Estoque):
- Card da categoria vira expansível: ao clicar mostra lista dos produtos vinculados (nome, SKU pai, marca, preço, imagem).
- Botão **"+ Vincular produtos"** abre modal com busca em `product_master_data` (multi-select) → grava `category_id` em lote.
- Botão **"Remover da categoria"** por linha.
- Contagem `X produtos` passa a refletir o real (via RPC).

## Etapa 3 — Marcas: listar produtos + transferir marca inteira

Mesma UX das categorias, mais:
- Botão **"Transferir todos para outra marca"** no card → dropdown com marcas de destino → confirma → `UPDATE product_master_data SET brand_id = destino WHERE brand_id = origem` (transacional). Trigger da Etapa 1 já espelha o texto.
- Isso resolve os duplicados "Banana / Banana Calcados / Banana calçados": user transfere tudo para a marca canônica e depois exclui as vazias.

## Etapa 4 — Espelhamento nas outras abas

- `UnifiedProductsList` e `LegacyProductsList` já leem `category`/`brand` de `product_master_data`. Como a trigger da Etapa 1 sincroniza texto ↔ ID, qualquer mudança em Categorias/Marcas aparece automaticamente nessas abas sem código extra.
- Adicionar `refetch` nos hooks quando o realtime de `product_master_data` disparar.

## Etapa 5 — Filtros no Legacy e Catálogo Unificado

Barra de filtros compartilhada com:
- Data de criação (range)
- Data de entrada de estoque (via `product_stock_movements` tipo entrada, min date por produto)
- Marca (select vinculado a `product_brands`)
- Categoria (select vinculado a `product_categories`)
- Sem preço de custo (`cost_price IS NULL OR = 0`)
- Sem preço de venda (`sale_price IS NULL OR = 0`)
- Faixa de preço (min/max sobre `sale_price`)

Implementação: um único componente `ProductFilterBar` reutilizado nas duas listas, estado local + query params, sem alterar o schema.

## Etapa 6 — Ações em massa no Legacy

Adicionar ao menu de seleção múltipla (além de Limpar/Excluir/Unificar):
- **Imprimir etiquetas** → reaproveita `ProductLabelPrintDialog` recebendo array de SKUs/variações.
- **Enviar para Shopify** → chama edge function existente de sync Shopify em loop (com progress toast). Se não existir uma "bulk", criamos wrapper que itera na função single.
- Também espelhar essas duas ações no Catálogo Unificado (bônus barato).

---

## Ordem de entrega (para não quebrar nada)

- **PR 1 (schema):** Etapa 1 — colunas + trigger + backfill + RPCs.
- **PR 2 (UI Cat/Marca):** Etapas 2, 3, 4.
- **PR 3 (Filtros):** Etapa 5.
- **PR 4 (Bulk):** Etapa 6.

Cada PR é independente e mantém o comportamento atual até a UI ser plugada. Confirma que posso começar pela PR 1?
