
# Plano — Follow-ups configuráveis por evento (Meta Templates)

## Contexto rápido

Hoje quem manda as mensagens "Oi @fulana! Ainda posso te ajudar…" é a função `livete-followup-cron`, que gera texto livre via IA e envia direto. Isso quebra fora da janela de 24h da Meta API e ainda dispara para quem nunca respondeu — foi o que apareceu no print. Vamos **eliminar** esse fluxo e substituir por um motor que só envia **templates Meta aprovados**, com regras definidas por você em cada evento.

---

## Bugs do dashboard — status

- **Scroll do modal "Clientes recorrentes"**: corrigido (ScrollArea agora respeita o limite do dialog).
- **Não-compradores zerados**: corrigido. A RPC `event_buyer_origin_matrix` agora também considera pedidos da tabela `orders` do evento com `is_paid = false` (os "contacted", "incomplete_order" etc.), classificando cada um pelo mesmo motor (Lead → 1ª compra / Cliente antigo / Totalmente novo). Os seus 11 pedidos não pagos passam a aparecer.

---

## Novo motor — visão geral

Cada evento passa a ter uma aba **"Automações de Follow-up"** (dentro de EventDetails), com duas listas dinâmicas:

**A. WhatsApp — Recuperação de carrinho / pedido não pago**  
Você adiciona quantos follow-ups quiser. Cada linha:
- Template Meta (dropdown com os templates aprovados da sua conta WABA).
- Variáveis do template (nome, link do carrinho, valor — mapeadas automaticamente para as colunas do pedido).
- Instância Meta que envia (Pérola / Centro / Site).
- Tempo de espera (ex.: 30 min, 2h, 6h) — contado a partir do envio do template inicial de carrinho.
- Condição de parada: se o cliente respondeu OU pagou OU foi cancelado → não envia.

**B. Instagram — Pedido incompleto (sem WhatsApp)**  
Mesma lista dinâmica. Cada linha:
- Texto da DM (com placeholders `{first_name}`, `{cart_link}`) — IG não usa "templates", é mensagem livre porque o pedido nasceu por DM (janela 24h ainda aberta).
- Botões opcionais (ex.: "Enviar meu WhatsApp").
- Tempo após criação do pedido incompleto.
- Para automaticamente quando o cliente informar WhatsApp.

---

## Regra do gatilho (confirmado por você)

- **Carrinho abandonado / não respondeu template inicial** → conta a partir do envio do template inicial (`orders.checkout_started_at` / `last_sent_message_at`).
- **Respondeu mas não pagou** → conta a partir da última mensagem recebida do cliente (`orders.last_customer_message_at`).
- O motor escolhe automaticamente qual gatilho usar por pedido.

---

## O que vai ser deletado

Confirmado por você: **deletar de vez**, sem manter código legado.

- Edge function `livete-followup-cron` (gerava texto livre via IA).
- Cron job que a invoca.
- Chamadas em `_shared/livete-tools.ts` que criam/desativam `livete_followups`.
- Edge function `automation-pos-followups-cron` (segue o mesmo padrão de texto livre).
- Edge function `chat-payment-followup` (idem).
- Tabela `livete_followups` fica preservada só como histórico legível (renomeada `_legacy_livete_followups`) — evita quebrar auditoria antiga; não recebe mais escrita.

---

## Detalhes técnicos

### 1. Banco

Nova tabela **`event_followup_configs`** (config por evento):
- `event_id`, `channel` (`whatsapp` | `instagram`), `order_index`, `enabled`
- `template_name` (nulo p/ IG), `template_language`, `template_variables` (jsonb com mapeamento)
- `message_text`, `buttons` (jsonb, p/ IG)
- `whatsapp_number_id` (qual instância envia)
- `delay_minutes`, `trigger_source` (`initial_template` | `last_customer_reply` | `incomplete_order_created`)
- `stop_on_reply`, `stop_on_paid`

Nova tabela **`event_followup_dispatches`** (fila/histórico de execução, uma linha por (order × config)):
- `config_id`, `order_id`, `scheduled_at`, `sent_at`, `status` (`pending`/`sent`/`skipped`/`failed`), `skip_reason`, `meta_message_id`

Índices: `(status, scheduled_at)` e `(config_id, order_id)` UNIQUE (garante 1 envio por config × pedido).

### 2. Edge functions

- **`event-followup-scheduler`** (cron 1 min): varre `orders` não pagos dos eventos ativos → cria linhas `pending` em `event_followup_dispatches` conforme configs, respeitando gatilho.
- **`event-followup-dispatcher`** (cron 1 min): pega `pending` com `scheduled_at <= now()`, revalida (não pago, não respondeu depois do gate), envia via `meta-whatsapp-send-template` ou `instagram-dm-send` / `instagram-dm-send-buttons`, grava resultado.
- Ambas respeitam quiet hours (22h–8h BRT) e `blocked_contacts`.

### 3. Front-end

Nova aba **"Follow-ups"** em `EventDetails.tsx`, componente `EventFollowupsManager.tsx`:
- Duas seções (WhatsApp / Instagram) com lista drag-to-reorder.
- Botão "+ Adicionar follow-up".
- Dropdown de templates puxa de `meta-whatsapp-get-templates`.
- Preview do template renderizado com variáveis de exemplo.
- Toggle de ativar/desativar por linha.
- Painel de "Últimos disparos" (últimos 20 registros de `event_followup_dispatches`).

### 4. Migração de dados

- Migração DROP das 3 functions antigas + rename da tabela `livete_followups`.
- Nada é migrado automaticamente para as novas tabelas — você configura os templates evento a evento (é o ponto do plano).

---

## Ordem de execução (após aprovar)

1. Migração: criar tabelas novas, renomear `livete_followups`, dropar cron antigo.
2. Deletar edge functions `livete-followup-cron`, `automation-pos-followups-cron`, `chat-payment-followup` e limpar chamadas em `_shared/livete-tools.ts`.
3. Implementar `event-followup-scheduler` + `event-followup-dispatcher` + crons.
4. Implementar `EventFollowupsManager.tsx` e integrar na aba do evento.
5. Smoke test: criar 1 config no evento LIVE atual, verificar agendamento e disparo em ambiente real.

Aprova? Se quiser mudar algo (adicionar campo, mudar quiet hours, etc.), me diz antes de eu começar.
