
# WaSender — Análise da API e Plano de Implementação Completo

## 1. O que a documentação da WaSender permite (mapa completo)

A WaSender expõe **um único endpoint de envio** (`POST /api/send-message`) que aceita o tipo pelo formato do corpo, mais vários endpoints de gestão. Tudo abaixo é suportado pela API:

**Mensagens**
- Texto, Imagem, Vídeo, Áudio, Documento, Sticker (.webp)
- Cartão de contato (`contact`), Localização (`location`)
- Enquete/Poll (multi-seleção)
- Mensagem citada / reply
- Menções em grupo (`@participante`)
- "Ver uma vez" (view once)
- Editar mensagem, Apagar mensagem (para todos), Marcar como lida (tique azul)
- Info da mensagem, Reenviar falha
- Upload de mídia (`/api/upload`) e Decrypt de mídia recebida (`/api/decrypt-media`)

**Sessões**
- Criar, listar, detalhe, atualizar, status, deletar, **restart**, connect, disconnect, QR code, regenerar API key
- Logs de mensagens e de sessão
- **Checar se número está no WhatsApp** (`/api/on-whatsapp/{phone}`)
- Info do usuário da sessão
- **Presença** (`/api/send-presence-update`) → "digitando…", "gravando áudio…"

**Contatos**
- Listar todos, info de contato, foto de perfil, bloquear/desbloquear, criar/atualizar contato, LID↔telefone

**Grupos**
- Criar, listar todos, metadata, participantes (listar/adicionar/remover/promover/rebaixar), foto, configurações (assunto, descrição, modo anúncio/restrito), link de convite, info de convite, aceitar convite, sair, enviar mensagem + menções

**Canais/Comunidades**
- Enviar mensagem em canal

**Webhooks (eventos recebidos)**
- `messages.received` / `messages.upsert` (entrada), `messages.update` (status ✓✓), `message.sent`
- `session.status`, `qrcode.updated`
- `contacts.update` / `contacts.upsert`
- `groups.upsert`, `group.update`, `group.participants.update`
- `chats.upsert` / `chats.update` / `chats.delete`

## 2. O que JÁ temos implementado hoje
- Envio de **texto, imagem, vídeo, áudio, documento** (`wasender-send-message` / `wasender-send-media`)
- Gestão de sessão (create, connect, qrcode, status, disconnect, delete) + UI de QR Code
- Webhook que recebe texto e mídia, descriptografa via `decrypt-media`, e encaminha no formato canônico para o `zapi-webhook` (reaproveita IA, leads, dedup, NPS)
- Roteamento de envio pelo provider `wasender` no `useChatSender`

## 3. Lacunas (o que falta para atender seu pedido)

| Recurso | Status |
|---|---|
| Enviar contato | ❌ falta |
| Enviar localização | ❌ falta |
| Enviar enquete (poll) | ❌ falta |
| Reply / citar mensagem | ❌ falta (campo não enviado) |
| Sticker | ⚠️ parcial (recebe, não envia) |
| Presença "digitando/gravando" | ❌ falta |
| Editar / apagar / marcar lida | ❌ falta |
| Checar número no WhatsApp | ❌ falta |
| **Grupos VIP via WaSender** | ❌ hoje é só Z-API |
| **Mídia recebida persistente no chat** | ⚠️ **risco crítico** |

### ⚠️ Ponto crítico: persistência de mídia no chat
A `decrypt-media` da WaSender retorna uma `publicUrl` **válida por apenas 1 hora**. Hoje o webhook salva essa URL direto em `whatsapp_messages.media_url`. Resultado: imagens, vídeos, áudios e documentos **aparecem no chat agora, mas quebram depois de 1 hora**. Para o usuário "ver, assistir e ouvir quando precisar", precisamos **baixar a mídia e re-hospedar no Storage do projeto** (URL permanente), igual ao padrão usado para WhatsApp.

## 4. Plano de implementação

### Fase A — Persistência de mídia (prioridade máxima)
1. Criar bucket público `whatsapp-media` (migration) com policies de leitura pública e escrita via service role.
2. No `wasender-webhook`: após obter a `publicUrl` da `decrypt-media`, baixar o arquivo e fazer upload no bucket; salvar a URL permanente em `media_url`. Fallback para a URL temporária se o upload falhar.
3. Validar que imagem/vídeo/áudio/documento renderizam no chat via `WhatsAppMediaAttachment` (já existe e suporta todos os tipos, inclusive áudio com player e PDF inline).

### Fase B — Novos tipos de envio
4. Estender `wasender-send-media` para **sticker** (`stickerUrl`).
5. Adicionar **reply/quoted** no `wasender-send-message` (campo de mensagem citada).
6. Criar `wasender-send-extra` (ou estender as funções) para **contato** (`contact`), **localização** (`location`) e **enquete** (`poll`).
7. Expor esses tipos no front (`useChatSender` + UI do chat: anexar contato/localização/enquete).

### Fase C — Recursos de conversa
8. `wasender-presence` → "digitando…/gravando…" (chamar ao abrir conversa / ao gravar áudio).
9. `wasender-message-actions` → editar, apagar, marcar como lida; ligar aos controles já existentes no chat (que hoje usam Z-API).
10. `wasender-check-number` → checar se número existe no WhatsApp (útil em campanhas).

### Fase D — Grupos e VIP via WaSender
11. `wasender-groups` cobrindo: listar, metadata, participantes (add/remove/promote/demote), settings, foto, link de convite, criar grupo, enviar em grupo + menções.
12. Tornar os fluxos de **Grupos VIP** provider-aware: hoje `cron-check-vip-groups`, `zapi-send-group-message`, `zapi-group-campaign-execute` chamam Z-API direto. Adicionar ramo `wasender` que respeita as regras de disparo VIP já existentes (sequencial puro, retry por bloco, pausa a cada 3 grupos, abort se instância offline).

### Fase E — Webhooks adicionais
13. Tratar no `wasender-webhook`: `message.sent`, `qrcode.updated` (atualiza QR na UI em tempo real), `group.participants.update` / `group.update` (sincroniza contagem/membros VIP), `contacts.update`.

## 5. Detalhes técnicos
- Endpoint de envio único: `POST {WASENDER_BASE}/send-message` com `Authorization: Bearer <api_key da sessão>`. Corpo por tipo: `text`, `imageUrl/videoUrl/audioUrl/documentUrl/stickerUrl`, `contact:{name,phone}`, `location:{latitude,longitude,name,address}`, `poll:{...}`, e campo de quoted para reply.
- Gestão (sessão/grupos/contatos) usa o **PAT global** (`WASENDER_API_TOKEN`) via `wasenderPAT()` para sessões, e a **api_key da sessão** para grupos/contatos/envio.
- Manter o `instance-guard` (HTTP 409 INSTANCE_MISMATCH) em todos os envios — regra de conversa travada por (telefone+instância).
- Registrar novas funções com `verify_jwt = false` no `config.toml` (webhook é externo).
- Reaproveitar `WhatsAppMediaAttachment` no chat (sem mudança de UI necessária para exibir mídia).

## 6. Confirmação que preciso de você
Antes de implementar, quero confirmar o escopo desta rodada, porque é grande. Por padrão proponho fazer **Fase A + Fase B** primeiro (resolve a persistência de mídia e adiciona contato/localização/enquete/sticker/reply), e depois seguimos para grupos/VIP e ações de mensagem. Se preferir tudo de uma vez, eu faço — só será uma entrega maior.
