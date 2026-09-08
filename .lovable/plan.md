# Pedido pronto vai direto pro pagamento + prioridade SEDEX e Valadares na Expedição

## 1. Área de Membros: pular confirmações quando o pedido já está completo

Hoje a cliente sempre passa por duas telas antes de pagar: "CONFIRMAR MEU PEDIDO" e depois o passo a passo de dados (nome, endereço, envio, CPF, e-mail). Isso acontece mesmo quando a equipe já preencheu tudo no modal do pedido na Live.

O que muda:

- Quando o pedido já tem nome completo, CPF, e-mail, endereço completo (CEP, rua, número, cidade) e forma de envio definida (frete grátis, valor de frete ou retirada já marcados pela equipe), a área de membros considera o pedido "pronto".
- Pedido pronto: a cliente entra e já cai direto no bloco de pagamento (cartão, PIX e débito visíveis de cara). Sem tela de confirmar o pedido, sem passo a passo de endereço e sem o botão "COMPLETAR MEUS DADOS".
- O pedido é marcado como confirmado automaticamente nesse caso, para não ficar pendente no Kanban.
- Se faltar qualquer um desses dados, o fluxo atual continua igual ao de hoje.
- O bloco "Meus dados" continua existindo mais abaixo da tela (com o código por WhatsApp para ver/editar), mas nunca bloqueia o pagamento.

## 2. Pedidos da Live: botão SEDEX

- No card do pedido da Live (e no modal do pedido) entra um botão para marcar/desmarcar **SEDEX**.
- Pedido marcado mostra a etiqueta laranja **SEDEX** no card, no modal e na lista.
- A marcação viaja com o pedido: quando ele chega na Expedição, já chega marcado.

## 3. Expedição: prioridade SEDEX e Valadares

- Cada pedido na Expedição ganha etiquetas automáticas:
  - **SEDEX** — quando marcado na Live (ou marcado manualmente na própria Expedição).
  - **VALADARES, MG** — quando a cidade de entrega é Governador Valadares/MG (comparação sem acento e sem diferença de maiúsculas).
- A lista da Expedição passa a ordenar por prioridade: primeiro SEDEX, depois Valadares, depois o restante por data (como hoje).
- Um contador no topo mostra quantos pedidos prioritários existem, para a equipe embalar primeiro.

## Detalhes técnicos

- Banco: `orders.is_sedex boolean not null default false`; `expedition_orders.priority_sedex boolean not null default false` (+ índice parcial). Sem alteração de RLS existente.
- Propagação: ao sincronizar/rotear um pedido para a Expedição, casar pelo telefone (DDD + 8 últimos dígitos) e nome com o pedido da Live marcado como SEDEX e gravar `priority_sedex`.
- Valadares é derivado em tempo de leitura de `expedition_orders.shipping_address.city/province` — sem coluna nova.
- Ordenação em `src/pages/Expedition.tsx` após o fetch (prioridade calculada no cliente, mantendo os filtros de data atuais).
- Área de Membros: em `supabase/functions/live-member-area/index.ts` o bootstrap passa a devolver `order_ready` (dados completos + envio definido) e faz o auto-confirm; em `src/pages/LiveMemberArea.tsx` a função `routeFor` devolve `area` e o bloco de pagamento é renderizado direto quando `order_ready`.
- Etiquetas reutilizam `Badge` do design system; nada de cor fixa fora dos tokens.
