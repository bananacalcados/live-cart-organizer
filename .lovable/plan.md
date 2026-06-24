# Carrossel Meta — Botões por card + identificação do clique

## Confirmação de viabilidade (Meta docs)

- Cada card pode ter **conteúdo de botão diferente** (label, URL, payload), desde que **a estrutura seja idêntica** em todos os cards (mesmos tipos, mesma quantidade, mesma ordem). Isso é regra da Meta, não nossa.
- Botão **URL com 1 variável no final** (opção B) é suportado: `loja.com/{{1}}`, preenchido por card no disparo.
- Botão **QUICK_REPLY** retorna `messages.button.payload` no webhook quando tocado → permite identificar o card exato mesmo com o mesmo texto "Quero Esse" em todos.

## Parte 1 — Criação do template (`src/components/MetaTemplateCreator.tsx`)

Manter os dois modos, selecionáveis no editor de carrossel:

1. **Botão global (modo atual)** — define 1 conjunto de botões aplicado a todos os cards. Bom quando o destino/resposta é o mesmo.
2. **Botões exclusivos por card (novo)** — define a *estrutura* dos botões no topo (tipos/quantidade/ordem), e cada card edita seu próprio conteúdo:
   - `QUICK_REPLY`: label por card (ex.: "Quero Esse").
   - `URL`: URL fixa por card **ou** URL com `{{1}}` no final (opção B, valor preenchido no disparo).
   - `PHONE_NUMBER`: número por card.

Validações antes de enviar à Meta:
- Todos os cards com mesma quantidade/tipo/ordem de botões (bloqueia com toast se divergir).
- URL com variável: só 1 `{{1}}`, sempre no final.
- QUICK_REPLY exige label não-vazio em cada card.

### JSON de criação (exemplo: 2 cards, quick reply + URL dinâmica)

```json
{
  "name": "carrossel_semanal_v1",
  "category": "MARKETING",
  "language": "pt_BR",
  "components": [
    { "type": "BODY", "text": "Ofertas da semana!" },
    { "type": "CAROUSEL", "cards": [
      { "components": [
        { "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["4::..."] } },
        { "type": "BODY", "text": "{{1}}" , "example": { "body_text": [["Tênis Run X"]] } },
        { "type": "BUTTONS", "buttons": [
          { "type": "QUICK_REPLY", "text": "Quero Esse" },
          { "type": "URL", "text": "Comprar", "url": "https://checkout.bananacalcados.com.br/{{1}}", "example": ["p/run-x"] }
        ]}
      ]},
      { "components": [
        { "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["4::..."] } },
        { "type": "BODY", "text": "{{1}}", "example": { "body_text": [["Sandália Y"]] } },
        { "type": "BUTTONS", "buttons": [
          { "type": "QUICK_REPLY", "text": "Quero Esse" },
          { "type": "URL", "text": "Comprar", "url": "https://checkout.bananacalcados.com.br/{{1}}", "example": ["p/sand-y"] }
        ]}
      ]}
    ]}
  ]
}
```

A estrutura dos botões é idêntica (QUICK_REPLY + URL nos dois); só o conteúdo muda.

## Parte 2 — Disparo semanal (`MassTemplateDispatcher.tsx`)

Para cada card, além de imagem/textos da semana, o atendente preenche:
- **URL (opção B):** sufixo da URL por card → chave `card_{i}_button_url_{j}` (já existe no builder).
- **Identificação do produto:** um campo "Produto/Identificador" por card → novas chaves `card_{i}_product_name` e (opcional) `card_{i}_sku`, salvas em `variables_config`. Servem para o payload e para o atendente ler depois.

O `payload` do quick reply é montado **compacto e único por card**:
```
bcq:<dispatch_history_id>:<card_index>
```
(não colocamos nome do produto no payload por causa do limite de tamanho da Meta; resolvemos pelo lookup).

### JSON de envio (por destinatário)

```json
{
  "type": "carousel",
  "cards": [
    { "card_index": 0, "components": [
      { "type": "header", "parameters": [{ "type": "image", "image": { "link": "https://.../card0.jpg" } }] },
      { "type": "body", "parameters": [{ "type": "text", "text": "Tênis Run X" }] },
      { "type": "button", "sub_type": "quick_reply", "index": 0,
        "parameters": [{ "type": "payload", "payload": "bcq:7f3a...:0" }] },
      { "type": "button", "sub_type": "url", "index": 1,
        "parameters": [{ "type": "text", "text": "p/run-x" }] }
    ]},
    { "card_index": 1, "components": [
      { "type": "header", "parameters": [{ "type": "image", "image": { "link": "https://.../card1.jpg" } }] },
      { "type": "body", "parameters": [{ "type": "text", "text": "Sandália Y" }] },
      { "type": "button", "sub_type": "quick_reply", "index": 0,
        "parameters": [{ "type": "payload", "payload": "bcq:7f3a...:1" }] },
      { "type": "button", "sub_type": "url", "index": 1,
        "parameters": [{ "type": "text", "text": "p/sand-y" }] }
    ]}
  ]
}
```

`dispatch-worker/index.ts` → `buildCarouselComponent` passa a:
- emitir `sub_type: "quick_reply"` com `payload` para botões QUICK_REPLY (hoje só trata URL);
- usar o `dispatch_history.id` do disparo no payload.

## Parte 3 — Identificação no chat (webhook + UI)

`meta-whatsapp-webhook/index.ts`, `case 'button'`:
- ler `msg.button?.payload` (hoje ignorado);
- se começar com `bcq:`, parsear `dispatch_history_id` + `card_index`, buscar em `dispatch_history.variables_config` o `card_{i}_product_name`/imagem;
- gravar a mensagem recebida de forma legível, ex.:
  `🛒 Quero Esse → Card 1: Tênis Run X` (assim o vendedor já vê no chat existente, sem mudança de frontend);
- persistir o payload bruto numa nova coluna `whatsapp_messages.button_payload` (para rastreio/relatórios).

### Banco
- Migration: `ALTER TABLE whatsapp_messages ADD COLUMN button_payload text;` (nullable, sem quebrar nada).
- Sem novas tabelas; o mapeamento card→produto vive no `variables_config` do próprio disparo.

## Arquivos afetados
- `src/components/MetaTemplateCreator.tsx` — modo global vs. por card + validações.
- `src/components/marketing/MassTemplateDispatcher.tsx` — campos por card (URL var + produto/identificador).
- `supabase/functions/dispatch-worker/index.ts` — payload quick reply por card.
- `supabase/functions/meta-whatsapp-webhook/index.ts` — captura/resolução do payload.
- nova migration: coluna `button_payload`.

## Limites/observações
- O texto do botão é igual em todos os cards; a diferenciação vem do `payload` (invisível ao cliente) — exatamente o que você precisa.
- Quick reply e URL podem coexistir num card (até 2 botões/card), mas a combinação tem que ser igual em todos os cards.
- Payload da Meta tem limite de tamanho; por isso usamos um código curto + lookup, nunca o nome completo do produto.
