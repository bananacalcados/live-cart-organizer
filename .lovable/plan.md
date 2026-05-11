# Plano — Live Shopping com captação, indicação e automação

## Escopo desta entrega (Fase 1)

1. Builder visual de **LP do Evento** (sem precisar chamar o agente)
2. Builder de **Typebot conversacional** (fluxo de perguntas) reutilizando o mesmo backend
3. **Sistema de indicação** com link único por lead, contador e prêmio aos 3 cadastros
4. Novo **gatilho de automação**: `Lead capturado em LP/Typebot` que dispara templates de WhatsApp já existentes

Fases futuras (fora do escopo agora): agente de IA do evento (DM 1:1) e gamificação avançada.

---

## 1. Banco de dados

Novas tabelas:

- **`event_landing_pages`**
  - `event_id` (fk), `slug` único, `published`, `theme_json` (cores/fontes), `config_json` (lista de blocos), `hero_image_url`, `og_image_url`
  
- **`event_typebots`**
  - `event_id` (fk), `slug` único, `published`, `flow_json` (perguntas, validações, mensagens), `welcome_message`, `success_message`

- **`event_leads`**
  - `event_id`, `name`, `phone` (E.164), `source` ('lp' | 'typebot' | 'referral'), `referral_token` (único, gerado no insert), `referred_by_lead_id` (fk self), `referred_count` (mantido por trigger), `prize_unlocked_at`, `vip_group_sent_at`, `landing_page_id`, `typebot_id`, `utm_*`

- **Trigger** em `event_leads`: ao inserir com `referred_by_lead_id`, incrementa `referred_count` do indicador. Se chegar a 3 e `prize_unlocked_at` for nulo, marca timestamp e emite evento `referral_milestone_3`.

- **Extensão em `automation_triggers`** (tabela existente): novos tipos de evento `lp_lead_captured`, `typebot_completed`, `referral_milestone_3`.

Storage: bucket público `event-landing-assets` para imagens de fundo/hero.

---

## 2. Builder de LP do Evento

Tela nova em `Eventos > {evento} > Landing Pages`.

**Editor visual** (split view: blocos à esquerda, preview à direita, mobile/desktop toggle):

Blocos arrastáveis disponíveis:
- **Hero com imagem de fundo**: upload + controles de posição (top/center/bottom), modo (cover/contain), overlay escuro 0–100%, **desfoque do fundo** 0–20px, altura
- **Imagem em região específica**: hero/lateral/faixa, com posicionamento livre
- **Countdown regressivo**: input de data/hora final
- **Data do evento** (texto formatado automaticamente)
- **Tema do evento** (título + subtítulo)
- **Regras do evento** (rich text)
- **Botão CTA** → link do grupo VIP
- **Formulário de captura**: nome + WhatsApp (validação E.164 com 9º dígito automático)
- **Texto livre** (rich text)

Configurações da página:
- Slug customizado: `/live/{slug}`
- Cores primárias e fonte
- OG image (preview no WhatsApp)
- Mensagem de sucesso após cadastro + link do grupo VIP exibido
- Toggle "exigir aceite de privacidade"

Rota pública: **`/live/:slug`** (renderiza `config_json` em React).
Rota pública com indicação: **`/live/:slug?ref={referral_token}`**.

---

## 3. Builder de Typebot

Tela em `Eventos > {evento} > Typebots`.

Editor simples de fluxo linear (sem ramificações nessa primeira versão):
- Lista ordenada de passos: pergunta de texto, pergunta de telefone, mensagem informativa, botão final
- Cada passo tem rótulo, placeholder, validação (texto/telefone)
- Mensagem de boas-vindas e mensagem de sucesso com link do grupo VIP

Rota pública: **`/typebot/:slug`** e **`/typebot/:slug?ref={referral_token}`**.

Backend de captura é o mesmo da LP (mesma edge function), só muda a interface.

---

## 4. Edge function `event-lead-capture`

Recebe `{ event_id, source, lp_id|typebot_id, name, phone, ref_token? }`:

1. Normaliza telefone (E.164 + 9º dígito)
2. Resolve `referred_by_lead_id` via `ref_token`
3. Verifica duplicata (mesmo `event_id` + `phone` → retorna lead existente sem criar novo)
4. Insere `event_leads` com `referral_token` único gerado
5. Emite evento `lp_lead_captured` (ou `typebot_completed`) para o motor de automações
6. Retorna `{ referral_token, vip_group_link, share_message }` para a página exibir

Trigger de banco cuida do `referral_milestone_3` quando atinge 3 indicados.

---

## 5. Integração com Automações

No módulo Automações, adicionar **3 novos tipos de gatilho** no selector:

- `Lead capturado em LP do Evento` (filtro: evento, opcional: LP específica)
- `Lead capturado em Typebot` (filtro: evento, opcional: typebot específico)
- `Marco de 3 indicações alcançado` (filtro: evento)

**Variáveis disponíveis** nos templates/mensagens:
- `{{nome}}` — nome do lead
- `{{whatsapp}}` — telefone
- `{{link_grupo_vip}}` — vem do evento
- `{{link_indicacao}}` — URL: `https://checkout.bananacalcados.com.br/live/{slug}?ref={token}`
- `{{data_evento}}`, `{{tema_evento}}`
- `{{nome_indicador}}` (quando aplicável)
- `{{indicados_count}}` (no marco de 3)

As ações de automação (enviar template WhatsApp, delay, tag) já existem e ficam reutilizadas.

---

## 6. Página pública com indicação

Após cadastrar, a LP/Typebot mostra tela de sucesso com:
- Link do grupo VIP (botão)
- **Card "Indique 3 amigos e ganhe {prêmio}"** com:
  - Link único copiável: `/live/{slug}?ref={token}`
  - Botão "Compartilhar no WhatsApp" com mensagem pré-pronta
  - Contador: `Você já indicou X de 3`

---

## 7. Detalhes técnicos

### Estrutura de arquivos novos
- `src/pages/events/EventLandingBuilder.tsx` — editor visual
- `src/pages/events/EventTypebotBuilder.tsx` — editor de fluxo
- `src/pages/public/EventLandingView.tsx` — render público `/live/:slug`
- `src/pages/public/EventTypebotView.tsx` — render público `/typebot/:slug`
- `src/components/events/landing-blocks/*` — um componente por tipo de bloco
- `src/components/events/ReferralCard.tsx` — card de indicação pós-cadastro
- `supabase/functions/event-lead-capture/index.ts`
- `supabase/migrations/*` — tabelas + trigger + extensão dos triggers de automação

### Validação
- Zod schemas para `config_json`, `flow_json` e payload da edge function
- Telefone passa pelo `phoneUtils` já existente (E.164 + 9º dígito BR)

### Segurança
- RLS em `event_landing_pages`, `event_typebots`, `event_leads` (admin/operadores leem e editam; público só pode chamar a edge function para inserir leads, não acessa a tabela direto)
- Rate limit na edge function de captura (por IP)
- `referral_token` gerado com `gen_random_bytes` (alta entropia)

---

## Entregáveis dessa fase

- [ ] Migrations das 3 tabelas + trigger + bucket
- [ ] Edge function `event-lead-capture`
- [ ] Builder visual de LP com todos os blocos listados
- [ ] Builder de Typebot linear
- [ ] Páginas públicas `/live/:slug` e `/typebot/:slug` com suporte a `?ref=`
- [ ] Card de indicação pós-cadastro
- [ ] 3 novos gatilhos no módulo Automações
- [ ] Variáveis novas disponíveis nos templates

## Fora dessa fase (próximos passos)

- Agente de IA do evento em DM 1:1 (identifica lead, responde dúvidas, manda link de indicação sob demanda, consulta status de indicados)
- Gamificação com leaderboard público de indicações
- A/B test de LPs
- Ramificações condicionais no Typebot
