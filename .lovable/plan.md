# Enquetes com resultado auditável + enriquecimento de cadastro

## Diagnóstico (o que já existe hoje)

**Campo de tamanho de calçado — já existe em quase todo lugar:**
- `customers_unified.shoe_size` (text) + `purchased_sizes` (text[])
- `pos_customers.shoe_size`
- `ad_leads.shoe_size` (com índice)
- `lp_leads` **NÃO tem** — precisa adicionar

**Como as enquetes funcionam hoje:**
- Criadas em `group_campaign_scheduled_messages` (`type='poll'`, `poll_options jsonb`, `poll_max_options int`).
- Enviadas via `uazapi-send-extra` (endpoint `/send/menu` type `poll`) para grupos VIP.
- Cada envio gera uma linha em `group_campaign_block_dispatches` com `scheduled_message_id` + `message_id` retornado pela uazapi (é o ID da enquete no WhatsApp).
- Votos chegam no `uazapi-webhook` como `messageType = "pollupdatemessage"`. O código já detecta (`isPoll = true`) e chama `recordGroupActivity` gravando em `whatsapp_group_member_activity` com `activity_type='poll_vote'`, `content = opção votada`, `message_id`, `group_id`, `phone`.

**Gaps identificados:**
1. `whatsapp_group_member_activity` tem 0 linhas — a função `recordGroupActivity` só grava se o telefone existir em `whatsapp_group_members`. Votos de quem ainda não foi sincronizado se perdem.
2. Não há vínculo direto entre o `message_id` do voto e o `scheduled_message_id` da enquete original → hoje é impossível montar "resultado da enquete X".
3. Nada escreve `shoe_size` (ou outro campo) no cadastro do cliente/lead quando ele vota.
4. Não há UI de "Resultado da enquete".

---

## Plano (3 camadas, sem quebrar nada)

### 1. Persistência dos votos (base para tudo)
- Nova tabela `group_poll_votes` (id, scheduled_message_id, group_id, instance_id, phone, phone_suffix8, option_index, option_text, message_id UNIQUE, customer_unified_id nullable, voted_at). GRANTs + RLS (leitura autenticada, escrita service_role).
- Migração: adicionar `poll_message_id text` em `group_campaign_block_dispatches` (já existe `message_id` do envio — reaproveitar) e índice para lookup rápido.
- No `uazapi-webhook`, quando `isPoll`:
  - Continuar gravando em `whatsapp_group_member_activity` (compatibilidade), mas **sem depender** de estar em `whatsapp_group_members`.
  - Extrair a(s) opção(ões) escolhida(s) do payload da uazapi (`message.poll` / `pollupdatemessage`) — hoje só grava `displayMessage`.
  - Localizar o `scheduled_message_id` cruzando o `poll_message_id` do voto com `group_campaign_block_dispatches.message_id` do mesmo grupo/instância.
  - Inserir/upsert em `group_poll_votes` (UNIQUE em `message_id + phone` para permitir troca de voto).
  - Resolver `customer_unified_id` via `phone_suffix8`.

### 2. Enriquecimento automático de cadastro (opcional por enquete)
- Adicionar em `group_campaign_scheduled_messages`:
  - `poll_enrichment_field text` (ex.: `shoe_size`, `preferred_style`, `gender`)
  - `poll_enrichment_map jsonb` (mapa `{ "0": "36", "1": "37", ... }` — traduz índice/label da opção para o valor gravado)
- Na UI do `ScheduledMessageForm` (bloco "Enquete"): novo select "Salvar resposta em…" (nenhum | Tamanho de calçado | Estilo preferido | Gênero | Tag customizada) e, quando habilitado, campo por opção mapeando ao valor final.
- Adicionar coluna `shoe_size text` em `lp_leads` (paridade com `ad_leads`).
- No processamento do voto (item 1), se a enquete tem `poll_enrichment_field` definido:
  - Atualizar `customers_unified.<campo>` (via `phone_suffix8`).
  - Se não houver `customers_unified`, atualizar `lp_leads`/`ad_leads` pelo telefone.
  - Registrar em `source_origins` que o dado veio de "enquete X".
  - Não sobrescrever se já preenchido, a menos que a enquete marque `overwrite=true`.

### 3. UI de resultado (leitura)
- Em `VipGroupsAnalyticsDashboard` (ou nova aba dentro do card da mensagem agendada): "Resultado da enquete" com:
  - Total de votos, votos por opção (%), lista de quem votou (nome + telefone + link p/ ficha), export CSV.
  - Fonte: `group_poll_votes` filtrado por `scheduled_message_id`.

---

## Riscos e mitigação
- **Webhook**: mudança é aditiva (novo insert em nova tabela + upsert). Nada removido. Se falhar, o fluxo atual (`whatsapp_group_member_activity`) continua.
- **Enriquecimento**: opt-in por enquete via novo campo → enquetes existentes não mudam de comportamento.
- **Formato do payload uazapi**: antes de escrever, adicionar log temporário no webhook por 24h para confirmar a estrutura real de `pollupdatemessage` (nome do campo com a opção escolhida) e ajustar o parser.
- **Duplicidade de voto**: UNIQUE(message_id, phone) + upsert respeitando o mais recente.
- **Privacidade**: `group_poll_votes` só acessível a authenticated (padrão dos outros dados de marketing).

## Validação após implementar
1. Criar enquete de teste "Que tamanho você calça?" com opções 34–41 e `poll_enrichment_field=shoe_size`.
2. Disparar em 1 grupo pequeno.
3. Votar de 2–3 telefones.
4. Conferir: linhas em `group_poll_votes`, `customers_unified.shoe_size` preenchido, painel de resultado exibindo contagem correta.

## Escopo fora deste plano (fica para depois)
- Enquetes 1‑a‑1 (fora de grupo).
- Enquetes vindas de outros provedores (Meta Cloud, WaSender) — a estrutura já suporta, mas o parser específico fica para quando for necessário.
