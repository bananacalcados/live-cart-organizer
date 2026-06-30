# Captação de leads pela Live do Instagram (overnight)

## Resumo da viabilidade

As duas ideias são viáveis **e quase tudo já existe no sistema**. Não precisamos construir do zero — só ligar peças e adicionar a detecção de telefone.

O que já temos hoje funcionando:
- O webhook do Instagram (`meta-messenger-webhook`) **já recebe comentários da live** (campo `live_comments` da Meta) com o `@` (username), o texto e o `id` do remetente, e já salva em `live_comments` + `whatsapp_messages`.
- O motor de automação de comentários (`instagram_comment_rules` + `processCommentAutomation`) **já dispara**: resposta no comentário, **DM no Direct com botões** (incluindo botão que leva a um link, via `igbtn:`) e disparo de fluxo de automação, com **cooldown por usuário** (anti-spam/anti-ban).
- A captação de leads de evento (`event-lead-capture` → tabela `event_leads`) já salva nome, telefone, origem, vincula a um `event_id` e tem **dedup por evento+telefone** e token de indicação.
- O dashboard **Marketing > Leads** já quebra leads por canal de captação.

Ou seja:

**Opção A (digitar "LIVE")** → praticamente pronta. É só criar uma regra de comentário com a palavra-chave e um botão de DM apontando para o link do grupo VIP. Zero código novo.

**Opção B (digitar o WhatsApp no comentário)** → viável e com menos atrito, como você intuiu. Exige uma peça nova: **detecção e validação do telefone dentro do texto livre do comentário**. É aí que mora o risco, e é o que o plano blinda abaixo.

**Recomendação:** implementar as duas e deixar a Opção B como principal (menor atrito) e a "LIVE" como rede de segurança para quem não quiser digitar o número. Ambas terminam no mesmo lugar: lead salvo no evento futuro + DM convidando ao grupo VIP.

---

## Como garantir que o número está certo (o ponto crítico da Opção B)

O sistema não pode "achar" que qualquer número é telefone. Camadas de garantia:

1. **Extração estrita por regex de telefone BR**: procura sequências de 10–11 dígitos (aceitando `()`, `-`, espaço, `+55`). Ignora 2 dígitos soltos (tamanho de calçado) e textos sem dígitos suficientes.
2. **Validação de DDD**: confere o DDD contra a lista oficial de DDDs válidos do Brasil. DDD inválido → descarta.
3. **Validação de celular**: exige 11 dígitos com o 9º dígito (injeção automática quando vier com 10), reaproveitando `normalizeBRPhone`/`normalizePhoneBR` que já usamos no resto do sistema (padrão E.164).
4. **Desambiguação**: se o comentário tiver vários números, pega o primeiro válido; se nenhum for válido, **não salva** e cai no fluxo de fallback (DM pedindo para reenviar, ou orienta a digitar "LIVE").
5. **Double opt-in leve via Direct**: ao salvar, o DM de confirmação mostra os últimos 4 dígitos ("Recebi seu número ...**3210** ✅") junto do botão do grupo VIP. Se estiver errado, a própria pessoa corrige — e guardamos o comentário cru em `metadata` para auditoria.
6. **Dedup**: `event_leads` já tem unique por `event_id + phone`; adicionamos também dedup por `@` para não recapturar a mesma pessoa, e o cooldown por usuário do motor de comentários evita DM duplicado em re-entregas do webhook.

Sempre salvamos **`@` do Instagram + telefone** (e `comment_id` + texto original em `metadata`).

---

## Como vincular ao evento futuro (sem criar nada do zero)

A live de hoje é só a **superfície de captação**; o destino é um **evento futuro** já criado no módulo Eventos (a tabela `events` já tem `start_date`/`end_date` e o wizard de setup).

Hoje o webhook escolhe "o evento ativo" por `live_active_until`. Para captação overnight, criamos um vínculo explícito: a regra de captação aponta para `capture_event_id` (o evento futuro), de modo que os leads não vão para o evento errado.

---

## Plano de implementação

### 1. Detecção de telefone (novo, pequeno)
- `supabase/functions/_shared/br-phone-extract.ts`: função `extractBRPhone(text)` que faz extração + validação de DDD + 9º dígito, retornando `{ phone E.164, last4 }` ou `null`. Reutiliza a lógica de `src/lib/phoneUtils.ts`.

### 2. Estender as regras de comentário (reuso de `instagram_comment_rules`)
Migration adicionando colunas:
- `action_capture_lead boolean default false`
- `capture_event_id uuid` (evento futuro destino)
- `capture_mode text` — `'phone'` (extrai do texto) ou `'keyword'` (palavra "LIVE", sem telefone).
- (manter GRANTs do padrão do projeto)

### 3. Lógica de captura no motor (`_shared/instagram-comment-automation.ts`)
Dentro de `processCommentAutomation`, quando a regra tiver `action_capture_lead`:
- modo `phone`: roda `extractBRPhone(text)`; se válido, chama `event-lead-capture` com `source: 'live_comment'`, `event_id: capture_event_id`, `name: '@username'`, `phone`, `metadata: { instagram, comment_id, raw_text }`; se inválido, fluxo de fallback (DM pedindo o número/“LIVE”).
- modo `keyword`: dispara só o DM (Opção A), sem telefone.
- Reaproveita o **cooldown por usuário** e o **envio de DM com botão VIP** que já existem.

### 4. `event-lead-capture` aceitar a nova origem
- Aceitar `source: 'live_comment'` e `instagram` em `metadata`; manter dedup `event_id+phone`. Marcar `vip_group_sent_at` quando o DM de convite for enviado.

### 5. UI no Marketing (reuso de `InstagramCommentAutomation.tsx`)
- Na regra de comentário, novo bloco "Captar lead para evento": toggle, seletor de **evento futuro**, escolha do modo (telefone / palavra-chave), texto do DM e botão do grupo VIP.
- Em **Marketing > Leads** (`LeadsAnalyticsDashboard` / `marketing-leads-dashboard`): incluir `live_comment` como canal na quebra por origem.

### 6. Operação da noite
- Criar o evento futuro no módulo Eventos.
- Criar a regra de comentário apontando para esse evento (modo telefone + fallback "LIVE").
- Rodar o vídeo no OBS; os comentários entram pelo webhook e viram leads automaticamente, com convite VIP no Direct.

---

## Decisões em aberto (confirmar antes de executar)
1. Quando o número vier inválido/ausente: **só ignorar** ou **responder no DM** pedindo para reenviar/digitar "LIVE"?
2. O botão do grupo VIP no DM: link fixo do convite ou o redirecionador `/vip/{slug}` que já resolvemos hoje (recomendado, permite trocar o grupo sem reconfigurar)?
3. Quer **confirmação double opt-in** (mostrar os últimos 4 dígitos) ou convite direto sem confirmação?

Confirme esses 3 pontos (ou diga "pode seguir com os padrões recomendados") que eu executo.