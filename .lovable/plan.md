# Linha "PEDIDOS" na Live (comentários com QUERO)

## O que a equipe vai ver
- Uma linha nova **PEDIDOS**, a primeira da tela da Live, acima de "Novos contatos".
- Cada pessoa que comentar **QUERO** (maiúscula ou minúscula, em qualquer parte do comentário) ganha **um card** nessa linha. Várias mensagens da mesma pessoa continuam num card só, que mostra quantos QUERO ela mandou e o último comentário.
- O card aparece sozinho, na hora, sem precisar recarregar a tela.

## Ao clicar no card
- Abre o **modal do Instagram** com **todos os comentários dessa pessoa na live daquele dia**, com os que têm QUERO destacados (igual ao destaque que já existe).
- No modal fica o botão **Montar pedido**. Ele funciona igual ao do WhatsApp: abre a lateral de edição do pedido já preenchida com o @ da cliente.
- Quando o pedido é montado, o card sai da linha PEDIDOS e segue o fluxo normal dos pedidos.

## Excluir card falso
- Cada card tem um botão **Excluir** (com confirmação).
- O card excluído some da linha, mas nada é apagado: os comentários continuam guardados.
- **Se a pessoa comentar QUERO de novo** depois da exclusão, o card volta com **todos** os comentários que ela fez na live naquele dia, inclusive os anteriores à exclusão.
- Comentários sem QUERO feitos depois da exclusão **não** trazem o card de volta.

## Detalhes técnicos
- Fonte: `live_comments` (event_id, username, comment_text, created_at), com a mesma detecção `/quero/i` usada no destaque atual.
- Nova tabela `live_order_intent_dismissals` (event_id, username, dismissed_at, dismissed_by), com GRANT + RLS para usuários autenticados. Um card é visível quando existe um comentário QUERO com `created_at > dismissed_at`, ou quando não existe exclusão.
- Um card sai da linha quando já existe um pedido do evento cujo cliente tem aquele `instagram_handle`.
- Novo componente `LiveOrderIntentLane` como primeira `LiveLaneSection` no `EventPaymentCardsBar`, com Realtime em `live_comments` filtrado por event_id.
- O modal reaproveita a lista de comentários (`LiveCommentsHistory`/`LiveInstagramComments`) filtrada por username e a mesma lateral de montar/editar pedido do modal do WhatsApp, pré-preenchida com o @.
- Nada muda nas outras linhas, nas automações do IG nem no chat.
