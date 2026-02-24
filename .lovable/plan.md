
## Plano: Filtro de Periodo Customizado + Correcao da Logica de Balanco no Tiny

### 1. Dashboard - Seletor de Periodo com Calendario

O Dashboard atualmente so tem toggles de Dia/Semana/Mes. Vamos adicionar um **seletor de intervalo de datas** (date range picker) com calendario, mantendo os atalhos rapidos.

**Mudancas em `src/components/pos/POSDashboard.tsx`:**
- Adicionar estado `customRange: { from: Date; to: Date } | null`
- Adicionar um botao "Personalizado" ao lado de Dia/Semana/Mes
- Ao clicar em "Personalizado", abrir um Popover com calendario `mode="range"` (date-fns + shadcn Calendar)
- Quando um range customizado estiver ativo, a funcao `getPeriodRange` retorna o range selecionado
- Exibir o intervalo selecionado no header (ex: "01/02 - 24/02")

### 2. Vendas Dia - Adicionar Semana, Mes e Periodo Customizado

Atualmente o Vendas Dia so permite navegar por dia unico. Vamos transformar o seletor de data num sistema de periodos.

**Mudancas em `src/components/pos/POSDailySales.tsx`:**
- Adicionar estado `periodMode: "day" | "week" | "month" | "custom"` (default: "day")
- Adicionar `ToggleGroup` com opcoes Dia / Semana / Mes / Personalizado no header, ao lado do calendario
- Para Semana: carregar ultimos 7 dias (data selecionada - 6 dias ate data selecionada)
- Para Mes: carregar ultimos 30 dias
- Para Personalizado: abrir calendario com `mode="range"` para selecionar intervalo
- A funcao `loadData` usara o periodo calculado (nao apenas `dayStart`/`dayEnd`)
- Os KPIs e graficos refletem o periodo inteiro
- As setas de navegacao funcionam de acordo (avancar/recuar por semana ou mes)

### 3. Correcao da Logica de Balanco no Tiny (CRITICO)

O problema identificado esta na Edge Function `pos-exchange-stock-adjust`. Ela faz o seguinte:

```text
Atual (ERRADO):
1. GET estoque via produto.obter.estoque.php (sem deposito)
2. Calcula: newStock = currentStock +/- quantity  
3. Atualiza via produto.atualizar.estoque.php com estoque=newStock (SEM deposito, SEM XML tipo B)
```

Isso causa dois erros:
- **Nao especifica o deposito**: le o saldo global (todas as lojas somadas) e grava sem deposito, sobrescrevendo o saldo errado
- **Nao usa formato XML com tipo=B**: o formato correto para balanco no Tiny exige o XML com `<tipo>B</tipo>` e `<deposito>NomeDoDeposito</deposito>`

**Correcao em `supabase/functions/pos-exchange-stock-adjust/index.ts`:**

```text
Novo (CORRETO):
1. Buscar tiny_deposit_name da loja em pos_stores
2. GET estoque do deposito especifico via produto.obter.estoque.php 
   (ou ler do pos_products.stock como cache local)
3. Calcular: 
   - item "in"  (devolvido): newStock = currentStock + quantity
   - item "out" (saiu):      newStock = currentStock - quantity
4. Atualizar via produto.atualizar.estoque.php com XML:
   <estoque>
     <idProduto>TINY_ID</idProduto>
     <tipo>B</tipo>
     <quantidade>NEW_STOCK</quantidade>
     <deposito>NOME_DEPOSITO</deposito>
     <observacoes>Troca POS: entrada/saida</observacoes>
   </estoque>
```

Este e o mesmo padrao usado com sucesso em `expedition-transfer-stock` e `inventory-correct-stock`.

**Tambem revisar `pos-inter-store-stock-transfer`:**
- Atualmente usa `produto.atualizar.estoque.php` com `estoque=X` simples (sem XML, sem deposito)
- Corrigir para usar o formato XML com `<tipo>B</tipo>` e `<deposito>` para cada loja
- Buscar `tiny_deposit_name` de ambas as lojas (origem e destino)

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| `src/components/pos/POSDashboard.tsx` | Editar - adicionar date range picker customizado |
| `src/components/pos/POSDailySales.tsx` | Editar - adicionar toggles semana/mes/personalizado |
| `supabase/functions/pos-exchange-stock-adjust/index.ts` | Editar - corrigir para usar XML com tipo=B e deposito |
| `supabase/functions/pos-inter-store-stock-transfer/index.ts` | Editar - corrigir para usar XML com tipo=B e deposito |

Nenhuma migracao SQL necessaria.
