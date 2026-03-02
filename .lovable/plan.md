
## Sistema Completo de Gerenciamento de Grupos VIP (estilo SendFlow)

### Visao Geral

Reconstruir o modulo de Grupos VIP para ter funcionalidades equivalentes ao SendFlow, com foco em: campanhas persistentes com multiplas mensagens agendadas, gerenciamento completo de configuracoes dos grupos, sistema de links inteligentes (deep link + redirect quando grupo cheio), e controle de velocidade de envio.

---

### 1. Migracao de Banco de Dados

**Novas tabelas:**

- `group_campaign_scheduled_messages` - Mensagens programadas dentro de uma campanha (cada campanha pode ter N mensagens agendadas em datas/horarios diferentes)
  - `id`, `campaign_id` (FK), `message_type` (text/image/video/audio/document/poll), `message_content`, `media_url`, `poll_options` (jsonb), `scheduled_at` (timestamptz), `status` (pending/sent/failed/cancelled), `sent_at`, `send_speed` (slow/normal/fast), `created_at`

- `group_redirect_links` - Links inteligentes de campanha que redirecionam para grupo com vagas
  - `id`, `campaign_id` (FK), `slug` (unique), `is_deep_link` (boolean), `click_count`, `redirect_count`, `is_active`, `created_at`

**Alteracoes em tabelas existentes:**

- `whatsapp_groups`: adicionar `max_participants` (int, default 1000), `is_full` (boolean, default false), `invite_link` (text), `only_admins_send` (boolean), `only_admins_add` (boolean)
- `group_campaigns`: adicionar `send_speed` (text, default 'normal'), `campaign_link_slug` (text), `is_deep_link` (boolean, default false)

---

### 2. Edge Function - Agendador de Mensagens (`zapi-group-scheduled-send`)

Nova edge function que:
- Recebe `scheduledMessageId`
- Busca a mensagem agendada e seus grupos-alvo (da campanha pai)
- Envia para cada grupo respeitando a velocidade configurada (slow=8-15s, normal=3-8s, fast=1-3s)
- Atualiza status de cada envio

---

### 3. Edge Function - Configuracoes Avancadas de Grupo (`zapi-group-settings` - expandir)

Adicionar acoes ao edge function existente:
- `set-messages-admins-only` - Somente admins enviam mensagens
- `set-add-admins-only` - Somente admins adicionam participantes
- `add-participant` - Adicionar participante por telefone
- `remove-participant` - Remover participante
- `promote-admin` / `demote-admin` - Promover/rebaixar admin

---

### 4. Edge Function - Redirect Link (`group-redirect-link`)

Nova edge function (ou rota no frontend) que:
- Recebe o slug do link
- Busca a campanha e seus grupos
- Encontra o primeiro grupo nao-cheio
- Redireciona para o `invite_link` desse grupo
- Se `is_deep_link`, gera URL no formato `whatsapp://invite/...` ou `intent://` para Android

---

### 5. Frontend - Refatoracao Completa do `GroupsVipManager.tsx`

Reorganizar em 3 abas principais:

**Aba "Grupos":**
- Lista de grupos com busca, filtros (Todos / VIP / Cheios / Nao Cheios)
- Selecao multipla com acoes em massa: Marcar VIP, Marcar Cheio/Nao Cheio, Excluir
- Card expandivel do grupo com:
  - Botao alterar foto, descricao, nome (usa `zapi-group-settings`)
  - Toggle "Somente admins enviam" e "Somente admins adicionam"
  - Lista de participantes com opcao de add/remover/promover admin
  - Campo para definir max_participants e invite_link
- Contagem de participantes e indicador visual de grupo cheio

**Aba "Campanhas":**
- Lista de campanhas existentes com status (rascunho, ativa, concluida)
- Ao clicar numa campanha, abre painel de detalhes com:
  - Grupos vinculados (poder adicionar/remover)
  - Timeline de mensagens agendadas (lista cronologica)
  - Botao "Adicionar Mensagem" com formulario:
    - Tipo (texto, imagem, video, audio, documento, enquete)
    - Conteudo / URL de midia / opcoes de enquete
    - Data e horario de envio (DateTimePicker)
    - Geracao por IA
    - Velocidade de envio (lento/normal/rapido)
  - Status de cada mensagem (pendente/enviada/falha) com hora de envio
  - Botao "Enviar Agora" para disparo imediato de uma mensagem
- Criacao de nova campanha: nome + selecionar grupos

**Aba "Links":**
- Criar link de campanha (slug personalizado)
- Toggle deep link
- Estatisticas: cliques totais, redirecionamentos
- Copiar link
- Preview do link gerado

---

### 6. Componentes Auxiliares

- `GroupSettingsPanel.tsx` - Painel lateral/dialog para configuracoes do grupo (foto, descricao, permissoes, participantes)
- `CampaignDetailPanel.tsx` - Painel de detalhes da campanha com timeline de mensagens
- `ScheduledMessageForm.tsx` - Formulario de criacao de mensagem agendada com DateTimePicker

---

### 7. Execucao Automatica de Agendamentos

Como nao temos cron jobs nativos, a execucao de mensagens agendadas pode funcionar de 2 formas:
- **Client-side polling**: Quando o usuario esta na aba de campanhas, um `setInterval` verifica a cada 60s se ha mensagens com `scheduled_at <= now()` e status `pending`, e dispara a edge function
- **Manual**: Botao "Enviar Agora" para disparo imediato

---

### Resumo de Arquivos

| Arquivo | Acao |
|---|---|
| Migracao SQL | Criar `group_campaign_scheduled_messages`, `group_redirect_links`; alterar `whatsapp_groups` e `group_campaigns` |
| `supabase/functions/zapi-group-settings/index.ts` | Expandir com acoes de permissao e participantes |
| `supabase/functions/zapi-group-scheduled-send/index.ts` | Nova - envio de mensagem agendada |
| `supabase/functions/group-redirect-link/index.ts` | Nova - redirect inteligente |
| `src/components/marketing/GroupsVipManager.tsx` | Refatorar completo com 3 abas e novos paineis |
| `src/components/marketing/GroupSettingsPanel.tsx` | Novo - configuracoes do grupo |
| `src/components/marketing/CampaignDetailPanel.tsx` | Novo - detalhes da campanha com mensagens |
| `src/components/marketing/ScheduledMessageForm.tsx` | Novo - formulario de mensagem agendada |

### Detalhes Tecnicos

- Velocidade de envio: `slow` = delay 8-15s entre grupos, `normal` = 3-8s, `fast` = 1-3s (randomizado)
- Deep link: formato `https://api.whatsapp.com/send?phone=&text=` para links diretos ou `intent://invite/CODE#Intent;scheme=whatsapp;package=com.whatsapp;end` para Android
- Enquetes usam endpoint Z-API `send-poll` com opcoes
- O polling client-side de agendamentos roda apenas quando a pagina esta aberta (similar ao disparador de massa existente)
- Links de redirect usam uma edge function publica (sem JWT) para permitir acesso externo
