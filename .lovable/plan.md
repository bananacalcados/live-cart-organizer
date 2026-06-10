# Publicar Status/Stories do WhatsApp pelo PDV (uazapi)

Permitir que as vendedoras publiquem status/stories (foto, vídeo ou texto) direto do chat do WhatsApp do PDV, usando uma instância uazapi escolhida. Edge function nova `uazapi-send-status`, botão + dialog no `POSWhatsApp`, upload da mídia no bucket `whatsapp-media` e limpeza automática em 24-48h.

## Pontos de decisão já fechados
- **Só uazapi** (e futuramente WaSender/Z-API). Instâncias `provider = 'meta'` **não** aparecem como opção — Meta Cloud API não tem status.
- **Storage, não memória:** mídia sobe pro bucket `whatsapp-media` (já existe `uploadMediaToStorage`), gera URL pública e passa pra uazapi. Cron limpa arquivos da pasta `status/` com +48h.
- **Status é por INSTÂNCIA**, não por conversa. A vendedora escolhe de qual instância uazapi o status sai (diferente da regra de envio travado por conversa).

## Etapas

### 1. Edge function `uazapi-send-status`
Arquivo: `supabase/functions/uazapi-send-status/index.ts`
- Reusa `resolveUazapiCredentials(whatsapp_number_id)` e `uazapiInstance` do `_shared/uazapi-credentials.ts`.
- Body: `{ whatsapp_number_id, type: 'text'|'image'|'video', text?, mediaUrl?, caption? }`.
- Valida com Zod (type obrigatório; `mediaUrl` obrigatório p/ image/video; `text` obrigatório p/ text).
- Chama `POST /send/status` da uazapi com o Instance Token. Monta payload conforme `type`.
- Retorna `{ success, messageId, data }`. CORS em todas as respostas, incluindo erro.
- **Sem** `instance-guard` (status não é ligado a telefone/conversa).
- Deploy automático (Lovable-managed, `verify_jwt = false`).

### 2. Front-end: botão + dialog no PDV
- Novo componente `src/components/pos/POSStatusDialog.tsx`:
  - Seletor de instância: lista só `storeNumbers` com `provider === 'uazapi'` e ativas. Se nenhuma, mostra aviso "Nenhuma instância uazapi disponível".
  - Tipo: Foto / Vídeo / Texto (tabs ou toggle).
  - Upload de mídia reusando `uploadMediaToStorage` (com prefixo de pasta `status/`), campo de legenda; ou textarea pra status de texto.
  - Botão "Publicar Status" → `supabase.functions.invoke('uazapi-send-status', ...)` + toast de sucesso/erro.
- Botão "Status" no cabeçalho do `POSWhatsApp` que abre o dialog. Fica oculto/desabilitado se não houver instância uazapi na loja.

### 3. Limpeza automática (cron)
- Edge function `cron-cleanup-status-media`: lista objetos em `whatsapp-media/status/` com +48h e remove.
- Agendar via pg_cron (1x/dia) com guard de service-role (mesmo padrão dos outros crons).

### 4. Investigação do webhook de resposta a status (separado)
- **Não** entra nesta primeira entrega. Depois de publicar 1 status e alguém responder, inspeciono o payload real do `uazapi-webhook` pra ver se vem a referência/miniatura do status. Só então desenhamos a UI de "respondeu ao seu status" no chat. Isso evita construir em cima de suposição.

## Detalhes técnicos
- `uploadMediaToStorage` hoje grava em path próprio; vou parametrizar/derivar pra usar pasta `status/AAAA-MM-DD/`.
- Reutiliza o store `storeNumbers` já carregado no `POSWhatsApp` (tem `provider` e `id`).
- Sem alteração de schema. Sem novas tabelas.
- Respeita memória: status nunca sai de instância Meta; não chama endpoints externos proibidos.

## Fora de escopo (por enquanto)
- Resposta a status / miniatura no chat (etapa 4 é só investigação).
- Status pela Meta/WaSender/Z-API.
- Agendamento de status.
