
# Custo de Captacao + Controle de Consignado

## Parte 1: Campo de Custo na Captacao

Adicionar coluna `cost_price` (NUMERIC, default 0) na tabela `product_capture_items` para registrar o preco de custo durante a bipagem.

### Mudancas:
- **Migracao**: `ALTER TABLE product_capture_items ADD COLUMN cost_price NUMERIC DEFAULT 0`
- **ProductCaptureTab.tsx**: Adicionar campo "Custo" no dialog de novo item (ao lado do campo Preco que ja existe) e tambem na listagem inline editavel de cada item
- **Relatorio de Custo**: Adicionar um botao "Relatorio de Custo" no header da sessao que gera um resumo com:
  - Lista de todos os produtos agrupados por modelo
  - Custo unitario x quantidade = custo total por item
  - Total geral de custo do estoque capturado
  - Exportavel em formato visual (abre em nova janela para impressao)

### Stats adicionais no topo:
- Adicionar um 4o card: **Custo Total** (soma de cost_price * quantity de todos os itens)

---

## Parte 2: Controle de Consignado (Relatorio de Vendas)

Criar uma nova aba/secao dentro do modulo de Captacao para rastrear vendas dos produtos consignados.

### Abordagem:
Os SKUs capturados na sessao serao cruzados com a tabela `tiny_synced_orders` (que contem as vendas de TODAS as lojas - Perola, Centro e Shopify). O campo `items` (JSONB) de cada pedido contem os SKUs vendidos.

### Nova Edge Function: `consignment-sales-report`
- Recebe `session_id`
- Busca todos os barcodes/SKUs da sessao em `product_capture_items`
- Consulta `tiny_synced_orders` em todas as lojas, filtrando pedidos com status diferente de 'Cancelado' e 'Em aberto'
- Para cada pedido, percorre o array `items` buscando matches por SKU
- Retorna relatorio com:
  - Produto, SKU, loja de venda, data, quantidade vendida, valor unitario, valor total
  - Totalizadores por produto e geral

### UI: Botao "Relatorio Consignado" na sessao de captacao
- Ao clicar, chama a edge function e exibe um dialog/tabela com:
  - Tabela de vendas encontradas por produto/loja
  - Total de pares vendidos
  - Valor total a repassar
  - Opcao de exportar/imprimir

---

## Detalhes Tecnicos

### Migracao SQL
```sql
ALTER TABLE product_capture_items ADD COLUMN cost_price NUMERIC DEFAULT 0;
```

### Edge Function `consignment-sales-report`
- Busca itens da sessao
- Query nas vendas: filtra `tiny_synced_orders` excluindo status cancelados
- Para cada pedido, faz parse do JSONB `items` e compara SKU
- Agrupa resultados por produto e por loja
- Retorna JSON estruturado com totais

### Arquivos modificados
1. `src/components/inventory/ProductCaptureTab.tsx` - campo custo, stats, botoes de relatorio
2. `supabase/functions/consignment-sales-report/index.ts` - nova edge function
3. Migracao para adicionar `cost_price`

### Interface do Relatorio Consignado (Dialog)
- Tabela com colunas: Produto | Loja | Data Venda | Qtd | Valor Unit. | Total
- Linha de totalizacao por produto
- Rodape com total geral de pares e valor a repassar
- Botao "Imprimir" que abre em nova janela formatada
