
# Diagnóstico e Plano — Bugs Venda/Troca (Matthews · BABUCHE MORMAII 12277)

## Investigação (o que realmente aconteceu)

### Venda original — `c5769f9c…` · 17/07 15:40 · tamanho 35
- `pos_stock_adjustments` mostra `1.00 → 0.00` (direction=out, sale_event=sale) no mesmo segundo da venda. **A saída FOI feita.**
- Em 17/07 19:19:44, a troca gerou um movimento `+1` com motivo *"Devolução troca (retorno vendável)"*, devolvendo o par 35 ao estoque.
- **Resultado:** o "1 par no 35" que você viu é o produto que a cliente devolveu voltando para venda — comportamento esperado.
- **Bug 1 real? Não neste caso.** Mas a auditoria histórica abaixo mostra que existe um problema maior de outras vendas sem saída.

### Troca `TD-2026-000009` · devolução 35 / reposição 36
Item de reposição na `trocas_devolucoes_itens` ficou com `repoe_estoque=false` e `estado_estoque=reservado`. Nenhum registro em `pos_stock_adjustments` para o produto do 36.

**Causa raiz (Bug 2):** `finalizeExchange` só faz movimento de **entrada** dos itens devolvidos. Para a reposição, quando `modo_expedicao='aguarda_retorno'` (que é o valor fixo usado pelo `PresentialExchangePicker`), ele apenas atualiza `estado_estoque='despachado'` — **nunca insere `direction=out` em `pos_stock_adjustments`** para abater o par do 36. A saída da reposição só existe implicitamente na troca "com envio" pré-reservada, não no fluxo presencial.

### Pedido original ainda como "pago" + venda-espelho ausente
- `pos_sales.status` continua `completed`. `finalizeExchange` (linha 262-269) só grava `status_cancelamento='cancelado'`, sem tocar em `status`. A aba **Pedidos** filtra por `status`, então o pedido continua aparecendo como aprovado.
- A venda-espelho da reposição (mirror sale em `pos_sales`) **falhou silenciosamente**. Reproduzi o INSERT: erro `pos_sales_source_order_id_fkey` — a coluna `source_order_id` tem **FK para a tabela `orders`** (legado), mas o código passa um `pos_sales.id`. O try/catch em `finalizeExchange` engole o erro.

### Auditoria retroativa — vendas físicas sem saída de estoque
```text
mês        | sem_saida | com_saida
2026-02    |      126  |     0
2026-03    |      593  |     0
2026-04    |      460  |     0
2026-05    |      771  |     0
2026-06    |      230  |   296   ← trigger passou a operar
2026-07    |       17  |   280   ← ainda escapam alguns
```
- **~1.980 vendas físicas pré-junho/2026** sem saída (a trigger `apply_pos_sale_stock_movement` não existia). Estoque histórico já ficou inconsistente na origem.
- **17 vendas em julho ainda sem saída**: itens cujo SKU/barcode aparece em múltiplas lojas ou está ausente do catálogo local, e o `process_pos_sale_sale_event` não consegue casar 1 linha determinística.
- Online (Shopify/live): 489+236+126 sem saída — mas essas historicamente eram abatidas pelo Tiny/outras rotas antes do desacoplamento.

---

## Plano de Correção (sem quebrar nada)

### Fase 1 — Bug 3 (Pedidos): mirror sale + cancelamento visível
1. **Remover uso indevido de `source_order_id`** no INSERT da mirror sale em `src/lib/pos/finalizeExchange.ts`. A rastreabilidade ao pedido original fica em `notes` + `external_order_id` (id da troca) — que é o que já usamos para idempotência.
2. **Log explícito** (não silencioso) do erro do INSERT: se falhar, gravar `fase2_erro` na troca para aparecer no painel.
3. **Marcar o pedido original como `cancelled` no `status`** (não só `status_cancelamento`) quando `totalReturn=true`, preservando `motivo_cancelamento='troca'`. Isso faz a aba Pedidos refletir corretamente. Vendas parciais continuam intactas.
4. **Backfill único**: para trocas `concluida` cujo evento tem `pedido_ajustado=true`, `estoque_movimentado=true` e a devolução cobre 100% do pedido, mover `status` para `cancelled`. E, para trocas do tipo `troca` sem mirror sale correspondente, gerar as mirror sales retroativamente.

### Fase 2 — Bug 2 (saída da reposição na troca presencial)
1. Em `finalizeExchange`, após criar/localizar a mirror sale (bloco linha 376-446), **disparar a saída de estoque de cada item de reposição** via `pos-stock-balance` (`direction: "out"`, `reason: "Reposição troca <codigo>"`). Idempotência: só executa se ainda não houver `pos_stock_adjustments` com `sale_id = mirrorSale.id`.
2. Alternativa mais limpa: como já criamos a mirror sale com `status='completed'`, deixar a trigger `apply_pos_sale_stock_movement` fazer o abate normal via `process_pos_sale_sale_event` (que já é chamada pela trigger no INSERT). Isso é o melhor caminho — hoje ela não abate porque o INSERT nunca ocorre por causa da FK do Bug 3. **Corrigindo Bug 3, o Bug 2 se resolve automaticamente** pela trigger existente. Nada de código novo de estoque na troca.
3. Atualizar `trocas_devolucoes_itens.repoe_estoque=true` e `estado_estoque='despachado'` para itens de reposição em troca presencial, para refletir na UI.
4. **Backfill**: para trocas `concluida` sem saída em `pos_stock_adjustments` para o par reposto, gerar movimento retroativo (idempotente por `troca_devolucao_id`).

### Fase 3 — Bug 1 e auditoria retroativa de estoque
1. **17 vendas de julho sem saída**: script diagnóstico para cada uma — identificar por que `process_pos_sale_sale_event` não localizou produto (SKU ausente / múltiplas lojas). Corrigir cadastros faltantes e reprocessar chamando `process_pos_sale_sale_event(sale_id)` (é idempotente: só cria adjustment se não existir).
2. **~1.980 vendas pré-junho/2026**: relatório para você aprovar antes de qualquer ação. Duas opções apresentadas por loja:
   - (a) Não abater retroativamente e usar o Balanço Inteligente para "verdade fisica" (recomendado — o estoque histórico já foi corrigido inúmeras vezes pelos balanços).
   - (b) Abater retroativo com flag `reason='backfill_historico'`, reversível.
3. **Trava preventiva**: alerta no dashboard de Estoque quando venda `completed/paid` física não gerar `pos_stock_adjustments` em até 30s (job leve).

### Fase 4 — Testes end-to-end antes de subir
1. Criar venda física teste em ambiente atual → confirmar saída.
2. Fazer troca presencial (devolução X reposição Y) → confirmar: entrada de X, saída de Y via mirror sale, pedido original `cancelled`, mirror aparece em Pedidos.
3. Troca parcial → pedido original **permanece** completed (só marca `status_cancelamento`).
4. Rodar auditoria: 0 vendas físicas `completed/paid` recentes sem saída.

---

## Detalhes Técnicos

- **Arquivo principal**: `src/lib/pos/finalizeExchange.ts` (mirror sale + cancelamento do original).
- **Migration**:
  - Backfill de `status='cancelled'` em pedidos com `status_cancelamento='cancelado'` e evento `pedido_ajustado=true` cobrindo 100% dos itens.
  - Backfill de mirror sales para trocas antigas sem `pos_sales` correspondente (a trigger cuida do estoque).
- **Sem migration na FK** de `source_order_id`: a coluna pertence a fluxo online→Shopify (`orders`); apenas paramos de usá-la nas trocas.
- **Nenhuma alteração** nas triggers de estoque nem em `process_pos_sale_sale_event`. Aproveitamos o que já existe.
- Auditoria retroativa das 17 vendas de julho: consulta pronta; correção sob demanda (idempotente).

---

## Ordem de execução sugerida
1. Fase 1 (código + migration de backfill do status/pedidos) — desbloqueia Pedidos e, por tabela, Bug 2.
2. Fase 2 (ajustes de flags + backfill de estoque das trocas concluídas) — reconcilia estoque das trocas passadas.
3. Fase 3 (17 vendas de julho + relatório para decisão sobre histórico).
4. Fase 4 (testes + monitor).

Aguardo seu OK para implementar. Nada será alterado até você aprovar.
