

## Plano de Implementacao

### Problema 1: Checkout sem detalhamento de frete

O checkout (`StoreCheckout.tsx`) ja mostra frete no `OrderSummary`, mas o **total exibido no botao de pagamento e no resumo nao discrimina claramente o frete**. O `shipping_amount` esta sendo carregado do `payment_details` corretamente, porem:

- Quando `shipping_amount === 0`, mostra "Frete gratis!" - isso ja funciona
- Quando `shipping_amount > 0`, mostra o valor - isso ja funciona

O problema pode ser que o **total da venda ja inclui o frete**, entao o resumo nao mostra a decomposicao correta (subtotal produtos + frete = total). Vou garantir que o resumo mostre:

1. **Subtotal dos produtos** (sem frete)
2. **Frete: R$ X,XX** ou **Frete gratis!**
3. **Total final** (subtotal + frete)

**Arquivo:** `src/pages/StoreCheckout.tsx` (componente `OrderSummary`)
- Ajustar calculo do total exibido para separar `subtotal - descontos + frete`
- Garantir que a linha de frete sempre apareca (gratis ou com valor)

---

### Problema 2: Troca "Criar Sem Pedido" sem selecao de produtos

Quando o usuario clica "Criar Sem Pedido", o fluxo pula direto para `exchange_details` com `selectedSale.items = []`. Isso significa:
- **Nao ha local para selecionar os itens que estao VOLTANDO** (devolvidos)
- **Os itens novos** ja tem o `POSTinyProductPicker`, mas falta o mesmo para devolvidos

**Solucao:**
No step `exchange_details`, quando `selectedSale.id === "manual"` (sem pedido), adicionar uma secao de **"Itens Devolvidos"** com barra de pesquisa (`POSTinyProductPicker`) para bipar/buscar os produtos que estao voltando, assim como ja existe para os novos produtos.

**Arquivo:** `src/components/pos/POSExchanges.tsx`

Mudancas:
1. Adicionar estado `returnedItemsManual` (array de `ExchangeItem[]`) para o fluxo manual
2. No step `exchange_details`, quando `selectedSale.id === "manual"`:
   - Exibir secao "Itens Devolvidos" com `POSTinyProductPicker` (mesma logica do `ItemRow`)
   - Exibir secao "Novos Produtos" (ja existe)
3. Ajustar `handleSave` para usar `returnedItemsManual` quando no fluxo manual
4. Ajustar `adjustStockInTiny` para funcionar com os itens manuais
5. Recalcular `returnedTotal` e `differenceAmount` considerando os itens manuais

### Logica de Balanco Tiny (confirmacao)

Sim, a logica de balanco (tipo B) funciona assim:
1. Buscar saldo atual do deposito especifico via `produto.obter.estoque.php`
2. Calcular quantidade final absoluta: `saldo_atual + quantidade` (devolucao) ou `saldo_atual - quantidade` (saida)
3. Enviar via `produto.atualizar.estoque.php` com tipo B e `nome_deposito`

A funcao `pos-exchange-stock-adjust` ja implementa isso corretamente. Basta garantir que os itens manuais incluam `tiny_id` (obtido via `POSTinyProductPicker`) para que o ajuste funcione.

---

### Resumo tecnico das alteracoes

| Arquivo | Mudanca |
|---|---|
| `src/pages/StoreCheckout.tsx` | Melhorar decomposicao de frete no OrderSummary |
| `src/components/pos/POSExchanges.tsx` | Adicionar picker de produtos devolvidos no fluxo "Criar Sem Pedido" |

Nenhuma alteracao de banco de dados necessaria.

