

## Plano: Venda Online no POS

Nova aba "Venda Online" no POS para vendedoras gerarem links de pagamento (Yampi, Checkout, PayPal, PIX) diretamente do PDV, com registro automatico da venda para comissoes e ajuste de estoque entre depositos.

---

### Como funciona o fluxo

```text
Vendedora seleciona produtos (catalogo Shopify)
        |
Escolhe forma de pagamento (Yampi / Checkout / PayPal / PIX)
        |
Sistema gera o link de pagamento
        |
Vendedora envia pro cliente (copia/cola ou WhatsApp)
        |
Quando o pagamento e confirmado (webhook Yampi/Shopify):
  1. Pedido Shopify e criado automaticamente (ja existe)
  2. Venda e registrada no pos_sales (comissao da vendedora)
  3. Estoque e transferido: Loja Fisica -> Site (compensacao)
```

### Problema do Estoque Duplo -- Solucao

O problema: Shopify cria pedido no Tiny Site, que desconta estoque do deposito "Site". Mas o produto saiu da loja fisica.

A solucao usa a Edge Function `expedition-transfer-stock` que ja existe:
- Ela **aumenta** o estoque no deposito "Site" (+1)
- Ela **diminui** o estoque no deposito da loja fisica (-1)
- Resultado liquido: Shopify desconta do Site (-1), mas a transferencia repoe (+1). So a loja fisica perde estoque.

Isso e feito automaticamente ao registrar a venda online, sem intervencao manual.

---

### Estrutura da Tela

**Aba lateral**: "Online" com icone `Globe` (entre "Vendas Dia" e "Retiradas")

**Layout em 2 colunas (desktop) / steps (mobile):**

**Coluna Esquerda -- Catalogo Shopify**
- Busca por nome/SKU (reutiliza a logica de `fetchProducts` do Shopify)
- Grid de produtos com foto, nome, variante, preco
- Click para adicionar ao carrinho
- Filtros por colecao e tamanho (similar ao `POSProductCatalogSender`)

**Coluna Direita -- Carrinho e Checkout**
- Lista de itens selecionados com quantidade editavel
- Selecao de vendedora (obrigatorio, usa sellers do POS)
- Selecao de loja de estoque (qual deposito sera debitado)
- Campo para dados do cliente (nome, WhatsApp -- opcional)
- Botoes de pagamento:
  - **Yampi** -- gera link via `yampi-create-payment-link`
  - **Checkout** -- abre link do checkout transparente proprio
  - **PayPal** -- gera link via `paypal-create-order`
  - **PIX** -- gera link via `mercadopago-create-pix`
- Ao gerar link, mostra o link copiavel + botao de enviar via WhatsApp

---

### Mudancas Tecnicas

**Novo arquivo: `src/components/pos/POSOnlineSales.tsx`**
- Componente que recebe `storeId` e `sellers` como props
- Busca produtos da Shopify via `fetchProducts()` (de `src/lib/shopify.ts`)
- Carrinho local com itens selecionados
- Ao clicar em "Gerar Link":
  1. Chama a edge function do gateway escolhido
  2. Salva registro em `pos_sales` com status `online_pending` e tipo `online`
  3. Salva itens em `pos_sale_items`
  4. Chama `expedition-transfer-stock` para cada item (loja selecionada -> Site)
  5. Atualiza gamificacao da vendedora (pontos por venda online)

**Arquivo editado: `src/pages/POS.tsx`**
- Adicionar `"online"` ao tipo `POSSection`
- Adicionar entrada: `{ id: "online", label: "Online", icon: Globe, priority: true }`
- Renderizar `<POSOnlineSales storeId={selectedStore} sellers={sellers} />`

**Migracao de banco (pos_sales)**
- Adicionar coluna `sale_type` (text, default 'physical') para diferenciar vendas presenciais de online
- Adicionar coluna `payment_link` (text, nullable) para guardar o link gerado
- Adicionar coluna `payment_gateway` (text, nullable) para saber qual gateway foi usado (yampi/checkout/paypal/pix)
- Adicionar coluna `stock_source_store_id` (uuid, nullable, FK pos_stores) para saber de onde saiu o estoque

---

### Fluxo de Estoque Detalhado

Quando a vendedora gera o link:
1. O sistema registra a venda como `online_pending`
2. Para cada item do carrinho, chama `expedition-transfer-stock`:
   - `source_store_id` = loja fisica selecionada pela vendedora
   - `sku` = SKU do produto
   - `quantity` = quantidade
3. Isso faz: Loja Fisica (-qty) e Site (+qty)
4. Quando Shopify processar o pedido, o Tiny Site desconta (-qty) do deposito Site
5. Resultado final: so a loja fisica perdeu estoque

Se o cliente **nao pagar**, a vendedora pode cancelar a venda, e o sistema reverte a transferencia (Site -> Loja Fisica).

---

### Dashboard de Comissoes

As vendas online salvas em `pos_sales` com `sale_type = 'online'` aparecerao automaticamente:
- No **Dashboard** (metricas de vendas por vendedora)
- No **Vendas Dia** (listagem diaria)
- No **Ranking/Gamificacao** (pontos)

Nao precisa de nenhuma mudanca nesses componentes pois eles ja consultam `pos_sales` e `pos_sale_items`.

---

### Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| `src/components/pos/POSOnlineSales.tsx` | Criar (novo componente) |
| `src/pages/POS.tsx` | Editar (adicionar aba) |
| Migracao SQL | Adicionar colunas em `pos_sales` |

