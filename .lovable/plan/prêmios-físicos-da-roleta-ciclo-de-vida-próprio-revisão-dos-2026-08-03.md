# Prêmios físicos da roleta — ciclo de vida próprio (revisão dos planos B e C)

## Premissas corrigidas

1. Prêmio físico só existe na **roleta de pagadores**, girada **depois** do pagamento. Logo, ele já nasce "conquistado" — não deve depender de nenhuma confirmação de pagamento para virar válido.
2. Prêmio físico **nunca** vira desconto no valor do pedido. Ele só aparece como brinde/prêmio.
3. Se o pedido for cancelado, excluído na expedição ou estornado, o cliente **perde o prêmio definitivamente**. O prêmio não volta para a área de membros nem pode ser usado num pedido futuro.

## Ciclo de vida (novo)

```text
GANHO (roleta de pagadores)
   |
   v
DISPONÍVEL  -- vinculado a um pedido -->  RESERVADO
                                             |
                    expedição concluída ---> ENVIADO   (fim, nunca volta)
                                             |
             pedido cancelado/excluído/estornado ---> PERDIDO (fim, nunca volta)

DISPONÍVEL sem uso até o prazo ---> EXPIRADO (fim)
```

Regras:
- Só um prêmio físico por pedido.
- Um prêmio físico só pode estar reservado em um pedido por vez.
- **ENVIADO** e **PERDIDO** são estados finais e irreversíveis pelo fluxo automático.
- Enquanto **RESERVADO**, o prazo de expiração fica congelado (o cliente não perde o prêmio porque a expedição demorou).
- Reversão só por ação manual da equipe (botão "reabrir prêmio", com registro de quem fez e por quê) — para corrigir erro operacional, não como fluxo normal.

## Como fica para cada pessoa

**Cliente (área de membros)**
Cada prêmio físico mostra um selo claro:
- `DISPONÍVEL — vale até dd/mm`
- `RESERVADO no pedido #1234`
- `ENVIADO em dd/mm` (some da lista de "prêmios a usar")
- `EXPIRADO`
- `CANCELADO — pedido cancelado/estornado`

**Vendedora (card do pedido e "Ver pedido")**
Badge do prêmio com o mesmo estado, para ela nunca prometer duas vezes o mesmo brinde.

**Expedição**
Continua usando o brinde já existente (`🎡 Prêmio roleta: …`), com a tarja de aviso atual. Ao concluir a expedição o prêmio é marcado como ENVIADO automaticamente.

## Cenários de risco cobertos

| Situação | Comportamento |
|---|---|
| Cliente faz 2 pedidos no mesmo dia | O prêmio fica preso no 1º pedido que o reservou; o 2º não recebe nada |
| Pedidos unificados em um só envio | O prêmio segue o pedido que o reservou; a etiqueta de brinde aparece no envio unificado, uma única vez |
| Pedido cancelado/excluído na expedição | Prêmio vai para PERDIDO — não retorna à área de membros |
| Estorno depois do envio | Continua ENVIADO (o produto físico já saiu); não gera novo prêmio |
| Prazo vence enquanto está reservado | Prazo congelado; não expira |
| Cliente ganha 2 prêmios físicos | São independentes: cada um pode ser reservado em pedidos diferentes, um de cada vez |
| Pedido reaberto/refeito após cancelamento | Não recupera o prêmio automaticamente; só via ação manual da equipe |
| Prêmio físico numa cobrança | Nunca abate valor: fica fora de qualquer cálculo de desconto |

## Detalhes técnicos

Banco (`customer_prizes`):
- Nova coluna `fulfillment_status text` com `available | reserved | shipped | forfeited | expired`, default `available`, preenchida por backfill a partir de `is_redeemed`/`applied_order_id`.
- Novas colunas `shipped_at`, `forfeited_at`, `forfeit_reason`, `reserved_at`.
- Índice único parcial: um prêmio só pode ter uma reserva ativa; e um `applied_order_id` só aceita um prêmio físico.
- `is_redeemed` continua existindo para não quebrar nada, mas para prêmio físico passa a ser consequência de `shipped`/`forfeited`, nunca da confirmação de pagamento.

Funções e gatilhos:
- `attach_physical_prize_to_order` e `trg_orders_attach_physical_prize`: passam a filtrar por `fulfillment_status = 'available'` e a gravar `reserved`.
- Novo `mark_physical_prize_shipped(order_id)` chamado quando a expedição vai para **Concluído**.
- Novo `forfeit_physical_prize(order_id, reason)` chamado em `expedition_cancel_sale`, exclusão de pedido e estorno.
- Novo `reopen_physical_prize(prize_id, reason)` restrito à equipe (ação manual de exceção).
- `redeemPrizesOnConfirmation` (webhooks de pagamento) passa a ignorar explicitamente `prize_type = 'product'`.
- `get_customer_active_prizes` retorna o novo status para alimentar as telas.

Front:
- `LiveMemberArea` (lista de prêmios), `OrderCardDb` e `OrderFullViewDialog`: exibem selo por status.
- Painel de prêmios do PDV/Marketing: filtro por status e botão de reabertura manual.

Nada do fluxo de desconto (%, valor fixo, frete grátis) muda — essa parte já está no ar e continua igual.
