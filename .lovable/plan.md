# Plano: filtro de período + sincronização ativa de estoque com a Shopify

Duas frentes independentes. Nada será executado agora — isto é só o plano.

---

## Parte 1 — Filtro de período do Dashboard Geral

**Onde:** `src/components/pos/POSGeneralDashboard.tsx` (apenas frontend).

Hoje o seletor só tem `Hoje / Semana / Mês` e calcula tudo a partir de `now()`. Vamos adicionar:

- **Meses anteriores:** opções pré-prontas (ex.: "Mês passado", e/ou um seletor de mês/ano) que definem `start = início do mês escolhido` e `end = fim do mês escolhido`.
- **Período personalizado:** um seletor de intervalo de datas (Popover + Calendar já existentes no projeto) com data inicial e final livres.

**Detalhes técnicos:**
- Estender o estado `period` para aceitar `"last_month"` e `"custom"`, guardando `customRange {from, to}`.
- Ajustar o `useMemo` `periodRange` para devolver `start/end/label/days` conforme a opção.
- A query de vendas já usa `startIso/endIso`, então só muda a origem das datas — nenhuma lógica de negócio do dashboard precisa mudar.
- A comparação de metas (`elapsedStart`) deve usar o início do período selecionado.

```text
[ Período ▼ ]  -> Hoje | Semana | Mês | Mês passado | Personalizado…
                                              └─ abre calendário (intervalo)
```

---

## Parte 2 — Sincronização ATIVA de estoque com a Shopify (sem cron)

### Como o sistema funciona hoje (descoberto na investigação)
- Toda venda grava em `pos_sales` + `pos_sale_items`.
- O trigger `trg_pos_sales_stock_movement` (função `apply_pos_sale_stock_movement`) roda **na hora** da venda: abate `pos_products.stock` na loja de origem, registra em `pos_stock_adjustments` e **já dispara `net.http_post` para a edge function `tiny-mirror-stock`** (push event-driven para o Tiny).
- O mapa para a Shopify existe em `product_variants`: `gtin` (= barcode), `sku`, `shopify_variant_id`, `master_id`.
- Vendas do site chegam por `shopify-webhook`, que insere `pos_sales` com `store_id = loja Tiny Shopify`.

Ou seja: a "tubulação" event-driven já existe para o Tiny. Vamos espelhar para a Shopify e corrigir a regra de estoque compartilhado.

### A) Corrigir a baixa para respeitar o estoque compartilhado
**Onde:** migração na função `apply_pos_sale_stock_movement`.

Problema do print (On Cloud): a loja Tiny Shopify tem **0** daquela variação, mas o estoque do site é a soma de todas as lojas. Hoje o trigger só abate na loja-alvo da venda.

Nova regra por item vendido (casado por `barcode`, senão `sku`):
1. Se a loja-alvo da venda tem saldo suficiente daquela variação → abate nela (comportamento atual).
2. Se **não** tem saldo (caso Tiny Shopify = 0) → escolhe automaticamente a loja que tiver saldo daquela variação (maior saldo primeiro) e abate de lá.
3. Registra em `pos_stock_adjustments` a loja real de onde saiu.

Isso garante que vendas do site retirem o par da loja Pérola/Centro/etc. quando a Tiny Shopify não tem o item, e da própria Tiny Shopify quando ela tem.

### B) Nova edge function `shopify-mirror-stock` (push na venda)
**Onde:** `supabase/functions/shopify-mirror-stock/index.ts` (nova), nos moldes da `tiny-mirror-stock`.

- Recebe os itens da venda (barcodes/skus afetados).
- Para cada barcode → encontra `product_variants.shopify_variant_id` (via `gtin`/`sku`).
- Calcula o **estoque compartilhado** = `SUM(pos_products.stock)` daquele barcode em **todas** as lojas.
- Chama a Shopify `inventory_levels/set.json` com o **valor absoluto** (a soma), não um decremento.
  - Usar valor absoluto (igual à `sync-master-product-stock`) é mais robusto: evita drift e divergências por corrida/retry; o número no site sempre reflete o saldo real do sistema.
- Usa as credenciais já existentes (`SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ACCESS_TOKEN`).

### C) Disparo automático a partir do trigger
**Onde:** mesma migração da função do trigger.

- Depois de abater o estoque, montar um payload com os itens que possuem `shopify_variant_id` e disparar `net.http_post` para `shopify-mirror-stock` — exatamente como já é feito para o `tiny-mirror-stock`.
- Resultado: venda no PDV / Live / Site → estoque abatido no sistema → Shopify atualizada na hora, automaticamente. Sem cron.

### D) Garantir a baixa correta nas vendas vindas do site
**Onde:** `supabase/functions/shopify-webhook/index.ts`.

- Hoje o webhook grava `pos_sale_items` só com `sku` (sem `barcode`), o que pode falhar no casamento.
- Enriquecer cada `line_item`: usar `line_item.variant_id` → `product_variants.shopify_variant_id` → preencher `sku` + `barcode (gtin)` corretos no item.
- Assim o trigger casa o item e a regra (A) abate do estoque certo (Tiny Shopify se tiver, senão outra loja com saldo).
- Como a Shopify já reduz o próprio inventário quando o pedido é feito no site, o push da Shopify usa **set absoluto = soma das lojas** — fica idempotente e auto-corretivo mesmo para pedidos originados no site (sem dupla baixa).

---

## Pontos de atenção / decisões
- **Set absoluto vs decremento:** recomendo set absoluto (soma das lojas) para a Shopify — robusto contra reprocessamento e corridas. Confirme se concorda.
- **Loops:** o push à Shopify é seguro mesmo para vendas que vieram da Shopify, porque é um "set" para o saldo verdadeiro do sistema (não um decremento que poderia contar duas vezes).
- **Variações sem `shopify_variant_id`:** simplesmente ignoradas no push (produto não publicado na Shopify) — sem erro.
- **Cancelamento/estorno:** o trigger já trata `cancelled` devolvendo estoque; o push à Shopify (set = nova soma) refletirá a devolução automaticamente.
- **Logs:** registrar resultado do push (sucesso/erro por variante) para auditoria, sem cron de verificação.

## Resumo dos arquivos a tocar (na execução)
- `src/components/pos/POSGeneralDashboard.tsx` — filtro de período (mês anterior + personalizado).
- Migração — ajustar `apply_pos_sale_stock_movement` (estoque compartilhado + disparo Shopify).
- `supabase/functions/shopify-mirror-stock/index.ts` — nova função de push.
- `supabase/functions/shopify-webhook/index.ts` — enriquecer itens com barcode.
