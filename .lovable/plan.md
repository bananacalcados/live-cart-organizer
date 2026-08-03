# Prêmios: abatimento no cartão/boleto + controle de prêmio físico já entregue

## O que encontrei hoje (diagnóstico)

**1. Abatimento automático só funciona no PIX.**
A Fase 3 foi aplicada apenas na função que gera o PIX. Ela busca o melhor prêmio ativo, abate o valor e reserva o prêmio para o pedido.

- Cartão de crédito e débito: o valor cobrado é o total calculado no navegador do cliente e enviado pronto para a função de cobrança (cascata Mercado Pago → Pagar.me → Vindi → AppMax). Nenhum prêmio é consultado nem abatido.
- Boleto com PIX: também não consulta prêmios.
- Resultado: hoje a cliente que ganhou 10% OFF paga o valor cheio se escolher cartão, e o prêmio continua "ativo" (não é consumido).

**2. Prêmio físico já está corretamente fora do abatimento.**
O cálculo de desconto só considera os tipos cupom %, valor fixo e frete grátis. Prêmio do tipo "produto" nunca vira desconto — ele só é anexado ao pedido como brinde. Esse comportamento será mantido e reforçado por teste.

**3. Riscos reais de entregar o prêmio físico duas vezes.**
- O prêmio é reservado ao pedido, mas nunca marcado como "enviado". Só é marcado como usado quando o pagamento é confirmado — e para prêmio físico a confirmação de pagamento não significa entrega.
- Se o pedido for cancelado/excluído na expedição, o prêmio fica travado para sempre naquele pedido (cliente perde o prêmio).
- Se a cliente faz 2 pedidos no mesmo dia, o segundo pedido pode reanexar outro prêmio físico dela (se tiver mais de um) sem visibilidade para a vendedora.
- A área de membros mostra o prêmio como "ativo" mesmo depois de já ter sido despachado, o que gera cobrança da cliente ("não recebi/quero de novo").

## O que será implementado

### A. Abatimento também no cartão e no boleto
- Mover a resolução de prêmio para o servidor em todos os meios de pagamento, com a mesma regra do PIX (melhor prêmio, reserva por pedido).
- Cartão: a função de cobrança recalcula o total no servidor a partir do pedido, aplica o prêmio, e usa esse valor como teto. Se o valor recebido do front for maior que o valor com prêmio, cobra-se o valor com prêmio (nunca mais que o front, para não cobrar a mais por bug).
- Parcelamento: o prêmio é abatido antes do cálculo de juros/parcelas.
- Frete grátis como prêmio: zera o frete antes de somar.
- Boleto: mesma lógica do PIX.
- O checkout passa a exibir a linha "🎡 Prêmio: -R$ X" no resumo, para o valor na tela bater com o cobrado.
- Regra mantida: prêmio físico nunca entra no cálculo de desconto.

### B. Ciclo de vida do prêmio físico (evitar entrega dupla)
Novo status explícito do prêmio físico, com estas etapas:

```text
ATIVO  →  RESERVADO (anexado a um pedido)  →  ENVIADO (pedido despachado)
   ↑                    |
   └──── liberado se o pedido for cancelado/excluído
```

- Ao concluir a expedição do pedido (etapa Concluídos/despacho), o prêmio anexado é marcado como ENVIADO com data/hora e o número do pedido.
- Ao cancelar/excluir um pedido, o prêmio volta a ficar ATIVO automaticamente (não some).
- Um prêmio físico só pode estar reservado em um pedido por vez (trava no banco), então não há como duplicar.
- Regra extra de segurança: no máximo 1 prêmio físico anexado por pedido, e se a cliente tiver 2 prêmios físicos, o segundo só é anexado a um pedido diferente.

### C. Visibilidade para a cliente e para a equipe
- Área de membros: cada prêmio mostra um selo — ATIVO (com prazo), RESERVADO NO PEDIDO #xxxx, ENVIADO em dd/mm ou USADO (para cupons já abatidos).
- Card do pedido e "Ver pedido": mostra o prêmio anexado e se já foi enviado.
- Expedição: mantém o aviso grande do brinde e passa a mostrar "prêmio já enviado em outro pedido" quando for o caso, evitando repetir.

## Situações consideradas (e como ficam)
- Cliente compra 2x no mesmo dia: o prêmio já reservado/enviado não reaparece como disponível no segundo pedido.
- Pedido cancelado ou estornado: prêmio destravado e volta a valer (respeitando validade).
- Pedido pago mas não despachado: prêmio fica RESERVADO, não some, e a expedição continua sabendo que precisa incluir.
- Dois atendentes gerando cobrança ao mesmo tempo: a reserva é atômica no banco, o segundo não pega o mesmo prêmio.
- Cliente troca PIX por cartão no mesmo pedido: como a reserva é por pedido, o mesmo prêmio é reaproveitado (não duplica nem se perde).
- Prêmio expirado após reserva: continua válido para o pedido já reservado.

## Detalhes técnicos
- Novas colunas em `customer_prizes`: `fulfillment_status` (active/reserved/shipped), `shipped_at`, `shipped_order_id`; índice único parcial em `applied_order_id` para prêmios do tipo `product`.
- `_shared/prize-discount.ts`: mantém filtro de tipos de desconto; adiciona `releasePrizesForOrder(orderId)` e `markPhysicalPrizeShipped(orderId)`.
- `pagarme-create-charge` (cascata cartão/débito) e `mercadopago-create-boleto`: recalculam total no servidor via mesma rotina do PIX e aplicam `resolveAndReservePrize`.
- Gatilhos/RPC de expedição (conclusão e `expedition_cancel_sale`) chamam marcação de enviado / liberação.
- `get_customer_active_prizes` passa a devolver o status de fulfillment; `LiveMemberArea`, `OrderCardDb` e `OrderFullViewDialog` exibem o selo.
- Testes unitários para: prêmio físico nunca gera desconto; melhor prêmio escolhido; reserva idempotente por pedido.
