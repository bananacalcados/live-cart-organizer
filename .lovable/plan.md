
# Balanço de Estoque no PDV (Aba Trocas)

## Resumo
Adicionar uma seção de "Balanço de Estoque" dentro da aba Trocas do POS, permitindo ajustar o estoque de produtos (entrada ou saída) de forma rápida, sincronizando tanto no banco local quanto no Tiny ERP automaticamente.

## Fluxo do Usuário
1. Na aba **Trocas**, o vendedor verá dois sub-abas: "Trocas" (atual) e "Balanço de Estoque" (novo)
2. No Balanço, ele bipa ou busca o produto pelo nome/SKU/código de barras
3. O sistema exibe o produto com o estoque atual (local)
4. O vendedor informa a quantidade e a direção: **Entrada** (+) ou **Saída** (-)
5. Pode adicionar uma observação (ex: "Produto danificado", "Reposição de fornecedor")
6. Ao confirmar, o sistema:
   - Consulta o saldo atual no depósito específico da loja no Tiny
   - Calcula o saldo final absoluto (saldo_atual +/- quantidade)
   - Envia o balanço (tipo B) com `nome_deposito` para o Tiny
   - Atualiza o cache local (`pos_products`)
   - Registra o histórico na tabela `pos_stock_adjustments`

## Detalhes Técnicos

### 1. Nova tabela: `pos_stock_adjustments`
Registra o histórico de todos os ajustes manuais de estoque.

```sql
CREATE TABLE pos_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES pos_stores(id),
  product_id UUID REFERENCES pos_products(id),
  tiny_id BIGINT NOT NULL,
  sku TEXT,
  barcode TEXT,
  product_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  quantity NUMERIC NOT NULL,
  previous_stock NUMERIC,
  new_stock NUMERIC,
  reason TEXT,
  seller_id UUID REFERENCES pos_sellers(id),
  seller_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
Com RLS habilitado e política permissiva para usuários autenticados.

### 2. Edge Function: `pos-stock-balance`
Função dedicada que:
- Recebe `store_id`, `tiny_id`, `quantity`, `direction` ("in"/"out"), `reason`
- Busca o `tiny_token` e `tiny_deposit_name` da loja
- Consulta saldo atual no depósito via `produto.obter.estoque.php`
- Calcula saldo final: `current + qty` (entrada) ou `max(0, current - qty)` (saída)
- Envia balanço tipo B via `produto.atualizar.estoque.php` com `nome_deposito`
- Retorna `previous_stock` e `new_stock`

Reutiliza a mesma lógica já validada em `pos-exchange-stock-adjust`.

### 3. Componente: `POSStockBalance.tsx`
Novo componente renderizado na aba Trocas como sub-aba, contendo:
- **Busca de produto**: reutiliza `POSTinyProductPicker` (busca por nome, SKU ou bipagem)
- **Card do produto selecionado** com estoque local exibido
- **Campos**: Direção (Entrada/Saída via toggle), Quantidade, Motivo (opcional), Vendedor
- **Botão Confirmar** que chama a edge function e salva no histórico
- **Lista de ajustes recentes** do dia abaixo do formulário

### 4. Modificação em `POSExchanges.tsx`
Adicionar tabs internas (usando `Tabs` do Radix) no topo:
- "Trocas" (conteúdo atual)
- "Balanço" (novo componente `POSStockBalance`)

A estrutura do componente atual permanece intacta, apenas envolvida em uma tab.
