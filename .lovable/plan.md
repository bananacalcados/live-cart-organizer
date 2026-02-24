

## Plano: Melhorias na Aba "Vendas Dia"

### 1. Historico de Vendas - Mostrar Cliente e Produtos

Cada card de venda no historico passara a exibir:
- **Nome do cliente** (buscado via `customer_id` -> `pos_customers.name`)
- **Produtos resumidos** (ex: "Tamanco Joana 41, Sandalia Cecilia 39") a partir dos `pos_sale_items` ja carregados

Ao **clicar no card**, abre um Dialog com todas as informacoes do pedido:
- Data/hora, numero Tiny, vendedor
- Nome, CPF, WhatsApp, endereco do cliente
- Lista completa de itens com SKU, variante, tamanho, preco unitario, quantidade
- Forma de pagamento, subtotal, desconto, total
- Observacoes e botao de reenviar ao Tiny

### 2. Barra de Pesquisa Global de Pedidos

Logo abaixo do titulo "Historico de Vendas", uma barra de pesquisa que:
- Busca **local** primeiro: filtra as vendas do dia pelo nome do cliente
- Se o usuario digitar 3+ caracteres e nao encontrar resultados suficientes, ativa um **botao "Buscar em todos os periodos"**
- Esse botao busca em `pos_sales` + `pos_customers` (JOIN) sem filtro de data, por nome, CPF ou WhatsApp (ILIKE)
- Retorna ate 20 resultados de qualquer periodo
- Os resultados aparecem na mesma lista, com a data completa visivel
- Ao clicar, abre o mesmo Dialog de detalhes do pedido

Isso permite localizar pedidos antigos para trocas sem carregar tudo na memoria.

### 3. Filtro de Produtos Mais Vendidos por "Produto Pai"

Adicionar um toggle/switch acima da lista de produtos mais vendidos:
- **"Por variacao"** (padrao atual): mostra cada SKU/variante separado
- **"Por produto"**: agrupa pelo nome-base do produto (extraido do `product_name` removendo a parte da variante/cor/tamanho, ou usando o prefixo do SKU como chave)

A logica de agrupamento usara o campo `product_name` base. Como o padrao e `"CODIGO NOME - Tamanho - Cor"`, o agrupamento sera feito pelo texto antes do primeiro " - " (separador de variante). Quando agrupado, mostra o total de unidades e faturamento somado de todas as variacoes.

### Mudancas Tecnicas

**Arquivo: `src/components/pos/POSDailySales.tsx`**

1. **Buscar dados de clientes**: Na `loadData`, apos obter as vendas do dia, buscar os `customer_id`s unicos em `pos_customers` para montar um mapa `customerId -> { name, cpf, whatsapp }`. Incluir os items por venda num mapa `saleId -> items[]`.

2. **Estado de pesquisa global**:
   - `searchTerm` (string)
   - `globalSearchResults` (SaleSummary[] com cliente e items)
   - `searchLoading` (boolean)
   - Funcao `searchAllPeriods(term)` que faz query em `pos_sales` JOIN `pos_customers` (via customer_id) filtrando por `name ILIKE`, `cpf ILIKE` ou `whatsapp ILIKE`, sem filtro de data, limit 20

3. **Dialog de detalhes do pedido**:
   - `selectedSale` (SaleSummary | null)
   - Ao selecionar, busca items + customer completo (se nao ja cacheado)
   - Renderiza um Dialog com todas as informacoes

4. **Toggle de agrupamento de produtos**:
   - `groupByParent` (boolean, default false)
   - Quando true, agrupa `saleItems` pelo nome-base (texto antes do primeiro " - ") somando qty e revenue
   - A UI mostra um botao toggle simples ao lado do titulo "Produtos Mais Vendidos"

| Arquivo | Acao |
|---------|------|
| `src/components/pos/POSDailySales.tsx` | Editar (adicionar cliente nos cards, dialog de detalhes, pesquisa global, toggle de agrupamento) |

Nenhuma migracao SQL necessaria - todos os dados ja existem nas tabelas `pos_sales`, `pos_sale_items` e `pos_customers`.

