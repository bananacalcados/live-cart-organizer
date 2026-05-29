## Objetivo

Concluir a integração WaSender com **(E)** o tratamento dos webhooks que ainda faltam e **(F)** os botões de **Contato**, **Localização** e **Enquete** na tela de chat — cujos backends (`wasender-send-extra`) já existem mas não têm UI.

---

## Parte E — Webhooks adicionais

Arquivo: `supabase/functions/wasender-webhook/index.ts` (acrescentar novos blocos `if (event === ...)` antes do `return ok()` final, sem mexer no que já funciona).

1. **`qrcode.updated`**
   - Extrai o QR do payload (`data.qrCode` / `data.qr`).
   - Persiste em `whatsapp_numbers` (coluna nova `wasender_last_qr` + `wasender_qr_updated_at`) para que o Admin possa exibir o QR em tempo real via Realtime, eliminando parte do polling atual.

2. **`session.status` (reforço)**
   - Já tratado, mas adicionar mapeamento dos estados `need_scan`/`disconnected` para `is_online=false` e limpar `wasender_last_qr` quando `connected`.

3. **`groups.update` e `groups.participants.update`**
   - Quando o grupo é um grupo VIP conhecido, atualiza metadados (nome/assunto e contagem/lista de participantes) na tabela de grupos VIP correspondente, mantendo os dados de disparo sincronizados.
   - Eventos de grupos desconhecidos → apenas `log` + `ok()` (sem erro).

4. **`contacts.update` / `contacts.upsert`**
   - Atualiza o `push_name`/nome de exibição em `chat_contacts` (match por telefone com sufixo de 8 dígitos, conforme regra de normalização do projeto), para que a lista de conversas mostre o nome correto.

5. Todos os eventos continuam respondendo **HTTP 200** sempre (regra atual: nunca deixar a WaSender reenviar em loop). Validação de assinatura (`x-webhook-signature`) permanece igual.

**Migração de banco (se necessária):** adicionar colunas `wasender_last_qr text` e `wasender_qr_updated_at timestamptz` em `whatsapp_numbers`. Antes de criar, confirmo no schema se já existe coluna equivalente para QR; se existir, reaproveito.

---

## Parte F — Botões no chat (Contato, Localização, Enquete)

Estes recursos hoje só têm backend em `wasender-send-extra` (WaSender). Z-API não possui função equivalente, então os botões só aparecem/funcionam para conversas em instância **WaSender**; para Z-API ficam ocultos.

1. **Novo componente** `src/components/chat/ChatExtraSender.tsx`
   - Recebe `phone`, `whatsappNumberId`, `provider` e callback `onSent`.
   - Renderiza um `Popover`/`DropdownMenu` com 3 itens: **Contato**, **Localização**, **Enquete**.
   - Cada item abre um `Dialog` com os campos:
     - **Contato:** nome + telefone.
     - **Localização:** latitude + longitude (+ nome/endereço opcional). Botão "usar minha localização" via `navigator.geolocation`.
     - **Enquete:** pergunta + 2–12 opções (campos dinâmicos) + seleção única/múltipla.
   - Ao confirmar, chama `supabase.functions.invoke('wasender-send-extra', { body: { kind, phone, whatsapp_number_id, contact|location|poll } })`.
   - Após sucesso: insere a mensagem outgoing em `whatsapp_messages` (texto descritivo: `👤 nome`, `📍 link maps`, `📊 pergunta`) para aparecer no histórico, e pausa a IA via `automation_ai_sessions.is_active=false` (regra do projeto — nunca endpoint externo).

2. **Integração no `ChatView.tsx`**
   - Adicionar prop opcional `onExtraSent?: () => void` e renderizar `<ChatExtraSender>` dentro do mesmo `Popover` do clipe (Paperclip), ao lado de Foto/Vídeo/Arquivo, **somente** quando o provider da conversa for `wasender`.
   - O provider vem de `conversation.whatsapp_number_id` → resolvido pelo componente (consulta leve a `whatsapp_numbers.provider`) ou via campo já disponível em `conversation`.

3. **Parents** (`POSWhatsApp`, `GlobalWhatsAppChat`, `DashboardChatPanel`)
   - Passar `onExtraSent={() => loadMessages(...)}` para recarregar o histórico após envio. Sem outras mudanças de lógica.

---

## Validação

- Deploy de `wasender-webhook` e `wasender-send-extra` (já existe).
- Simular cada evento novo via `curl_edge_functions` no webhook e conferir efeitos no banco (QR salvo, nome de contato atualizado, grupo VIP sincronizado).
- No chat de uma instância WaSender: enviar contato, localização e enquete; confirmar que aparecem no histórico e chegam no WhatsApp.
- Confirmar que conversas Z-API **não** mostram os botões extras e que nada do fluxo atual quebrou.

---

## Fora de escopo

- Equivalentes de contato/localização/enquete para Z-API (não há API).
- Substituir totalmente o polling de QR (apenas complementar com Realtime).
