
# Plano — Opção A: Unificação real em `pos_products`

## Objetivo
Tornar `pos_products` a **única fonte de verdade operacional** (estoque por loja, código de barras, vendas PDV/site, entrada de NF-e, emissão de NF-e/NFC-e via BrasilNFe). Os metadados fiscais e de catálogo (NCM, CFOP, custo, imagens, descrição, hierarquia pai→variantes) passam para uma tabela complementar **`product_master_data`** ligada por `parent_sku`. No fim, `products_master` e `product_variants` são removidas.

## Arquitetura final

```text
                    ┌──────────────────────────┐
                    │  product_master_data     │  (1 linha por modelo-pai)
                    │  - parent_sku (PK)       │
                    │  - name, description     │
                    │  - ncm, cfop, cest       │
                    │  - cost, markup          │
                    │  - images[], shopify_id  │
                    └─────────────┬────────────┘
                                  │ parent_sku
                    ┌─────────────▼────────────┐
                    │       pos_products       │  (1 linha por SKU × loja)
                    │  - sku, parent_sku       │
                    │  - color, size, barcode  │
                    │  - store_id, stock       │
                    │  - price, promo_price    │
                    └──────────────────────────┘
                              ▲       ▲
                  PDV / Site  │       │  Entrada NF-e
                  (baixa estoque)     (sobe estoque)
```

Tudo (PDV, site, expedição, balanço, captação, NF-e entrada, BrasilNFe saída, edição de produto) lê e escreve em `pos_products` + `product_master_data`.

---

## Etapas

### Etapa A1 — Criar `product_master_data` e backfill
- `CREATE TABLE product_master_data` com NCM, CFOP, CEST, descrição, custo, markup, imagens, shopify_id, etc.
- Backfill a partir de `products_master` usando `parent_sku` deduzido (mesma lógica de `extract_base_product_name` já validada).
- Adicionar coluna `parent_sku` em `pos_products` (se não existir) e popular via mesma regra.
- **Risco:** SKUs sem padrão claro de "pai" ficam órfãos.
- **Mitigação:** relatório de órfãos antes de prosseguir; fallback `parent_sku = sku` para itens únicos.

### Etapa A2 — Trigger de entrada NF-e direto em `pos_products`
- Reescrever o pipeline de importação NF-e (`NfeImporter`, `ProductCaptureTab`, edge `tiny-fiscal-import`) para:
  - Inserir/atualizar linha em `pos_products` (uma por loja de destino) **somando estoque**.
  - Inserir/atualizar `product_master_data` (NCM, custo, descrição) por `parent_sku`.
- **Risco:** quebrar fluxo fiscal em produção durante a troca.
- **Mitigação:** feature flag `use_unified_inventory` no edge function; rollback = desligar flag.

### Etapa A3 — Reescrever aba Produtos (`ProductsList`, `ProductEditDialog`, `ProductStockManagerDialog`)
- Listar agrupando `pos_products` por `parent_sku` (cabeçalho) + variantes (SKUs).
- Estoque exibido = soma real por loja (já está em `pos_products`).
- Edição de nome/descrição/NCM/imagens grava em `product_master_data`.
- Edição de preço/cor/tamanho/código de barras grava em `pos_products`.
- **Risco:** perda de campos hoje só presentes em `product_variants`.
- **Mitigação:** auditoria pré-migração lista campos divergentes; copia para `pos_products` ou `product_master_data` antes de cortar.

### Etapa A4 — Reescrever emissão BrasilNFe (NF-e / NFC-e loja CENTRO)
- Edge function de emissão lê `pos_products` (preço, qtd, código de barras) + `product_master_data` (NCM, CFOP, descrição fiscal).
- Trigger pós-emissão: dá baixa em `pos_products.stock` da loja correspondente atomicamente.
- **Risco:** divergência fiscal se NCM faltar.
- **Mitigação:** validação obrigatória no momento da emissão (bloqueia se NCM ausente) + relatório prévio de produtos sem NCM.

### Etapa A5 — Garantir baixa unificada em todas as vendas
- PDV: já baixa de `pos_products` ✅
- Site/checkout: confirmar trigger que baixa `pos_products` ao confirmar pagamento.
- Livete/eventos: idem.
- **Risco:** trigger duplicado dando baixa dobrada.
- **Mitigação:** idempotência por `order_id + sku` (tabela `stock_movements` já existe — usar como lock).

### Etapa A6 — Remover triggers antigas (Etapa 3) e descomissionar tabelas
- `DROP TRIGGER trg_master_name_to_pos / trg_variant_to_pos / trg_pos_to_catalog`
- `DROP VIEW product_variant_stock` (se a aba Produtos já não usar mais)
- `DROP TABLE product_variants`
- `DROP TABLE products_master`
- **Risco:** algum componente ainda lendo das tabelas antigas → erro 500.
- **Mitigação:** antes do DROP, `RENAME` para `_deprecated_products_master` por 7 dias; monitorar logs Supabase; só então DROP definitivo.

---

## Ordem de execução e checkpoints
1. A1 (migração + backfill + relatório de órfãos) → **checkpoint: você valida o relatório.**
2. A2 (NF-e entrada) → **checkpoint: subir 1 NF-e de teste em homologação.**
3. A3 (aba Produtos) → **checkpoint: você navega e confirma estoque batendo.**
4. A4 (BrasilNFe saída loja CENTRO) → **checkpoint: emitir 1 NFC-e de teste.**
5. A5 (auditoria de baixas) → **checkpoint: 24h observando `stock_movements`.**
6. A6 (drop tabelas antigas) → só após 7 dias sem erro nas antigas renomeadas.

## Riscos transversais
- **Concorrência de baixa**: usar `UPDATE ... WHERE stock >= qty RETURNING` para evitar estoque negativo acidental (preservando os negativos atuais que você quer manter para balanço).
- **Multi-loja**: toda escrita deve carregar `store_id` explícito; faltar `store_id` = rejeitar.
- **Rollback**: cada etapa é uma migration reversível; A6 é a única irreversível e só roda após janela de observação.

## O que NÃO muda
- PDV, expedição, balanço, análise IA, management — já leem `pos_products`, continuam funcionando sem alteração de código.
- Sync Tiny continua existindo como **canal auxiliar** (recebe atualizações que vierem de fora), não como fonte de verdade.

---

Posso começar pela **Etapa A1** (criar `product_master_data` + backfill + relatório de órfãos para você revisar)?
