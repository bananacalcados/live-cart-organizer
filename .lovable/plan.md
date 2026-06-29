# Correção das abas de pagamento (PIX/Checkout) no chat do WhatsApp

## Antes de tudo: o histórico NÃO está sendo apagado

Confirmei direto no banco. Para a Karol (R$110, 08/06) e a Maria Foss (R$139,98, 22/06) as mensagens continuam todas lá — só estão distribuídas entre instâncias diferentes:

```text
Karol 5533991221163  → 94 msgs (Whats Centro uazapi) + 22 (Whats Pérola) + 2 (Meta Centro) + 1 (Meta Pérola)
Maria Foss 5547...   → 25 msgs (Meta Centro) + 1 (Meta Pérola)
```

A conversa abre VAZIA porque o card abre sem dizer em qual instância está o histórico (abre como `telefone__none`), e aí o sistema não encontra as mensagens daquela instância. Paginação e arquivamento que criamos não apagam nada — está tudo intacto.

## O que está errado hoje (causas-raiz)

A tabela que alimenta as abas (`chat_awaiting_payment`) só guarda `phone`, `sale_id`, `type`, `created_at`. Ela **não guarda a loja nem a instância**. Por isso:

1. **Aparece nas 3 lojas ao mesmo tempo** → o store de notificações lê a tabela inteira, sem filtrar por loja. Verifiquei: quase todos os cards são da Loja Centro, mas aparecem na Pérola.
2. **Abre conversa vazia** → o clique manda `instância = null`, então não casa com a conversa real (que está em "Whats Centro", "Meta Centro" etc.).
3. **Não abre na instância do pedido** → mesma causa do item 2.
4. **Pode puxar pedido de fora do chat** → hoje entram também linhas `type='ads_checkout'` (sem `sale_id`) e linhas órfãs (sale_id sem venda). Pedidos de Live ainda nem entram nas abas (Live usa outro mecanismo).

## Plano de correção (sem quebrar nada)

### 1. Guardar loja + instância em cada pagamento aguardando
- Adicionar 2 colunas em `chat_awaiting_payment`: `store_id` e `whatsapp_number_id` (ambas opcionais, nullable — nada existente quebra).
- Os 2 botões do chat (`POSWhatsAppPixDialog` e `POSWhatsAppCheckoutDialog`) passam a gravar a loja atual e a instância da conversa aberta junto com o registro.
- **Backfill** dos registros antigos via migração: preencher `store_id` a partir de `pos_sales.store_id` e `whatsapp_number_id` a partir da instância da última mensagem real daquele telefone. Para Live, a loja vem do evento (`events.default_store_id`).

### 2. Escopo por loja (cada pedido só na loja certa)
- O store de notificações passa a receber o `storeId` do módulo de WhatsApp aberto e **só mostra abas cuja `store_id` = loja atual**.
- Pedido criado no chat da Loja Centro → aparece **só** na Loja Centro. Pérola/Site não veem mais.
- Pedido de Live → vinculado à loja do evento (a loja que você selecionou ao criar o evento), aparecendo só no chat daquela loja.

### 3. Abrir na instância correta
- O clique no card passa a abrir a conversa com a instância gravada (`whatsapp_number_id`), e não mais `null`. Assim o histórico aparece na hora, sem precisar trocar de instância na mão.

### 4. Só pedidos vindos do chat (PIX/Checkout) ou de Live
- Filtrar para incluir **apenas** vendas cujo pagamento foi gerado pelos botões do próprio chat (PIX/Checkout) ou por Live Shopping.
- Excluir: `type='ads_checkout'`, linhas sem `sale_id` e linhas órfãs (sale_id sem venda real).
- Pedidos feitos fora do WhatsApp não aparecem.

### 5. Tag de Live
- Quando o pedido for de Live (`sale_type='live'`), o card mostra uma **tag "LIVE"** para diferenciar dos pedidos normais do chat.

### 6. Limpeza de descartados antigos
- O "X" já é permanente (salvo no navegador). Manter como está; só revalidar que segue funcionando após o escopo por loja.

## Detalhes técnicos

- **Migração** (aditiva, sem perda): `ALTER TABLE chat_awaiting_payment ADD COLUMN store_id uuid, ADD COLUMN whatsapp_number_id uuid;` + UPDATE de backfill cruzando `pos_sales` (store_id, sale_type, event_id) e a instância da última `whatsapp_messages` por telefone. Mantém a UNIQUE(phone) atual.
- **`pixNotificationStore.ts`**: `init(storeId)` agora recebe a loja; `refresh()` faz join com `pos_sales` (store_id, sale_type, event_id, status) e filtra por loja + origem (chat/live). `PixTab` ganha `numberId` real e `isLive`.
- **`PixPendingTabsBar.tsx` / `PixPaidGlobalAlert.tsx`**: render da tag "LIVE"; `init` recebe `storeId` (vindo do `POSWhatsApp`, que já tem `storeId`).
- **`POSWhatsAppPixDialog.tsx` / `POSWhatsAppCheckoutDialog.tsx`**: incluir `store_id` e `whatsapp_number_id` no upsert.
- **`POSWhatsApp.tsx`**: clique já chama `handleSelectConversation(phone, numberId)` — passará o `numberId` real, resolvendo a conversa vazia.
- Tudo é incremental: colunas nullable, filtros adicionais e backfill. Nenhuma alteração destrutiva em dados ou fluxos existentes.

Quer que eu implemente nessa ordem (migração + backfill primeiro, depois store/UI)?