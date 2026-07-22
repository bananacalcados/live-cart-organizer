
# Cross-sell no módulo Eventos + Templates API de carrossel

Objetivo: replicar (e melhorar) o fluxo de carrossel do PDV > Online > Automações dentro do módulo Eventos, e usar esses templates num novo botão de **Cross-sell** dentro do chat de WhatsApp do evento, que também será redesenhado.

---

## Etapa 1 — Aba "Templates API" no módulo Eventos

Local: nova aba na página principal de Eventos (ao lado de Follow-ups, Redirecionador Live, etc.).

Reaproveitar a base já existente:
- `carousel-ladder-create` (edge function) — cria template de carrossel na Meta.
- `templates_carrossel` (tabela) — persistência de degraus.
- `CampaignCardsEditor.tsx` / `CampaignBuilder.tsx` (PDV) — editor de cards com corpo, legenda por card, quantidade de cards, botões (QUICK_REPLY, URL, PHONE_NUMBER), upload de imagem-exemplo.
- `MetaTemplateConfigurator.tsx` (Eventos) — picker de variáveis já usado nos follow-ups.

O que criar de novo em `src/components/events/`:
- `EventCarouselTemplatesTab.tsx` — lista de templates carrossel do evento com status (PENDING/APPROVED/REJECTED, puxado ao vivo via `meta-whatsapp-get-templates` como o `EventFollowupsManager` já faz).
- `EventCarouselTemplateEditor.tsx` — formulário completo:
  - Seletor de **instância WhatsApp (WABA)** — obrigatório antes de qualquer edição.
  - Nome do modelo.
  - Quantidade de cards (2–10).
  - Corpo do topo com variáveis nomeadas (`{{nome}}`, `{{primeiro_nome}}`, `{{tamanho}}`, `{{vendedora}}`, `{{livre_N}}`) + emojis (reutiliza `EmojiPickerButton` + `MetaTemplateConfigurator`).
  - Legenda por card (com variáveis).
  - Botões por card (texto livre + URL / QUICK_REPLY / PHONE_NUMBER).
  - Upload de imagem-exemplo (usada só para aprovação Meta).
  - Preview em tempo real usando `CarouselMessageBubble`.
  - Submissão pela edge `carousel-ladder-create` já pronta.

Ajustes de dados:
- Adicionar coluna `scope text default 'pos'` em `templates_carrossel` (`'pos' | 'event'`) e opcionalmente `event_id uuid null` para permitir agrupamento por evento — sem quebrar o PDV (default mantém escopo atual).
- Aba Templates lista apenas escopo `event`, filtrando por instância selecionada e status ao vivo.

---

## Etapa 2 — Redesign do modal de chat de WhatsApp do Evento

Escopo: componente `WhatsAppChat` + wrapper `WhatsAppChatDialog` (usado por `EventPaymentCardsBar`, `EventCustomerOrdersDialog`, `EventLiveCommentsPanel`).

Mudanças:
1. `WhatsAppChatDialog` (Eventos): alargar/aumentar — de `max-w-md h-[600px]` para algo como `max-w-5xl w-[92vw] h-[88vh]`, mantendo comportamento no PDV via prop `size="wide"` (ou novo `EventWhatsAppChatDialog` para não afetar POS).
2. Nova **barra lateral vertical** dentro de `WhatsAppChat` (renderizada só no modo `event`):
   - Botões grandes, com ícone + label, agrupados: **Pausar IA**, **Ficha do cliente**, **Ver pedido**, **Editar pedido**, **Checkout**, **PIX**, **Follow-ups**, **Cross-sell (novo)**, **Ticket de suporte**, **Excluir conversa**.
   - Isso substitui a barra de ícones no topo (que hoje fica apertada), deixando o header limpo.
3. Manter identidade visual do chat WhatsApp (fundo verde/tinta) e responsivo (colapsa em ícones em telas menores).

---

## Etapa 3 — Botão Cross-sell no chat

Novo componente `EventCrossellDialog.tsx` acionado pelo botão da sidebar. Fluxo:
1. Detecta a instância vinculada à conversa (`useConversationInstance` → `boundNumberId`).
2. Busca em `templates_carrossel` **apenas** os templates com `whatsapp_number_id = boundNumberId` **e** escopo `event` **e** `meta_status='APPROVED'`.
   - Regra reforçada: se a live tem uma instância principal (`events.whatsapp_number_id`), prioriza essa; se o chat estiver em instância diferente, mostra aviso.
3. Usuário escolhe o template → renderiza `MetaTemplateConfigurator` para o corpo do topo e a legenda de cada card (variáveis nomeadas).
4. Para cada card, o usuário faz upload da foto do produto:
   - **Do computador** (input file → `uploadMediaToStorage`, já usado no chat).
   - **Da Shopify** — abrir um `ShopifyProductPicker` (novo, reaproveitando padrão de `POSTinyProductPicker`/inventário Shopify): busca produtos, mostra thumbs, ao selecionar copia a URL do primeiro asset. Cada card exibe preview 1:1.
5. Botão "Enviar cross-sell":
   - Chama `meta-whatsapp-send-template` (edge existente para templates Meta) montando `components` com HEADER IMAGE de cada card (link direto) + BODY com variáveis + botões conforme aprovado.
   - Grava a mensagem em `whatsapp_messages` com `template_type='carousel'` para o `CarouselMessageBubble` renderizar no histórico.
   - Respeita `boundNumberId` (guarda anti-cross-instance já existente).

---

## Etapa 4 — Detalhes que sugiro incluir para não passar em branco

- **Segmentação de destinatários** no cross-sell: além de disparo unitário no chat, permitir "disparar para todos os clientes PAGOS deste evento" (filtro `pos_sales.status in ('paid','completed','pending_pickup')` cruzado com `event_id`), reutilizando o `enqueue_dispatch_recipients_guarded` para respeitar quotas anti-ban e Ravena bypass.
- **Rate limit + quiet hours**: obedecer regras já ativas (`Livete Quiet Hours` 22h–08h) e o motor anti-ban dos disparos.
- **Métricas do cross-sell**: nova coluna `crossell_id` (opcional) em `dispatch_history` ou tabela dedicada `event_crossell_dispatches` — para medir cliques (via `link_pages_v2` shortlinks nos botões URL), pedidos gerados e faturamento atribuído, integrando com `event_buyer_origin_matrix`.
- **Prévia real do card antes de enviar** (reusar `CarouselMessageBubble`) e validador que impede envio se algum card ficar sem imagem.
- **Rotação de vendedora (`{{vendedora}}`)** já existente no PDV — replicar para não perder personalização.
- **Auditoria**: log em `ai_conversation_logs` de cada envio (quem, template, instância, cliente) para investigação posterior.
- **Reuso no PDV**: como o editor será igual, deixar `EventCarouselTemplateEditor` genérico com prop `scope`, para futuramente unificar com o do PDV sem duplicar código.
- **Fallback quando template ainda não foi aprovado**: badge PENDING claro na lista, bloqueando uso no cross-sell.

---

## Detalhes técnicos (dev)

Arquivos novos:
- `src/components/events/EventCarouselTemplatesTab.tsx`
- `src/components/events/EventCarouselTemplateEditor.tsx`
- `src/components/events/EventCrossellDialog.tsx`
- `src/components/events/EventWhatsAppSidebar.tsx`
- `src/components/events/ShopifyProductPicker.tsx`
- (opcional) `src/components/events/EventWhatsAppChatDialog.tsx` (wrapper wide-mode)

Arquivos alterados:
- `src/components/WhatsAppChat.tsx` — aceitar prop `variant="event"` para renderizar sidebar + slots de ações extras.
- `src/components/events/EventInnerDashboard.tsx` — nova aba "Templates API".
- `EventPaymentCardsBar.tsx`, `EventCustomerOrdersDialog.tsx`, `EventLiveCommentsPanel.tsx` — trocar para o dialog wide + `variant="event"`.

Backend:
- Migration: `ALTER TABLE templates_carrossel ADD COLUMN scope text NOT NULL DEFAULT 'pos'`, `ADD COLUMN event_id uuid NULL REFERENCES events(id)`, índice `(scope, whatsapp_number_id)`.
- Edge `carousel-ladder-create`: aceitar `scope` e `event_id` opcionais e persistir.
- (Opcional Etapa 4) Nova edge `event-crossell-send` para orquestrar envio em massa com quotas + registrar métricas.

Nenhuma quebra no PDV: escopo default preserva comportamento existente; o dialog atual do WhatsApp continua funcionando por prop opcional.
