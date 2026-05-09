# Plano

## 1) Checkout do `/evento/:slug` idêntico ao Checkout Transparente do módulo Eventos

**Situação atual:** o link `https://checkout.bananacalcados.com.br/evento/live-09-05` usa `CatalogLeadPage` que cria uma venda em `pos_sales` e redireciona para `/checkout-loja/:storeId/:saleId` (`StoreCheckout.tsx`). É um componente de checkout completamente separado do `TransparentCheckout.tsx` (`/checkout/order/:orderId`), que é o usado pela Live.

São fluxos com modelos de dados diferentes:
- `StoreCheckout` lê de `pos_sales` + `pos_sale_items`.
- `TransparentCheckout` lê de `orders` + `order_items` (do módulo Eventos), tem banners de social proof, contadores, animações de pagamento, integrações com Pixel (InitiateCheckout/AddPaymentInfo/AddShippingInfo/Purchase), gateway cascade etc.

**Como vou deixar idêntico:**

Em vez de duplicar 2.000 linhas do `TransparentCheckout` no `StoreCheckout`, o caminho certo é fazer o `/evento/` criar um `order` igualzinho ao da Live e mandar para a mesma URL `/checkout/order/:orderId`. Assim, fica realmente idêntico (mesmo componente).

Etapas:

1. **`CatalogLeadPage.handleCheckout`** passa a:
   - Criar registro em `orders` (com `event_id`, `customer_*`, `total`, `subtotal`, `is_paid=false`, `source='catalog_lead'`).
   - Inserir itens em `order_items` mapeados do carrinho do catálogo (sku, variant, qty, price, image).
   - Persistir `order.id` em `catalog_lead_registrations.checkout_sale_id` (para manter o tracking atual).
   - Redirecionar para `https://checkout.bananacalcados.com.br/checkout/order/{order.id}`.

2. **Mapeamento de campos** que o `TransparentCheckout` espera (consultar `OrderData` no arquivo) — preencher `metadata.shipping_amount`, `metadata.catalog_slug`, `metadata.source='evento_lp'` para manter rastreabilidade.

3. **Frete:** passar o `shipping_cost` do catálogo no metadata para o Transparent ler como frete fixo padrão (mantendo regra de frete grátis se já houver compra anterior — flag `shippingAlreadyPaid`).

4. **Pós-pagamento:** o Transparent já dispara Pixel Purchase via DB trigger ao marcar `is_paid=true`. Compatível.

5. **Aposentar `/checkout-loja/:storeId/:saleId` para esse fluxo** (a rota continua existindo para outros usos do PDV, mas o catálogo deixa de usá-la).

**Observação importante:** este é um ponto crítico do funil. Vou implementar mantendo o fluxo atual como fallback (flag) e testar com a sua aprovação antes de remover. Se preferir, em vez disso, posso fazer apenas uma "skin" — copiar os banners/animações do Transparent para o StoreCheckout — mas aí não ficará 100% idêntico (será uma cópia que vai divergir com o tempo). Recomendo o caminho da unificação.

## 2) Desconto por produto no "Gerenciar Produtos" da Live

**Onde:** `src/components/marketing/CatalogLeadPageCreator.tsx` — tela que lista produtos do Shopify para selecionar na página `/evento/:slug`.

Hoje só dá pra marcar/desmarcar produtos. Vou adicionar:

- Campo opcional **"Desconto"** ao lado de cada produto selecionado, com toggle entre:
  - **% (porcentagem)** — ex: 20%
  - **R$ (valor fixo de desconto)** — ex: -R$ 30
  - **R$ (preço promocional fixo)** — ex: De R$ 199 por R$ 149
- Persistido em `catalog_lead_pages.product_discounts` (novo campo JSONB) no formato:
  ```json
  { "<productId>": { "type": "percent" | "fixed_off" | "fixed_price", "value": 20 } }
  ```

**Renderização em `CatalogLeadPage.tsx`:**
- Calcular `finalPrice` baseado no desconto.
- Mostrar preço riscado (`R$ 199,99`) + preço promocional em destaque + selo "−20%" (igual ao padrão de e-commerce).
- Carrinho usa `finalPrice` ao montar `cart_items`/`order_items` e o `cartTotal`.

**Migration:**
```sql
ALTER TABLE public.catalog_lead_pages
  ADD COLUMN product_discounts jsonb NOT NULL DEFAULT '{}'::jsonb;
```

## Arquivos afetados

- `supabase/migrations/...` — coluna `product_discounts`.
- `src/components/marketing/CatalogLeadPageCreator.tsx` — UI de desconto por produto.
- `src/pages/CatalogLeadPage.tsx` — render com desconto + criar `order` em vez de `pos_sales`.
- `src/pages/TransparentCheckout.tsx` — pequeno ajuste para aceitar `metadata.shipping_amount` vindo do catálogo (se necessário).

## Confirmação

Antes de implementar, confirme:
1. **Pode unificar o checkout** (criar `orders` em vez de `pos_sales` para o fluxo `/evento/`)? Ou prefere apenas portar o visual mantendo `pos_sales`?
2. Os 3 tipos de desconto (% / R$ off / preço fixo) atendem? Ou prefere apenas % por simplicidade?
