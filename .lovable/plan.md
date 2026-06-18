## Objetivo

Melhorar a automação de comentários do Instagram com:
1. **Variações de resposta no comentário** (reduz risco de spam pela Meta).
2. **Botões na mensagem do Direct (DM)** com 3 capacidades: link (ex.: grupo VIP), botão de resposta que dispara um fluxo de automação, e botão que aplica uma TAG automática na pessoa.

## Limitações da Meta (importante alinhar)

- Botões no Direct usam o **"button template"** do Instagram: **máximo 3 botões** por mensagem.
- Cada botão pode ser de 2 tipos:
  - **Link** (`web_url`): abre uma URL (grupo VIP, checkout, etc.).
  - **Resposta** (`postback`): quando a pessoa clica, o Instagram nos avisa e podemos: aplicar TAG(s), enviar uma mensagem de retorno e/ou disparar um fluxo de automação.
- Um mesmo botão de resposta pode **ao mesmo tempo** aplicar tag + disparar fluxo. Ex.: botão "Sim" → tag `quer_live` + dispara fluxo X (que pode ter atraso de N dias dentro do próprio fluxo).
- A janela de mensagens do IG é de 24h para resposta padrão; o disparo inicial via comentário usa a Private Reply (válida logo após o comentário), então funciona normalmente.

## O que será construído

### 1. Banco de dados (migration)
Adicionar 2 colunas em `instagram_comment_rules`:
- `reply_comment_variations text[]` — lista de variações de texto pra resposta pública no comentário. Se vazio, usa o `reply_comment_text` atual (compatibilidade).
- `dm_buttons jsonb` (default `[]`) — array de até 3 botões. Cada botão:
  ```text
  {
    "label": "Entrar no grupo VIP",
    "type": "link" | "reply",
    "url": "https://...",            // só p/ type=link
    "tags": ["quer_live"],           // só p/ type=reply (aplica na pessoa)
    "reply_message": "Show! ...",    // opcional, mensagem enviada ao clicar
    "flow_id": "uuid-do-fluxo"       // opcional, dispara automação ao clicar
  }
  ```

### 2. Webhook (`meta-messenger-webhook` + `_shared/instagram-comment-automation.ts`)
- **Variações:** ao responder o comentário, sortear aleatoriamente uma das `reply_comment_variations` (fallback para `reply_comment_text`).
- **DM com botões:** se `dm_buttons` tiver itens, enviar como button template (texto + botões). Para cada botão de resposta, o `payload` carrega um identificador `igbtn:<rule_id>:<índice>`.
- **Clique no botão (postback):** estender o tratamento de `event.postback` para detectar o payload `igbtn:...`, localizar a regra+botão e então:
  - aplicar as `tags` no `chat_contacts` da pessoa (merge sem duplicar);
  - se houver `reply_message`, enviar como DM;
  - se houver `flow_id`, disparar `automation-trigger-incoming` com aquele fluxo.

### 3. UI (`InstagramCommentAutomation.tsx`)
- **Bloco de variações de resposta:** permitir adicionar várias linhas de resposta (lista com adicionar/remover). Mantém o campo único como primeira variação.
- **Construtor de botões do DM:** lista de até 3 botões. Para cada um: rótulo, tipo (Link / Resposta). Se Link → campo URL. Se Resposta → campos de TAGs (separadas por vírgula), mensagem de retorno opcional e seletor de fluxo de automação opcional.
- Persistir os novos campos no `saveRule`/`openEdit`.

## Detalhes técnicos

- Tags reutilizam `chat_contacts.tags` (mesmo sistema do chat), então as automações por tag "x dias depois" já existentes podem consumir essas tags.
- O disparo "x dias depois" fica a cargo do **fluxo de automação** selecionado no botão (o motor de fluxos já suporta atrasos), evitando criar um novo agendador.
- Compatibilidade: regras antigas sem `dm_buttons`/`reply_comment_variations` continuam funcionando com o comportamento atual.

## Arquivos afetados
- Migration nova (colunas em `instagram_comment_rules`).
- `supabase/functions/_shared/instagram-comment-automation.ts`
- `supabase/functions/meta-messenger-webhook/index.ts`
- `src/components/marketing/InstagramCommentAutomation.tsx`
