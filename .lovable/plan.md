

## Melhorias no Sistema de Grupos VIP

### Resumo das Funcionalidades

1. **Gerenciamento em massa de grupos dentro da campanha** - Alterar nome, foto, descricao e permissoes de todos os grupos vinculados a campanha de uma vez
2. **Fotos de perfil dos grupos** - Buscar foto via Z-API durante sincronizacao (ja existe `imgUrl`/`profileThumbnail` mas pode nao estar vindo)
3. **Upload local de arquivos** - Para audio, video e documentos na criacao de mensagens agendadas
4. **Calendario de mensagens agendadas** - Visao mensal/semanal por campanha
5. **Edicao de mensagens pendentes** - Editar mensagens que ainda nao foram enviadas
6. **Modelos de mensagens** - Templates reutilizaveis salvos no banco
7. **Variaveis dinamicas nas mensagens** - Ex: `{{link_live}}`, `{{nome_grupo}}`, substituidas no momento do envio

---

### 1. Migracao de Banco de Dados

**Nova tabela `group_message_templates`:**
- `id` (uuid PK)
- `name` (text) - nome do modelo
- `message_type` (text) - text/image/video/audio/document/poll
- `message_content` (text) - conteudo com placeholders de variaveis
- `media_url` (text, nullable)
- `poll_options` (jsonb, nullable)
- `created_at` (timestamptz)

**Nova tabela `campaign_variables`:**
- `id` (uuid PK)
- `campaign_id` (uuid FK -> group_campaigns)
- `variable_name` (text) - ex: `link_live`
- `variable_value` (text) - valor atual
- `updated_at` (timestamptz)
- UNIQUE(campaign_id, variable_name)

Isso permite programar mensagens com `{{link_live}}` e atualizar o valor da variavel separadamente. Na hora do envio, o edge function substitui as variaveis pelos valores atuais.

---

### 2. Upload Local de Arquivos

Na `ScheduledMessageForm`, trocar o campo "URL da Midia" por um componente que oferece duas opcoes:
- **URL externa** (campo de texto como hoje)
- **Upload do computador** (input type="file" que faz upload para o bucket `marketing-attachments` do storage e obtem a URL publica)

Isso ja funciona com o bucket existente `marketing-attachments` (publico).

---

### 3. Fotos dos Grupos

A Z-API retorna `imgUrl` ou `profileThumbnail` nos dados do grupo. O `zapi-list-groups` ja faz `photo_url: g.imgUrl || g.profileThumbnail || null`. Se nao esta vindo, pode ser que a Z-API nao retorne por padrao. Vou adicionar uma chamada separada ao endpoint `profile-picture` da Z-API para cada grupo durante a sincronizacao, ou usar o endpoint `group-metadata` que retorna a foto.

Alternativa mais eficiente: ao sincronizar, para grupos sem foto, fazer chamada ao endpoint `profile-picture` da Z-API em batch.

---

### 4. Gerenciamento em Massa na Campanha

Adicionar uma secao no `CampaignDetailPanel` com:
- Botao "Configurar Grupos" que abre painel com acoes em massa:
  - Alterar foto de todos os grupos
  - Alterar descricao de todos
  - Alterar nome (com sufixo automatico ex: "#1", "#2")
  - Toggle permissoes (admins enviam / admins adicionam) para todos

Cada acao itera sobre os grupos da campanha e chama `zapi-group-settings` sequencialmente.

---

### 5. Calendario de Mensagens

Adicionar uma aba/secao "Calendario" no `CampaignDetailPanel` usando um grid simples de calendario mensal, mostrando as mensagens agendadas em cada dia. Ao clicar no dia, mostra as mensagens daquela data.

---

### 6. Edicao de Mensagens Pendentes

Na lista de mensagens do `CampaignDetailPanel`, adicionar botao de edicao para mensagens com status `pending`. Ao clicar, abre o `ScheduledMessageForm` pre-preenchido. Ao salvar, faz UPDATE em vez de INSERT.

---

### 7. Modelos de Mensagens

Na `ScheduledMessageForm`:
- Botao "Usar Modelo" que abre um select/dialog com templates salvos
- Botao "Salvar como Modelo" que salva a mensagem atual como template reutilizavel
- Templates ficam na tabela `group_message_templates`

---

### 8. Variaveis Dinamicas

Na `ScheduledMessageForm`:
- Botoes para inserir variaveis no cursor: `{{link_live}}`, `{{nome_grupo}}`, `{{data_hoje}}`, etc.
- Preview mostra como ficara a mensagem com os valores atuais

No `CampaignDetailPanel`:
- Secao "Variaveis" onde o usuario define/atualiza os valores das variaveis da campanha
- Ex: campo "link_live" = "https://youtube.com/live/abc123"

No `zapi-group-scheduled-send`:
- Antes de enviar, buscar variaveis da campanha e fazer `replace` no conteudo da mensagem
- `{{nome_grupo}}` substituido pelo nome real do grupo de destino

---

### Resumo de Arquivos

| Arquivo | Acao |
|---|---|
| Migracao SQL | Criar `group_message_templates`, `campaign_variables` |
| `src/components/marketing/ScheduledMessageForm.tsx` | Upload local, variaveis, modelos, modo edicao |
| `src/components/marketing/CampaignDetailPanel.tsx` | Calendario, edicao, gerenciamento em massa de grupos, secao de variaveis |
| `supabase/functions/zapi-group-scheduled-send/index.ts` | Substituicao de variaveis antes do envio |
| `supabase/functions/zapi-list-groups/index.ts` | Buscar fotos de perfil via endpoint `profile-picture` |
| `src/components/marketing/GroupsVipManager.tsx` | Exibir fotos dos grupos nos cards |

### Detalhes Tecnicos

- Upload de arquivos: usa `supabase.storage.from('marketing-attachments').upload()` e `getPublicUrl()`
- Variaveis suportadas inicialmente: `{{link_live}}`, `{{nome_grupo}}`, `{{data_hoje}}`, `{{horario}}`, variaveis customizadas
- Calendario: grid CSS simples (7 colunas x 5-6 linhas), sem dependencia externa
- Edicao de mensagens: reutiliza `ScheduledMessageForm` com prop `editingMessage` para pre-preencher
- Fotos de grupo: tenta `profile-picture/${groupId}` na Z-API durante sync

