# Saúde do Estoque — Score de 6 Pilares

Implementação da análise consolidada de saúde do estoque na aba **Dashboard > Saúde > Visão Geral**, com nota por loja e global, filtro de horizonte (30d / 60d / 90d, padrão 60d), previsão de faturamento e normalização de cores/tamanhos.

## Fase 1 — Dicionários de Cor e Tamanho

Criar fonte única para cor e tamanho, hoje texto livre em `product_variants`.

**Banco:**
- `product_colors` (id, name, slug, hex, created_at)
- `product_sizes` (id, label, numeric_value, size_group ['adulto','infantil','outro'], created_at)
- Adicionar `color_id` e `size_id` (nullable) em `product_variants` — mantém colunas texto pra não quebrar nada.
- Trigger `trg_auto_link_color_size_variants`: ao inserir/atualizar variante, se `color`/`size` texto vier preenchido e `color_id`/`size_id` não, faz upsert no dicionário (slug = lowercase sem acento) e vincula.
- Backfill: agrupa variantes existentes por slug e vincula automaticamente (fusão agressiva conforme aprovado).

**UI:**
- Duas novas sub-abas em `InventoryCategories.tsx`: **Cores** e **Tamanhos**.
- CRUD + botão "Fundir em…" pra resolver duplicatas remanescentes (move `color_id`/`size_id` das variantes e deleta o registro origem).

## Fase 2 — Curvas ABC

View materializada `mv_product_abc_curve` recalculada 1x/dia (cron):
- Faturamento por `parent_sku` no horizonte selecionado (30/60/90d) a partir de `pos_sale_items` × `pos_sales` (status pago).
- Ordenação decrescente, acumulado percentual → classifica em A (≤70%), B (≤90%), C (>90%).
- Coluna `store_id` pra permitir curva por loja + global.
- Filtro no topo do dashboard troca o horizonte lendo direto (não precisa recalcular a view; a view guarda os 3 horizontes lado a lado).

## Fase 3 — Score de 6 Pilares

Edge function `calculate-inventory-health` (chamada do front, cacheada por 10min):

| # | Pilar | Peso | Cálculo |
|---|---|---|---|
| 1 | Cobertura Curva A | 30% | % de tamanhos esperados presentes nos SKUs Curva A, ponderado por participação no faturamento |
| 2 | Cobertura Curva B | 12% | Mesmo cálculo, Curva B |
| 3 | Cobertura ponderada por tamanho | 20% | % grade completa, cada tamanho pesa pela participação real nas vendas do horizonte |
| 4 | Frescor / idade | 10% | % de SKUs com venda ou entrada nos últimos 60d |
| 5 | Giro (sell-through) | 18% | vendas_30d ÷ estoque_médio, normalizado 0–100 |
| 6 | Ruptura recente | 10% | Curva A/B zerado ≥3 dias em tamanho ≥8% de participação nos últimos 14d |

Score final = soma ponderada 0–100.

**Resultado por loja + consolidada** (consolidada = média ponderada pelo faturamento da loja).

## Fase 4 — UI Visão Geral

Substituir topo da aba Saúde por:

```text
+------------------------------------------------------------------+
| Filtros: [Loja: Todas ▼] [Horizonte Curva: 60d ▼]  [Atualizar]  |
+------------------------------------------------------------------+
| Score consolidado                                                |
| ████████████████████░░░░░░░  72 / 100   B                        |
|                                                    [expandir ▼] |
+------------------------------------------------------------------+
  ao expandir:
  Cobertura Curva A     ████████░░  78
  Cobertura Curva B     ██████░░░░  61
  Cobertura por tamanho ███████░░░  70
  Frescor               █████████░  88
  Giro                  █████░░░░░  52
  Ruptura recente       ████████░░  75
```

Barra principal + expansão com nota por pilar. Cada pilar tem tooltip explicando o cálculo e link "ver SKUs afetados" (drill-down).

**Card lateral — Previsão de Faturamento:**
- `potencial_mensal = Σ (estoque_SKU × preço × giro_esperado_categoria)` usando os últimos 60d.
- Mostra "com o estoque atual, mês projeta R$ X" + gap vs. meta do mês (lê `monthly_goals`).
- Card secundário: "Capital preso em Curva C parada há +90d: R$ Y".

## Fase 5 — Sazonalidade (placeholder)

- Tabela `category_seasonality_index` (category_id, month, index_value) — vazia hoje.
- Job mensal (cron) só liga quando houver ≥12 meses de histórico. Enquanto isso, todos os índices ficam neutros (1.0) e não afetam a nota.
- Deixa a infra pronta pra ativação futura sem retrabalho.

## Detalhes técnicos

**Migrations:**
1. `product_colors`, `product_sizes` + colunas em `product_variants` + trigger + backfill.
2. `mv_product_abc_curve` (materialized view) + função `refresh_abc_curve()` + cron diário.
3. `category_seasonality_index` (schema apenas).
4. Índices em `pos_sale_items(parent_sku, created_at)` e `pos_sales(status, created_at)` se ainda não existirem.

**Edge functions:**
- `calculate-inventory-health` — recebe `{ store_id?, horizon }`, devolve `{ overall, pillars: [...], affected_skus: {...} }`. Cache 10min em `app_settings` por chave.

**Front:**
- `src/lib/inventoryHealth.ts` — types + fetcher com cache local.
- `src/components/inventory/InventoryHealthScoreCard.tsx` — barra principal + expansão.
- `src/components/inventory/InventoryRevenueForecast.tsx` — card de previsão.
- `src/components/inventory/InventoryColorSizeManager.tsx` — sub-abas em Categorias.
- Alterar `src/components/inventory/InventoryHealthDashboard.tsx` pra montar tudo no topo, filtros globais.

**Sem quebrar nada:**
- Colunas texto de cor/tamanho preservadas.
- Score é aditivo: se algum pilar não tiver dado suficiente, ele fica neutro (50) e o peso é redistribuído nos outros.
- View materializada refresca em background; UI cai em cache se falhar.

## Ordem de entrega

1. Migration Fase 1 (dicionários) + UI de fusão.
2. Migration Fase 2 (curvas ABC).
3. Edge function + UI Fase 3/4 (score + previsão).
4. Migration Fase 5 (só schema).

Cada fase entregue e testada antes da próxima. Confirma pra começar pela Fase 1?
