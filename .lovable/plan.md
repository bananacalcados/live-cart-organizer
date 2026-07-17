## Objetivo

Tornar toda movimentação de estoque **auditável e classificada** (Entrada / Saída / Balanço), com um **histórico completo por variação** dentro do modal de edição.

---

## Diagnóstico atual

- Tabela `pos_stock_adjustments` já registra a maioria das movimentações (`direction in/out`, `sale_id`, `sale_event`, `reason`, `previous_stock`, `new_stock`, `seller`) — boa base, **não precisa recriar**.
- **Problemas hoje:**
  1. Não existe conceito de **"Balanço"** — balanços gravam como `in`/`out` misturados às vendas.
  2. O modal de edição salva estoque via `UPDATE` cru em `pos_products`, **sem gerar linha** em `pos_stock_adjustments` → correções manuais somem do histórico.
  3. Trocas/devoluções gravam apenas com `reason` textual, sem link para `trocas_devolucoes.id`/número.
  4. Não há UI para ver o histórico de uma variação.
  5. Página inteira ainda pode remontar em alguns fluxos que não usam `onLocalUpdate`.

---

## Plano (4 fases, cada uma independente e reversível)

### Fase 1 — Banco (migration)
- Adicionar em `pos_stock_adjustments`:
  - `movement_type text` com CHECK `IN ('entrada','saida','balanco','venda','troca','devolucao','transferencia','ajuste')`.
  - `exchange_id uuid` (FK opcional → `trocas_devolucoes.id`).
  - `exchange_number text` (denormalizado, ex: `TD-2026-000009`).
  - `count_id uuid` (FK opcional → `inventory_counts.id`).
  - Backfill: `movement_type` derivado dos registros existentes (regra: `sale_id NOT NULL` → `venda`; `reason ILIKE '%balanço%'` → `balanco`; `reason ILIKE '%transfer%'` → `transferencia`; `reason ILIKE '%troca%'` → `troca`; senão `direction`=`in`→`entrada`, `out`→`saida`).
- Índice `(product_id, created_at DESC)` para o histórico.
- **Não altera nada existente que já grava** — só adiciona colunas nullable.

### Fase 2 — Blindagem de gravação
- Trigger `AFTER UPDATE OF stock ON pos_products` que, **se não houver linha correspondente em `pos_stock_adjustments` nos últimos 2 segundos para o mesmo product_id**, insere uma linha `movement_type='ajuste'` com `previous_stock`/`new_stock` e `reason='Ajuste direto sem classificação'`.
  - Garantia: nenhuma alteração de estoque escapa do log, mesmo que código antigo faça UPDATE cru.
- Ajustar funções que já gravam corretamente (venda, troca, transferência, balanço) para passar `movement_type` explícito → a trigger detecta e não duplica.

### Fase 3 — Frontend: seletor Entrada/Saída/Balanço no modal
No `PosSkuEditDialog` (aba "Editar"):
- Substituir o input único de "Estoque" por:
  - **Radio/Select**: `Entrada` | `Saída` | `Balanço`.
  - Input de **quantidade** (positiva).
  - Input de **motivo** (obrigatório para Balanço, opcional para Entrada/Saída).
- Ao salvar, chamar edge function `pos-stock-movement` que:
  - `entrada`: `stock += qty`, grava `movement_type='entrada'`.
  - `saida`: `stock -= qty` (bloqueia negativo), grava `movement_type='saida'`.
  - `balanco`: `stock = qty` (absoluto), grava `movement_type='balanco'` com `previous_stock`/`new_stock`.
- **Sem recarregar página**: usar `onLocalUpdate({ id, stock: newStock })` (já existe) → tela não remonta.
- Preço/Custo/SKU/Barcode continuam salvando por `UPDATE` direto (não mexem em estoque).

### Fase 4 — Aba "Histórico" no modal
Nova `TabsTrigger value="history"` ao lado de Editar/Transferir:
- Query: `pos_stock_adjustments WHERE product_id = sku.id ORDER BY created_at DESC LIMIT 200`.
- Colunas: **Data/hora · Tipo (badge colorido) · Qtd · De → Para · Referência · Motivo · Usuário**.
- Coluna "Referência" renderiza link contextual:
  - `venda` → `#PDV-{sale.numero}` (link para `POSSaleDetailDialog`).
  - `troca`/`devolucao` → `{exchange_number}` (link para módulo de trocas).
  - `balanco` → `Balanço de {data}` (link para `inventory_counts`).
  - `transferencia` → `De {loja_origem} → {loja_destino}`.
  - `ajuste`/`entrada`/`saida` → mostra `reason` + nome do usuário.
- Filtros: por tipo e por período.
- Botão "Exportar CSV" para uso fiscal.

---

## Compatibilidade / risco
- Todas as colunas novas são nullable → código antigo continua gravando sem quebrar.
- Trigger de blindagem é idempotente (janela de 2s) → não duplica linhas de fluxos que já gravam.
- Nenhum trigger existente é alterado nesta primeira leva; apenas complementado.
- Rollback: `DROP` das colunas novas e da trigger volta ao estado atual sem perda.

---

## Detalhes técnicos

**Migration esperada:**
```sql
ALTER TABLE pos_stock_adjustments
  ADD COLUMN movement_type text,
  ADD COLUMN exchange_id uuid REFERENCES trocas_devolucoes(id) ON DELETE SET NULL,
  ADD COLUMN exchange_number text,
  ADD COLUMN count_id uuid REFERENCES inventory_counts(id) ON DELETE SET NULL;

CREATE INDEX idx_psa_product_created ON pos_stock_adjustments(product_id, created_at DESC);

-- Backfill classificação
UPDATE pos_stock_adjustments SET movement_type = CASE
  WHEN sale_id IS NOT NULL THEN 'venda'
  WHEN reason ILIKE '%balanço%' OR reason ILIKE '%balanco%' THEN 'balanco'
  WHEN reason ILIKE '%transfer%' THEN 'transferencia'
  WHEN reason ILIKE '%troca%' THEN 'troca'
  WHEN reason ILIKE '%devoluç%' THEN 'devolucao'
  WHEN direction='in' THEN 'entrada'
  ELSE 'saida'
END WHERE movement_type IS NULL;

ALTER TABLE pos_stock_adjustments
  ADD CONSTRAINT psa_movement_type_chk
  CHECK (movement_type IN ('entrada','saida','balanco','venda','troca','devolucao','transferencia','ajuste'));
```

**Nova edge function:** `pos-stock-movement` (entrada/saida/balanço, service-role, transacional).

---

Aprova para eu implementar as 4 fases?
