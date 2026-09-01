# Central de Atendimento da Live (WhatsApp dentro do Evento)

## Minha sugestão de layout

Não transformar o Kanban inteiro em vertical na tela toda — e sim adotar um **modo "Central da Live"**: 3 colunas em tela cheia, cada uma com rolagem própria. O Kanban vira **vertical/empilhado** só dentro da coluna da direita (etapas viram seções com contador + chips de filtro), o que resolve o espaço sem perder a leitura por etapa.

```text
┌──────────── barra da live: faturado / recebido / produto no ar ────────────┐
│  FILA DA LIVE   │        CHAT DO WHATSAPP          │  PEDIDOS (vertical)   │
│  (conversas)    │  (conversa aberta + composer)    │  chips por etapa      │
│  filtros:       │  ações: Ficha · Pedido ·         │  cards empilhados     │
│  Da live /      │  + Criar pedido na live          ├───────────────────────┤
│  Sem pedido /   │                                  │  COMENTÁRIOS DA LIVE  │
│  Todas          │                                  │  / Chat da equipe     │
└─────────────────┴──────────────────────────────────┴───────────────────────┘
```

Ganhos: atender e criar o pedido sem trocar de aba; a conversa já vem marcada como "veio da live"; comentários do Instagram continuam visíveis.

## O que será construído

1. **Nova aba "Atendimento" (Central da Live)** dentro do evento, em tela cheia (sem o container estreito), ao lado das abas atuais. As abas de hoje (Pedidos, Promoções, Roleta…) continuam intactas.
2. **Coluna 1 — Fila da Live**: lista de conversas de WhatsApp reaproveitando `ConversationList`/hooks do PDV, com filtros próprios: `Da live` (mensagens recebidas desde o início do evento, ou vindas do link redirecionador), `Sem pedido` (telefone sem pedido neste evento), `Todas`. Badges: veio da live, pedido #, pago, instância.
3. **Coluna 2 — Chat**: `ChatView` já existente (mesmo envio, mídia, citação, instância travada por conversa), com botão **"+ Criar pedido na live"** que abre o `OrderDialogDb` já com telefone/nome/evento preenchidos, e atalhos Ficha/Pedido.
4. **Coluna 3 — Pedidos vertical + Comentários**: Kanban empilhado por etapa (chips com contadores filtram a lista), arrastar substituído por menu rápido "mover para etapa"; abaixo, o painel de comentários da live e o chat de equipe em sub-abas.
5. **Vínculo conversa ⇄ pedido**: ao abrir uma conversa, o sistema busca o pedido daquele telefone no evento atual e mostra no cabeçalho; ao criar o pedido pelo chat, o card aparece na coluna 3 sem recarregar a tela.

## Detalhes técnicos

- Nova página/aba usa os hooks já existentes de chat (`useChatMessages`, `useChatSender`, `useConversationInstance`, `chatContactsCache`) — sem duplicar lógica de envio nem quebrar o guard de instância oficial.
- Kanban vertical: novo componente `LiveOrdersColumn` consumindo o mesmo `dbOrderStore` (com `lockedOrderIds` e realtime granular já implementados) — nada de refetch que pisque a tela.
- "Da live" = conversas com última mensagem recebida após `event.started_at`, marcadas por origem do redirecionador quando disponível.
- Layout responsivo: em telas menores que XL as 3 colunas viram abas internas.

## Fora do escopo

Nenhuma mudança em regras de negócio, disparos, templates ou pagamento — apenas UI e vínculo conversa/pedido.
