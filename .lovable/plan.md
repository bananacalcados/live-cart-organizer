# Plano: Clonagem ao bipar + Balanço Total Inteligente

## Parte 1 — Bipar produto que não existe na loja atual

Hoje, ao bipar um código que não existe na loja, abre só o diálogo "código desconhecido". Vamos tornar isso inteligente e baseado em loja (sem Tiny ID).

### Comportamento novo
Ao bipar um código não encontrado em `pos_products` da loja atual:

1. **Buscar em TODAS as outras lojas** (por `barcode` ou `sku`).
2. **Não existe em nenhuma loja** → Modal "Produto não localizado" avisando que o código bipado não foi encontrado (mantém as opções atuais: vincular manualmente a um produto / salvar como pendente).
3. **Existe em outra loja** → Modal "Clonar produto para esta loja", mostrando:
   - O **produto pai** (agrupado por `parent_sku`) e **todas as variações** de cor e tamanho existentes na loja de origem.
   - Botão **"Clonar para [loja atual]"** que copia o pai e todos os filhos para a loja atual com **estoque zerado**, mantendo o **mesmo SKU/GTIN** (essencial para o estoque compartilhado por GTIN).
   - Após clonar, registra automaticamente a bipagem do item escaneado.

### Como funciona tecnicamente
- Nova edge function `pos-clone-product-to-store`:
  - Recebe `barcode`/`sku` + `target_store_id`.
  - Localiza o grupo `parent_sku` em qualquer loja que tenha o produto.
  - Insere no `target_store_id` apenas as variações que ainda não existem, com `stock = 0`, copiando `name`, `variant`, `color`, `size`, `sku`, `barcode`, `category`, `category_id`, `parent_sku`, `price`, `cost_price`.
  - Retorna a variação correspondente ao código bipado.
- `handleBarcodeScan` em `Inventory.tsx` ganha o passo de busca cross-store e abre o modal certo.
- Reforço: a criação automática em todas as lojas (já existente em `create-master-product-pos`) continua sendo a primeira linha de defesa; o modal de clonagem é a rede de segurança para casos legados.

> Observação: a verificação já foi feita — atualmente **nenhum produto real está faltando** em alguma das 3 lojas, então o modal será raro, usado só para correções pontuais.

## Parte 2 — Nova modalidade "Balanço Total Inteligente"

Objetivo: contar 6 mil SKUs aos poucos, **corrigindo e conferindo parcialmente** durante o processo, e só no fim zerar o que não foi bipado — sem perder dados e sem quebrar nos limites de 50s dos crons.

### Fluxo do usuário
1. Ao criar balanço, surge um 3º card: **"Total Inteligente"** (além de Total e Parcial).
2. Durante a bipagem aparecem dois botões novos:
   - **"Salvar e corrigir bipados"** → aplica a correção (BALANÇO absoluto) **somente nos produtos já bipados**, sem zerar nada, e **volta para a bipagem** para continuar contando/conferindo.
   - **"Finalizar Balanço Inteligente"** → entende que tudo já foi bipado: insere os não bipados com quantidade 0, compara com o estoque e **zera os que não foram bipados**.
3. Pode-se rodar "Salvar e corrigir bipados" quantas vezes quiser ao longo da contagem.

### Garantias importantes
- **Sempre BALANÇO absoluto**: se a contagem é 3 e o estoque está -3, o sistema grava 3 (substitui), nunca lança entrada/saída. (Já é o comportamento atual.)
- **Idempotente**: re-corrigir um item já corrigido é seguro, pois o saldo é absoluto. Se o usuário bipar mais unidades depois, a próxima correção grava o novo total.
- **Persistência total**: tudo fica salvo em `inventory_count_items` e `inventory_correction_queue`, então a conferência dos não bipados é feita no banco, não na memória.
- **Resistente aos 50s de cron**: reutiliza o motor já existente de auto-reinvocação (`waitUntil`), heartbeat (`last_batch_at`) e o `cron-inventory-watchdog` que re-dispara processos travados.

### Mudanças técnicas

**Banco (migration):**
- `inventory_count_items`: nova coluna `last_corrected_quantity int` (controla o que já foi corrigido, evita reprocessar itens inalterados nas correções incrementais).
- `scope` aceita o valor `total_smart` (campo texto, sem alteração de enum).

**Edge function `inventory-correct-stock`:**
- Novo parâmetro `final` (padrão `true`).
- Ao esvaziar a fila: se `final = true`, mantém o comportamento atual (`status = completed`); se `final = false`, volta `status = counting` (modo inteligente continua a bipagem).
- Ao corrigir cada item, grava `last_corrected_quantity = new_quantity`.

**Novo status `smart_correcting`:**
- Usado durante a correção incremental para o watchdog saber re-disparar com `final:false`.
- `cron-inventory-watchdog` passa a tratar `smart_correcting` re-disparando `inventory-correct-stock` com `final:false`.

**Frontend `Inventory.tsx`:**
- 3º card de escopo no diálogo de novo balanço.
- `handleSmartCorrectScanned`: enfileira correção (BALANÇO) apenas dos itens bipados cujo `counted_quantity` mudou desde a última correção, marca `status = smart_correcting`, invoca `inventory-correct-stock` com `final:false`.
- `handleFinalizeSmart`: reusa a lógica do Total (inserir não bipados com qty 0 → verificar → corrigir/zerar), levando a `verifying → reviewing/correcting → completed`.
- Polling/realtime ajustados para o status `smart_correcting` (volta para `counting` ao terminar).

### Diagrama de estados (Total Inteligente)

```text
counting ──"Salvar e corrigir bipados"──▶ smart_correcting ──(fila vazia)──▶ counting
   │
   └──"Finalizar Balanço Inteligente"──▶ verifying ──▶ reviewing ──▶ correcting ──▶ completed
                                          (insere não bipados=0, zera os não bipados)
```

## Resumo das alterações
- Edge function nova: `pos-clone-product-to-store`.
- Edge function editada: `inventory-correct-stock` (parâmetro `final`, `last_corrected_quantity`).
- Edge function editada: `cron-inventory-watchdog` (status `smart_correcting`).
- Migration: coluna `last_corrected_quantity` + suporte ao escopo `total_smart`/status `smart_correcting`.
- `src/pages/Inventory.tsx`: busca cross-store na bipagem, modais (não localizado / clonar), 3º escopo, botões e handlers do balanço inteligente.
- Modal de clonagem (componente novo dentro de inventory).
