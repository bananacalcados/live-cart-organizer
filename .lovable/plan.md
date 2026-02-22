# Indicadores de Status de Mensagem WhatsApp

## Problema

As mensagens enviadas no WhatsApp do app mostram indicadores de status inconsistentes ou ausentes dependendo do modulo:

- **ChatView** (usado no POS, Chat global, pagina Chat): mostra apenas texto simples (✓, ✓✓, ❌) sem diferenciacao visual entre "entregue" e "lido"
- **SupportWhatsAppChat** (Expedicao): nao mostra nenhum status nas mensagens enviadas
- **WhatsAppChat** (Pedidos) e **LiveWhatsAppChatDialog**: ja possuem icones corretos com Lucide icons

## Solucao

Criar um componente compartilhado `MessageStatusIcon` e aplicar em todos os modulos com WhatsApp.

### Icones (como no WhatsApp real)

- **Enviando** (sending/pending): relogio cinza
- **Enviado** (sent): 1 check cinza - mensagem saiu do servidor, destinatario pode estar sem sinal
- **Entregue** (delivered): 2 checks cinza - destinatario foi notificado
- **Lido** (read): 2 checks azul - destinatario visualizou
- **Falha** (failed): X vermelho

### Componentes a alterar

1. **Novo: `src/components/chat/MessageStatusIcon.tsx**`
  - Componente reutilizavel com a funcao `getStatusIcon(status)`
  - Usa Lucide: `Clock`, `Check`, `CheckCheck`, `X`
  - "read" renderiza CheckCheck com cor azul (#53bdeb)
2. `**src/components/chat/ChatView.tsx**`
  - Substituir os emojis de texto (✓, ✓✓, ❌) pelo componente `MessageStatusIcon`
  - Renderizar icone inline ao lado do horario para mensagens outgoing
3. `**src/components/expedition/SupportWhatsAppChat.tsx**`
  - Adicionar `MessageStatusIcon` ao lado do horario nas mensagens outgoing
4. `**src/components/WhatsAppChat.tsx**`
  - Refatorar para usar o componente compartilhado (remover funcao local `getStatusIcon`)
5. `**src/components/live/LiveWhatsAppChatDialog.tsx**`
  - Refatorar para usar o componente compartilhado (remover funcao local `renderMessageStatus`)

### Detalhes tecnicos

- O campo `status` na tabela `whatsapp_messages` ja armazena os valores corretos: `sending`, `sent`, `delivered`, `read`, `failed`
- O webhook da Meta (`meta-whatsapp-webhook`) ja atualiza o status corretamente quando recebe callbacks de `sent`, `delivered`, `read`, `failed`
- O Supabase Realtime ja esta habilitado na tabela `whatsapp_messages`, entao os status atualizam em tempo real na tela