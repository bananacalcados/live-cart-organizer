# Botões + Mídias na Mensagem Inicial do Instagram (Evento)

Adicionar, no bloco "Mensagem inicial via Instagram Direct" do wizard de evento, a possibilidade de anexar **botões clicáveis** (link ou automação) e fazer **upload de mídia** (vídeo/imagem/áudio/arquivo) que será enviada quando o cliente clicar em botões de automação. Nada da estrutura atual é alterado — a feature é **aditiva** e opt-in por bloco.

## O que muda para o usuário

Dentro de cada bloco da "Mensagem inicial via Instagram Direct" a vendedora passa a poder:

1. **Adicionar botões** (até 3 por bloco — limite da Instagram Messaging API):
   - **Botão do tipo Link** → escreve o rótulo (ex.: "Abrir meu carrinho") e escolhe uma **variável de link** já existente (`{checkout_link}`) **ou** cola uma URL fixa.
   - **Botão do tipo Automação** → escreve o rótulo (ex.: "Como finalizar minha compra") e escolhe uma **automação** cadastrada no próprio evento (ver item 2).

2. **Cadastrar Automações do Evento** (nova sub-seção logo abaixo da mensagem inicial):
   - Nome interno da automação (ex.: `como_finalizar`).
   - Texto opcional que acompanha a resposta.
   - Upload de **1 mídia** (vídeo, imagem, áudio ou arquivo) — usa o bucket de storage já usado pelos eventos.
   - Quando o cliente clicar no botão vinculado, o backend envia via Instagram DM o texto + a mídia.

## Arquitetura (sem quebrar nada)

### 1. Schema — 2 colunas novas na tabela `events`

Migration aditiva, sem tocar em colunas existentes:

- `ig_initial_message_buttons jsonb default '[]'::jsonb`
  Guarda, por bloco da mensagem inicial, os botões daquele bloco.
  Formato:
  ```json
  [
    { "blockIndex": 0, "buttons": [
      { "id": "b1", "type": "url",       "title": "Abrir meu carrinho",
        "urlToken": "{checkout_link}" },
      { "id": "b2", "type": "automation","title": "Como finalizar compra",
        "automationId": "auto_como_finalizar" }
    ]}
  ]
  ```
- `ig_automations jsonb default '[]'::jsonb`
  Catálogo de automações do evento:
  ```json
  [{
    "id": "auto_como_finalizar",
    "label": "Como finalizar compra",
    "text": "Olha só, é super rápido:",
    "media": { "kind": "video", "url": "https://.../video.mp4", "mimeType": "video/mp4" }
  }]
  ```

Sem RLS nova (herda a de `events`). Sem GRANT extra.

### 2. Storage

Reaproveita o bucket já existente usado por eventos (ex.: `event-assets` ou o bucket de mídia do chat) — se não existir um adequado, cria bucket público `event-ig-automations` na mesma migration com as políticas mínimas.

Upload feito no front via cliente Supabase (`.storage.from(...).upload(...)`) direto do editor da automação; salvamos apenas a URL pública em `ig_automations[].media.url`.

### 3. Front-end (mudanças isoladas)

- **`src/components/events/InitialMessageEditor.tsx`**
  - Adiciona, dentro de cada bloco, uma linha "Botões (opcional)" com botão "+ Adicionar botão" (até 3).
  - Cada botão tem: `type` (url | automation), `title`, e o campo dependente (URL/variável ou seletor de automação).
  - Recebe/emite props novas: `buttons`, `onChangeButtons`, `automations` (para popular o select do tipo automação).

- **Novo componente `src/components/events/IgAutomationsManager.tsx`**
  - Lista/CRUD das automações do evento (label, texto, upload de mídia).
  - Renderizado no `EventSetupWizard.tsx` logo abaixo do `InitialMessageEditor`.

- **`src/components/events/EventSetupWizard.tsx` e `src/pages/Events.tsx`**
  - Novos estados `igButtons` e `igAutomations`, hidratados/salvos junto com os demais campos (`initial_message_*`). Zero mudança nos fluxos atuais.

- **`src/integrations/supabase/types.ts`**
  - Regenerar tipos após a migration (as duas colunas novas em `events`).

### 4. Backend — `supabase/functions/livete-start-order/index.ts`

Alteração cirúrgica dentro do bloco `dispatchInstagram`, sem tocar em WhatsApp:

1. Após enviar o texto de um bloco (`rendered[i]`), consulta `ig_initial_message_buttons` para aquele `blockIndex`.
2. Se houver botões, chama uma **nova edge function** `instagram-dm-send-buttons` que usa o **Instagram Messaging API — Generic Template** (`attachment.type=template`, `payload.template_type=generic`) com até 3 `buttons` do tipo `web_url` (link) ou `postback` (automação).
   - Payload `payload` idêntico ao já usado em `meta-messenger-send/index.ts` (mesmo token/roteamento de instância via `resolveIgAccountByNumberId`).
   - Se o cliente já respondeu (janela 24h aberta), a IG aceita o template; se estiver fora da janela, o send falha e caímos no fallback atual (WA), sem quebrar.

3. Nova edge function **`instagram-dm-automation-run`** (webhook target):
   - Chamada pelo `instagram-webhook` existente quando recebe um `postback.payload` no formato `auto:<automationId>:<eventId>`.
   - Carrega `ig_automations` do evento, pega a automação pelo id, envia via `meta-messenger-send`:
     - Texto (se houver).
     - Mídia (usa o `type` correto: `image` / `video` / `audio` / `file` já suportado por `meta-messenger-send`).

4. `supabase/functions/instagram-webhook/index.ts` — adiciona **um único branch** que detecta `messaging[].postback` com `payload` prefixado `auto:` e invoca a nova função. Nenhum comportamento existente é removido.

### 5. Segurança / limites

- Máx. 3 botões por bloco (limite da API).
- Título do botão ≤ 20 chars (limite IG) — validação no editor.
- Upload de mídia com tamanho compatível com IG DM (vídeo ≤ 25 MB, áudio ≤ 25 MB, imagem ≤ 8 MB, arquivo ≤ 25 MB) — validação no `IgAutomationsManager`.
- Postback payload assinado internamente (`auto:<id>:<eventId>`) e sempre validado contra `ig_automations` do evento antes de disparar.

## Ordem de implementação

1. Migration `events` (+2 colunas jsonb) e bucket, se necessário.
2. `IgAutomationsManager.tsx` + wiring no wizard + persistência.
3. Extensão do `InitialMessageEditor.tsx` com botões por bloco.
4. Edge function `instagram-dm-send-buttons` (generic template + botões).
5. Extensão do `livete-start-order` para disparar os botões após cada bloco.
6. Edge function `instagram-dm-automation-run` + branch no `instagram-webhook`.
7. Teste ponta-a-ponta em um evento de sandbox (comentário → DM inicial + botões → clique postback → mídia enviada).

## O que NÃO muda

- Fluxo do WhatsApp / template Meta permanece igual.
- Envio atual de blocos de texto no IG continua funcionando mesmo se `ig_initial_message_buttons` estiver vazio.
- Nenhuma coluna, edge function ou componente existente é removido/renomeado.
