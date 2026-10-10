# Redução de valor de venda em lote (Expedição > Pedidos)

## Objetivo
Selecionar 1 ou mais pedidos na primeira aba da Expedição e aplicar uma redução (% ou valor fixo). A redução muda o **preço unitário** dos produtos (ex.: 360 com 20% vira 288), sem lançar como "desconto". A nota fiscal sai com 288 como valor do item, então o imposto é calculado só sobre o que foi realmente vendido. Depois você faz o estorno pelo banco.

## Como vai funcionar na tela
1. Caixas de seleção nos cards de pedido da aba "Aprovados".
2. Botão "Reduzir valor (N)" aparece quando há pedidos marcados.
3. Janela com:
   - Tipo: % ou valor fixo (R$).
   - Motivo obrigatório: Cashback não aplicado, Negociação, Outro (+ texto).
   - Prévia por pedido: valor atual → novo valor, valor a estornar ao cliente, e cada produto com preço antigo → novo.
4. Ao confirmar, o pedido mostra um selo "Valor reduzido -R$ X" e o histórico do ajuste.
5. Botão "Desfazer redução" enquanto a nota não tiver sido emitida.

## Regras de segurança
- **Bloqueado se o pedido já tem NF-e autorizada.** Nota emitida não pode mudar de valor; nesse caso o caminho correto é nota de devolução parcial. A janela avisa e pula esses pedidos.
- Valor fixo em vários pedidos: aplicado **por pedido** (R$ 20 em cada), com aviso claro na prévia.
- Valor fixo é distribuído entre os itens proporcionalmente ao preço; os centavos de arredondamento vão para o último item, para que a soma bata exatamente.
- Nunca deixar item com preço zero ou negativo; frete não é reduzido.
- Preço original é guardado; nada é sobrescrito sem possibilidade de voltar.
- Um pedido só pode ter uma redução ativa (para não aplicar duas vezes por engano); para mudar, desfaz e aplica de novo.

## Impactos que serão tratados
- **Nota fiscal:** passa a usar o preço reduzido como valor do produto (não como campo de desconto). O formato da nota que já funciona continua igual; só muda o número do preço.
- **Faturamento/DRE:** a venda passa a contar pelo valor reduzido no dia original da compra (é uma correção do valor da venda, não uma venda nova).
- **Cashback:** o cálculo de 10% continua sobre o valor realmente pago, então passa a usar o valor reduzido.
- **Estorno bancário:** fica registrado o valor a estornar e a marcação "estorno feito" (manual), para conciliação.
- Sem mudanças no checkout, no Pix, nem na Shopify.

## Fases (cada uma testável sozinha)
1. Banco: guardar preço original, preço ajustado e registro do ajuste. Nada muda visivelmente.
2. Nota fiscal: emissão usa o preço ajustado quando existir. Teste em homologação com um pedido de exemplo antes de valer em produção.
3. Tela: seleção, janela com prévia, aplicar/desfazer, selo no card.
4. Conferir faturamento, DRE e cashback com um pedido real ajustado.

## Detalhes técnicos
- Migration: `expedition_order_items` ganha `original_unit_price numeric` e `adjusted_unit_price numeric` (nulos). Nova tabela `order_price_adjustments` (order_id, mode `percent|fixed`, value, reason, total_before, total_after, refund_amount, refund_done_at, created_by, reverted_at), com GRANT + RLS por `has_role`/acesso à loja. Espelho em `pos_sales`/`pos_sale_items` quando o pedido tem venda vinculada (mesma lógica de `unit_price` + `cost_price_at_sale` intacto).
- Aplicação via RPC `apply_order_price_adjustment(p_order_ids uuid[], p_mode, p_value, p_reason)` em transação única, `SECURITY DEFINER`, recusando pedidos com `fiscal_documents` autorizado, teto de 100 pedidos por chamada, UPDATE só onde valor difere. RPC `revert_order_price_adjustment(p_order_id)`.
- `nfe-emitir`: no mapeamento de `expedition_order_items` (linha ~371) e `pos_sale_items`, usar `coalesce(adjusted_unit_price, unit_price)`; o rateio de `descontoVenda` continua igual, mas o desconto do pedido não recebe a redução (ela já está no preço). Payload BrasilNFe preservado.
- Totais do pedido (`total`/`subtotal`) recalculados pela RPC; `v_sale_*` / `dre_period` leem o valor novo sem alteração de código.
- Front: seleção em `ExpeditionOrdersList.tsx`, novo `PriceAdjustmentDialog.tsx`. 1 consulta extra ao abrir a janela (itens dos pedidos selecionados, IN único), sem polling.
- Antes da fase 1: conferir triggers existentes em `pos_sales`/`pos_sale_items` (estoque, cashback, Shopify) para garantir que mudar `unit_price` não gera baixa de estoque nem envio à Shopify; se gerar, a RPC atualiza só `adjusted_unit_price`.
