# Melhorias no Módulo de Eventos

## 1. "Nova Live" passa a usar o novo Wizard (com etapa de identificação)

Hoje "Nova Live" abre um modal antigo (nome, data, canal, frete, automações) e o Wizard novo só abre no "Abrir Evento". Vamos unificar tudo no Wizard.

- Adicionar uma **nova primeira etapa "Identificação"** no `EventSetupWizard.tsx`:
  - Nome do evento
  - Data de início e fim (opcional)
  - Canal de venda: **Shopify (site)** ou **Loja Física** (Pérola / Centro)
- Botão **"Nova Live"** no `Events.tsx`: cria um evento rascunho (nome temporário) e abre o Wizard direto na etapa Identificação — substituindo o modal antigo. O modal antigo de criação é removido.
- O Wizard valida que nome e canal estão preenchidos antes de avançar da etapa 1.
- Ordem final das etapas: **Identificação → Frete → Mensagem → Parcelamento → Crossell → Ativar Live**.

## 2. Corrigir botão "Pular e abrir"

Atualmente o `onClick` chama `onCompleted`, mas em eventos recém-criados sem `name`/canal o fluxo pode falhar silenciosamente. Vamos:
- Garantir que "Pular e abrir" **sempre** feche o modal e entre no evento (`setCurrentEvent` + navegar para o evento), sem depender de validação das etapas seguintes.
- Tratar o caso do evento rascunho: se o nome ainda não foi salvo, exigir preenchimento da etapa 1 antes de permitir pular.

## 3. Botão para reabrir a configuração dentro do evento

- No cabeçalho da tela do evento (`src/pages/Index.tsx`), adicionar um botão **"Configurar Live"** que reabre o `EventSetupWizard` para o evento atual.

## 4. Dashboard dentro do evento

Novo componente `EventInnerDashboard` exibido no topo da tela do evento (`Index.tsx`), com os indicadores:

- **Ticket médio** do evento (faturamento ÷ pedidos pagos).
- **Itens adicionados via Crossell** (do link de checkout) — contagem de `order_crossell_items` do evento.
- **Itens de Crossell que converteram** — itens de crossell cujo pedido está pago.
- **Leads captados** pelo Typebot ou LP do evento (`event_leads` por `event_id`, separando por `source`).
- **Leads que converteram em venda** — leads cujo telefone (DDD + 9 dígitos) bate com o WhatsApp de um pedido **pago** do evento.
- **Taxa de conversão** = leads que converteram ÷ total de leads captados (%).

Para performance, esses números virão de uma **RPC** dedicada (`event_inner_dashboard`).

## 5. Tags no painel lateral de comentários da Live

No `EventLiveCommentsPanel.tsx`, ao lado do @ de cada comentário:

- **TAG "Lead"** (verde) se o @ foi captado pelo Typebot/LP **deste** evento (match por DDD + 9 dígitos com o WhatsApp do cadastro do pedido / cliente).
- **TAG "Lead de outra campanha"** se o telefone existir como lead em **outro** evento/origem de marketing (`event_leads` de outros eventos).
- **Badge de classificação do Participante Score** (ver item 6), indicando o nível de engajamento daquele @.

## 6. Nova aba "Participante Score" (módulo Eventos)

Nova aba no `Events.tsx` com ranking inteligente de **todos os @ que já comentaram em qualquer Live**.

Métricas agregadas por @:
- Nº de Lives em que participou (comentou)
- Nº de comentários em lives
- Nº de compras pagas em lives
- Ticket médio de compra nas lives
- Nº de pedidos avançados (pagos/expedidos) e cancelados
- Data da última participação + datas de todas as lives em que participou

Sistema de pontos (proposta inicial — ajustável depois):
- Participar de uma live: **+5** por live
- Comentário em live: **+1** por comentário (limite p/ não inflar)
- Compra paga em live: **+30** por pedido pago
- Valor gasto: **+1** a cada R$ 50 gastos
- Pedido cancelado: **-10** por cancelamento

Categorias de ranking por faixa de pontos:
- 🏆 **VIP** (top)
- 🔥 **Engajado**
- 👍 **Ativo**
- 🌱 **Novo / Frio**

A classificação calculada aqui alimenta o badge do item 5 no painel lateral.

Tudo agregado via **RPC** (`participant_score_ranking`) para não sobrecarregar o front.

---

## Detalhes técnicos

**Correlação de telefone (DDD + 9 dígitos):** normalizar removendo não-dígitos, tirar DDI (55), e comparar os últimos 11 dígitos (DDD + 9). Onde houver 8 dígitos legados, usar fallback por DDD + 8 (padrão já usado no projeto).

**RPCs novas (migrations):**
- `event_inner_dashboard(p_event_id uuid)` → ticket médio, crossell add/convert, leads por fonte, leads convertidos, taxa de conversão.
- `participant_score_ranking()` → ranking agregado de participantes de lives (varre `live_comments` + comentários de live em `whatsapp_messages` + `orders`), com pontos, categoria, datas de participação.
- `event_lead_handles(p_event_id uuid)` (ou incluir no dashboard) → conjunto de telefones de leads para casar com @ no painel.

**Fontes de dados:**
- Comentários de live: `live_comments` + `whatsapp_messages` (channel instagram, prefixo "💬 Comentário no Live:").
- Crossell: `order_crossell_items` (tem `event_id` e `order_id`).
- Leads: `event_leads` (`source` lp/typebot/referral/manual, `phone_suffix` já calculado).
- Pedidos: `orders` (stage/is_paid/paid_externally).

**Arquivos afetados:**
- `src/components/events/EventSetupWizard.tsx` (nova etapa, fix pular, validação)
- `src/pages/Events.tsx` (botão Nova Live → wizard, remoção do modal antigo, nova aba Participante Score)
- `src/pages/Index.tsx` (botão Configurar Live + dashboard interno)
- `src/components/events/EventLiveCommentsPanel.tsx` (tags Lead / outra campanha / score)
- Novos: `EventInnerDashboard.tsx`, `ParticipantScorePanel.tsx`
- Migrations com as RPCs acima.

## Sugestão de execução em fases
Para testar com segurança, sugiro implementar e validar em blocos:
1. **Fase A** — Wizard unificado + fix "Pular e abrir" + botão Configurar Live.
2. **Fase B** — Dashboard interno do evento (RPC + UI).
3. **Fase C** — Tags no painel lateral (Lead / outra campanha).
4. **Fase D** — Aba Participante Score + badge de score no painel.

Posso seguir por essas fases ou implementar tudo de uma vez — como preferir.