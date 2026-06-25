# Por que o PDV e o Módulo Estoque mostram produtos diferentes

## O que eu encontrei (causa raiz)

O sistema hoje trabalha com **três fontes de produto paralelas**, e não uma só. Essa é a origem da inconsistência:

1. **Tiny ERP (externo)** — catálogo real e completo. Tem TODOS os produtos, inclusive a ZOE e a KATIA.
2. **`pos_products` (cache do PDV)** — 17.703 linhas / ~5.195 códigos de barras distintos. É alimentado por uma sincronização própria a partir do Tiny. **Importante: o PDV NÃO depende só dessa tabela** — quando você bipa um produto que não está no cache, a tela de venda faz uma **busca AO VIVO no Tiny** (`pos-tiny-search-product`) e vende mesmo assim, **sem gravar o produto em lugar nenhum**.
3. **`products_master` (pai) + `product_variants` (filho)** — é o Módulo Estoque: 654 pais / 5.769 variações. É populado por uma **importação separada do Tiny**, sem nenhuma ligação automática com o `pos_products` nem com as vendas do PDV.

### Por que a ZOE (7223.102) e a KATIA (8436.240) aparecem na Frente de Caixa mas não no Estoque
Elas **não estão no `pos_products`** e **não estão no Módulo Estoque**. Elas só existem no Tiny. Quando a vendedora bipa o código, o PDV puxa o produto ao vivo do Tiny e conclui a venda (confirmei: há 56 itens vendidos de ZOE/KATIA em `pos_sale_items`). Como a busca ao vivo **não persiste nada**, esses produtos viram "fantasmas": passam pelo caixa e nunca entram em nenhuma tabela local.

### Tamanho real da divergência (medido no banco)
- **No nível do PAI:** das 510 referências (`parent_sku`) que existem no PDV, **498 já estão no Módulo Estoque** e **12 estão faltando**.
- **No nível da VARIAÇÃO (por código de barras):** **17 códigos** do `pos_products` não existem em `product_variants`.
- **242 produtos** do `pos_products` estão **sem código de barras**, então hoje é impossível casá-los com o Estoque.
- **O grande buraco (os "vários outros" que você viu):** **217 produtos já vendidos** pelo PDV (em `pos_sale_items`) **não existem no Módulo Estoque** e **215 nem no `pos_products`** — são exatamente os fantasmas vindos da busca ao vivo do Tiny (ZOE e KATIA estão nesse grupo).

### O PDV usa o estoque do Módulo Estoque?
**Não.** O PDV usa o `pos_products.stock` + consulta ao vivo no Tiny. O Módulo Estoque (`product_variants.initial_stock`) é um registro paralelo, usado para catalogação/Shopify/fiscal. Os dois estão **totalmente desacoplados** — por isso a regra "Estoque é a tabela principal e espelha o PDV" **nunca chegou a ser aplicada**: são pipelines independentes que foram derivando.

---

## Plano de ação

### Fase 1 — Backfill: trazer o que o PDV já conhece para o Estoque (pai>filho)
Usar o `pos_products` como fonte (já tem `parent_sku`, `size`, `color`, `barcode`, preços) e materializar no padrão pai>filho:
- Para cada `parent_sku` sem `products_master` correspondente → criar o **pai** (`sku_root = parent_sku`, nome-base sem tamanho/cor, marca, categoria, gênero, custo/preço derivados das variações).
- Para cada linha do `pos_products` → criar/atualizar a **variação filho** (`gtin = barcode`, sku, tamanho, cor, preços), ligada ao pai.
- Tratar os **12 pais e 17 variações** faltantes + consolidar os **242 sem código de barras** (gerar identificador interno quando não houver GTIN).
- **Deduplicação:** alguns produtos aparecem com dois `parent_sku` diferentes (ex.: `7403-103-MOCASSIM-MODARE-NINA` e `MOCASSIM-FEMININO-ORTOPEDICO-NINA` são o mesmo sapato). O backfill precisa mesclar por código de referência real, e ignorar lixo de teste (`TESTE-005`, `POS-<uuid>`, "Produto Teste R$5").

### Fase 2 — Eliminar os produtos-fantasma (ZOE/KATIA e os 217)
Causa: a busca ao vivo no Tiny vende sem persistir. Duas frentes:
- **Correção pontual:** na tela de venda, quando o produto vier da busca ao vivo do Tiny, **gravar/upsert no `pos_products`** (uma alteração pequena e localizada). A partir daí todo produto vendido passa a existir no cache.
- **Importação completa do Tiny → Estoque:** rodar uma carga única que traz o catálogo inteiro do Tiny (pai>filho) para `products_master`/`product_variants`, fechando o gap dos 217 já vendidos e dos que ainda nem foram vendidos.

### Fase 3 — Manter sincronizado (para não derivar de novo)
Estabelecer um único fluxo que mantém o Módulo Estoque como espelho do PDV:
- **Sincronização `pos_products` → Estoque** (trigger ou função agendada): toda vez que um produto entra/atualiza no `pos_products`, o pai e o filho correspondentes são criados/atualizados automaticamente no Módulo Estoque por `parent_sku`/`barcode`.
- Painel de divergências no Módulo Estoque mostrando "produtos no PDV ainda não catalogados" para revisão humana (especialmente os sem GTIN e os que precisam de classificação pai).

---

## Detalhes técnicos (para referência)

- **Chaves de junção:** PAI = `pos_products.parent_sku` ↔ `products_master.sku_root`; FILHO = `pos_products.barcode` ↔ `product_variants.gtin`.
- **Busca ao vivo do PDV:** `src/components/pos/POSSalesView.tsx` (linhas ~480-496) chama `pos-tiny-search-product` e vende sem gravar — ponto exato da correção da Fase 2.
- **Origem do Estoque:** `products_master`/`product_variants` têm `tiny_imported_at` (importação própria do Tiny), sem GRANT/trigger vindo do PDV.
- **Backfill (Fase 1):** preferível via função de banco (migration + função) lendo `pos_products` agrupado por `parent_sku`, com `INSERT ... ON CONFLICT` em `products_master(sku_root)` e `product_variants(gtin)`; rodar primeiro em modo "dry-run" (relatório) antes do commit.
- **Lixo a excluir do backfill:** `parent_sku` em (`TESTE-005`, `POS-<uuid>`); duplicidades de slug do mesmo produto devem ser mescladas por referência numérica (ex.: `7403.103`).

---

## STATUS DE EXECUÇÃO

### Fase 1 — CONCLUÍDA
- `backfill_estoque_from_pos(true)`: 6 pais + 21 variações criados (needs_review=true).

### Fase 2 — CONCLUÍDA
1. **Anti-fantasma (busca ao vivo):** `pos-tiny-search-product` agora faz INSERT no `pos_products`
   de todo produto puxado do Tiny que ainda não exista na loja (estoque inicia em 0; nunca
   sobrescreve produto já cadastrado). A partir de agora nenhuma venda gera fantasma.
2. **Backfill dos fantasmas históricos:** função `backfill_pos_products_from_sales(p_commit, p_clean_only)`
   reconstrói no cache do PDV os produtos já vendidos e ausentes. Commit real:
   **642 produtos inseridos** (catálogo real), **220 ignorados** (produtos de anúncio/online com
   nome de marketing "–/—"). ZOE e KATIA incluídos.
3. **Empurrar p/ Estoque:** `backfill_estoque_from_pos(true)` rodou de novo e criou **0 novos** —
   porque os 417 SKUs distintos reconstruídos **já existiam em `product_variants`** (vindos da
   importação separada do Tiny). O buraco era só no cache do PDV.

### Fase 3 — IMPLEMENTADA (consolidação aguarda commit)
1. **Trigger contínuo (ATIVO):** `trg_sync_pos_product_to_estoque` em `pos_products` (AFTER INSERT/UPDATE
   de parent_sku, barcode, sku, name, color, size) chama `sync_pos_product_to_estoque()`, que cria
   pai (`sku_root = parent_sku`) + filho (`gtin = barcode`) no Estoque automaticamente. Ignora lixo
   (POS-/TESTE-/produto teste/nomes de anúncio com travessão) e nunca quebra a gravação do PDV
   (EXCEPTION → RETURN NEW). A partir de agora o Estoque espelha o PDV sozinho.
2. **Consolidação de pais (função criada):** `consolidate_estoque_parents_by_pos(p_commit)` reagrupa
   variações fragmentadas sob o pai-modelo correto (`sku_root = parent_sku do PDV`), remove duplicatas
   por (cor,tamanho), apaga pais numéricos vazios e marca needs_review. DRY-RUN: **66 pais a criar,
   318 variações a reagrupar** (ex.: ZOE, KATIA, BRENDA, ANE). Commit feito pelo botão "Consolidar"
   no painel ou via RPC com p_commit=true.
3. **Painel de divergências (UI):** novo modo "Divergências PDV" no Módulo Estoque
   (`InventoryPosDivergences.tsx`) — cards de resumo (não catalogados / sem GTIN / pais fragmentados),
   lista paginada com busca e botão de consolidação com preview. RPCs:
   `pos_estoque_divergence_summary()` e `list_pos_estoque_divergences()`.

