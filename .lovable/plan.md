# Zerar variações não bipadas por produto-pai

## O que você pediu (entendi sim)

1. **Ao "Salvar e corrigir bipados":** além de corrigir o que foi bipado, zerar as **outras variações do mesmo produto-pai** que **não** foram bipadas (elas esgotaram).
2. **Ao "Finalizar Balanço Inteligente":** rodar uma varredura final e zerar os **produtos-pai que não tiveram NENHUMA variação bipada** (esgotaram por completo).

## Como o sistema funciona hoje (base do plano)

- Cada bipagem cria/soma um item em `inventory_count_items` (dedup por produto/sku/barcode).
- **"Salvar e corrigir bipados"** chama a função `inventory-correct-stock` no modo `prepare`: ela monta a fila só com os **itens bipados** (`counted_quantity > 0`) e grava o saldo contado em `pos_products`. Nada é zerado. Volta para `counting`.
- **"Finalizar Balanço Inteligente"** já insere **todos os produtos não bipados da loja com quantidade 0** e depois verifica divergências. Ou seja, a parte (2) do seu pedido **já é parcialmente coberta** — só precisa garantir que essa correção para zero seja de fato aplicada ao finalizar.
- Agrupamento por produto-pai existe via `pos_products.parent_sku` (ex.: `7402-102-TENIS-...-DEBORA`). **Atenção:** há linhas duplicadas/fantasmas com o mesmo `sku` e `parent_sku` — o zeramento tem que agir por `parent_sku` e nunca zerar uma variação cujo `sku`/código foi bipado.

## Plano de implementação

### 1. Backend — `inventory-correct-stock`, modo `prepare` (o coração da mudança)

Adicionar um passo de **"zerar irmãos"** logo após montar a lista de bipados, ativado quando o balanço for do tipo `total_smart`:

1. Coletar o conjunto de **códigos bipados** de toda a contagem (todos os `sku` + `barcode` com `counted_quantity > 0`), não só do último lote.
2. Descobrir os **produtos-pai tocados**: buscar em `pos_products` (escopo da loja da contagem) os `parent_sku` distintos dos itens bipados.
3. Buscar todas as variações desses `parent_sku` na loja com `stock <> 0` cujo `sku`/`barcode` **não** esteja no conjunto bipado.
4. Para cada uma: enfileirar correção com `new_quantity = 0` **e** criar um `inventory_count_items` com `counted_quantity = 0` (para aparecer no relatório e para o re-bip funcionar).
5. A fila continua sendo processada pelo mesmo motor atômico já existente (`inventory_claim_correction_batch`), sem mudar a lógica de lote/heartbeat.

### 2. Backend — segurança e idempotência

- **Só zera irmãos com estoque atual ≠ 0.** Depois de zerado, na próxima rodada ele já está em 0 e é ignorado (usando `last_corrected_quantity`). Se você **re-bipar** um irmão, ele vira `counted_quantity > 0` e a correção seguinte **restaura** o saldo. O sistema se auto-corrige.
- **Zeramento por `parent_sku`**, tratando linhas duplicadas/fantasmas (zera todas as linhas do pai que não foram bipadas).
- **Escopo estrito pela loja** da contagem (`store_id` da própria `inventory_counts`) — nunca mexe em outra loja (ex.: corrige Centro, não Pérola).
- Produtos **sem `parent_sku`** (poucos) ficam de fora do zeramento de irmãos — só o item bipado é corrigido.

### 3. Backend — "Finalizar Balanço Inteligente"

- Garantir que, ao finalizar, os produtos-pai **nunca tocados** (nenhuma variação bipada) sejam de fato **corrigidos para zero** — hoje eles já são inseridos com quantidade 0; vamos assegurar que a correção seja aplicada (e não fique só em "revisão").

### 4. Frontend — `src/pages/Inventory.tsx`

- Atualizar o texto do botão/toast de **"Salvar e corrigir bipados"** para deixar claro: *"corrige os bipados e zera as outras numerações do mesmo modelo"*.
- Atualizar o diálogo de **"Finalizar Balanço Inteligente"** explicando que modelos sem nenhuma bipagem serão zerados.
- Mostrar no progresso quantos irmãos foram zerados (opcional, se o retorno da função trouxer esse número).

## Risco importante que você precisa saber

O modelo assume que, **antes de clicar em "Salvar e corrigir bipados", você já bipou todas as numerações que tem daquele modelo**. Se você bipar as numerações de um mesmo modelo em **cliques diferentes**, as que ainda não foram bipadas serão zeradas no primeiro clique — mas voltam ao normal assim que você bipá-las (o sistema restaura no clique seguinte). Enquanto não bipar, elas ficam em 0.

Recomendação de uso: **termine de bipar todas as numerações de um modelo antes de salvar**. Mesmo se esquecer alguma, o re-bip corrige. Nada é perdido de forma irreversível, pois cada ajuste fica registrado em `pos_stock_adjustments`.

## Detalhes técnicos

- Arquivos: `supabase/functions/inventory-correct-stock/index.ts` (lógica de irmãos no `prepare`), `src/pages/Inventory.tsx` (textos/UX e finalizar).
- Sem migração de schema: reaproveita `inventory_correction_queue`, `inventory_count_items`, `pos_products.parent_sku`, `pos_stock_adjustments` e o RPC de claim já existentes.
- Nenhuma alteração no motor de lote/heartbeat/watchdog — só acrescenta linhas "zerar" à fila que ele já sabe processar.
- Mantém a arquitetura de estoque 100% local (`pos_products` como fonte da verdade); o espelho para Shopify continua disparando normalmente pelos triggers existentes a cada mudança de saldo.
