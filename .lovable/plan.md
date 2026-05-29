## Resumo / é possível?

Sim, é totalmente possível — e a continuidade do histórico é o ponto mais tranquilo da implementação.

No nosso sistema, todo o histórico de WhatsApp vive na tabela `whatsapp_messages`, indexado principalmente pelo **telefone do contato** (`phone`), não pelo provedor. O chat carrega a conversa por telefone (com variações de 8/9 dígitos), independente de ter vindo por Z-API, Meta ou WaSender. Ou seja: se você usar os **mesmos números** no WaSender, as conversas antigas continuam aparecendo normalmente no mesmo chat.

O único cuidado é a regra atual "conversa = telefone + instância" (cada conversa fica travada à instância da última mensagem). Para garantir histórico + envio sem conflito, ao migrar um número de Z-API para WaSender vamos **reaproveitar a mesma linha** em `whatsapp_numbers` (mesmo `id`), apenas trocando o provider e as credenciais. Assim todas as mensagens passadas continuam vinculadas àquela instância e o envio novo sai pelo WaSender, sem "vazamento" entre instâncias.

## Como o WaSenderAPI funciona (da documentação)

- **Autenticação**: um **Personal Access Token (PAT)** da conta gerencia sessões; cada sessão recebe seu próprio **API Key** (usado para enviar mensagens) e um **webhook_secret**.
- **Sessões = instâncias**:
  - `POST /api/whatsapp-sessions` (PAT) cria a sessão → retorna `id`, `api_key`, `webhook_secret`.
  - `POST /api/whatsapp-sessions/{id}/connect` (PAT) → `{ status: "NEED_SCAN", qrCode }` (string do QR, expira ~45s).
  - `GET /api/whatsapp-sessions/{id}/qrcode` (PAT) → QR fresco.
  - `GET .../status`, `disconnect`, `delete`, `restart`.
- **Envio**: `POST /api/send-message` com `Authorization: Bearer <API_KEY_DA_SESSÃO>`, body `{ to, text, imageUrl|videoUrl|documentUrl|audioUrl }`.
- **Webhook**: configurado por sessão; eventos `messages.received`, `messages.update`, `session.status`. Verificação via header `X-Webhook-Signature` == `webhook_secret`. Payload: `data.messages.{ key:{id,fromMe,remoteJid,cleanedSenderPn,cleanedParticipantPn}, messageBody, message:{...} }`.

## Plano de implementação

### 1. Banco de dados (migration)
Adicionar à tabela `whatsapp_numbers` as colunas do WaSender:
- `wasender_session_id` (int), `wasender_api_key` (text, key de envio da sessão), `wasender_webhook_secret` (text), `wasender_phone_number` (text).
- Manter `provider` aceitando o novo valor `'wasender'`.

O PAT da conta fica como secret global (`WASENDER_API_TOKEN`), não por linha.

### 2. Secret
Solicitar `WASENDER_API_TOKEN` (Personal Access Token, em Settings → Personal Access Token no painel WaSender).

### 3. Edge functions novas
- `wasender-session`: ações `create | connect | qrcode | status | disconnect | delete` usando o PAT. No `create`, já configura `webhook_url` apontando para `wasender-webhook?number_id=<id>` e salva `api_key`/`webhook_secret` na linha.
- `wasender-webhook`: valida `X-Webhook-Signature`, trata `messages.received` (texto e mídia, usando `cleanedSenderPn`/`messageBody`), `messages.update` (status ✓✓) e `session.status` (online/offline). Normaliza telefone (mesma lógica BR/9º dígito do `zapi-webhook`), faz dedup de outgoing/incoming, insere em `whatsapp_messages` com o `whatsapp_number_id` resolvido pela sessão, e chama `routeMessage` (IA/cooldown) igual ao Z-API.
- `wasender-send-message` e `wasender-send-media`: enviam via `/api/send-message` com a API key da sessão; reaproveitam o `instance-guard` (trava por conversa) exatamente como o Z-API.

### 4. Frontend — gerenciador de instâncias com QR
- Novo `WaSenderInstanceManager` (espelha o `ZApiInstanceManager`), na mesma área admin de instâncias:
  - Criar instância (nome + telefone), botão **Conectar** que chama `connect`, exibe o **QR Code dentro do app** (render do `qrCode` com lib de QR), com polling de status e refresh automático do QR quando expira.
  - Status online/offline, desconectar, excluir.
  - Opção "Migrar número existente do Z-API para WaSender" que converte a linha no lugar (preserva histórico e o vínculo de instância).

### 5. Roteamento de envio (chat unificado)
- Estender o tipo de provider para incluir `'wasender'`.
- Em `useChatSender` e no `WhatsAppChat.sendMessage`, adicionar o ramo: se `provider === 'wasender'` → `wasender-send-message`/`wasender-send-media`. Meta e Z-API permanecem intactos.
- A escolha de instância continua via `useConversationInstance` (sem mudança de regra).

### 6. Continuidade de histórico
- Conversas são carregadas por telefone → histórico antigo (Z-API/Meta) aparece automaticamente.
- Migração in-place (mesmo `id` da linha) mantém o vínculo conversa↔instância para envios futuros sem `INSTANCE_MISMATCH`.

## Detalhes técnicos / pontos de atenção

```text
Envio:   UI → useChatSender/WhatsAppChat → (provider) → wasender-send-* → WaSender /api/send-message
Recebe:  WaSender → wasender-webhook?number_id=ID → whatsapp_messages → broadcast → chat
```

- O WaSender pode entregar `remoteJid` como LID (`@lid`); usaremos sempre `cleanedSenderPn`/`cleanedParticipantPn` (reaproveitando a lógica de resolução de LID já existente no `zapi-webhook`).
- Mídia recebida pode vir criptografada; usaremos o endpoint `POST /api/decrypt-media` do WaSender para obter URL pública antes de salvar.
- O webhook responde sempre `200 OK` rápido (assíncrono no processamento de IA), como já fazemos.
- Nenhuma alteração nos fluxos Z-API/Meta existentes — WaSender é aditivo.

Confirmando: posso seguir com este plano? Assim que aprovar, começo pela migration + secret e depois as edge functions e a tela de QR.