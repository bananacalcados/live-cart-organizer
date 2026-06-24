# Suporte a Templates de CARROSSEL (Meta WhatsApp)

## Princípio de arquitetura (o ponto central do pedido)

Separar **estrutura do template** (criada/aprovada UMA vez) de **conteúdo do disparo** (imagens + variáveis da semana):

- Na **criação**, as imagens são apenas amostras para a Meta aprovar a moldura. Elas viram `header_handle` (handle de upload) e ficam congeladas no template aprovado.
- No **disparo**, NÃO se recria nem reaprova nada. Só se trocam as imagens reais da semana (e textos variáveis) passando-as como **parâmetros** do envio. A Meta permite imagem de envio por `link` público (mais simples) ou por `id` de mídia — não exige re-upload resumable no envio.

Conclusão prática: handle de upload = só criação; link público (Supabase Storage) = disparo.

---

## PARTE 1 — Criar carrossel

**Arquivo:** `src/components/MetaTemplateCreator.tsx` (único arquivo de criação)

Mudanças:
1. Adicionar opção de "tipo de template": Padrão (atual) vs Carrossel. Carrossel só com categoria MARKETING.
2. Quando Carrossel:
   - Campo **Bubble text** (BODY que aparece acima dos cards) — obrigatório. Reaproveita o editor de body atual (emoji + variáveis).
   - Lista de **cards: mínimo 2, máximo 6**. Botões "Adicionar card" / "Remover card".
   - Para cada card: upload de **imagem de exemplo** (reaproveita `meta-whatsapp-upload-header` → retorna `handle`) + **body text** (máx 160 chars, com suas próprias variáveis e exemplos).
   - **Botões configurados UMA vez** (fora dos cards) e aplicados a TODOS os cards — garante mesma quantidade/tipo/ordem (regra dura da Meta). Reaproveita o editor de botões atual.
3. Validações novas: 2–6 cards; todo card com imagem enviada (handle presente); body ≤160 chars; variáveis contíguas e com exemplo por card; estrutura de botões idêntica (garantida por construção).

**Como a imagem de exemplo chega à Meta:** a função `meta-whatsapp-upload-header` JÁ executa o Resumable Upload (POST `/{app_id}/uploads` → sessão → POST bytes → recebe `{ h }`). Chamamos ela uma vez por card no momento do upload e guardamos o `handle` retornado para montar o `example.header_handle` de cada card.

**Edge function:** `meta-whatsapp-create-template` é passthrough (envia `components` direto). Nenhuma mudança necessária — só passamos o componente `CAROUSEL` montado.

### JSON EXATO da criação

```json
{
  "name": "promo_semanal",
  "category": "MARKETING",
  "language": "pt_BR",
  "components": [
    { "type": "BODY", "text": "Confira as novidades da semana! 🛍️" },
    {
      "type": "CAROUSEL",
      "cards": [
        {
          "components": [
            { "type": "HEADER", "format": "IMAGE",
              "example": { "header_handle": ["<HANDLE_AMOSTRA_CARD_0>"] } },
            { "type": "BODY", "text": "Tênis a partir de {{1}}",
              "example": { "body_text": [["R$ 199"]] } },
            { "type": "BUTTONS", "buttons": [
              { "type": "URL", "text": "Comprar",
                "url": "https://checkout.bananacalcados.com.br/p/{{1}}",
                "example": ["tenis-x"] } ] }
          ]
        },
        {
          "components": [
            { "type": "HEADER", "format": "IMAGE",
              "example": { "header_handle": ["<HANDLE_AMOSTRA_CARD_1>"] } },
            { "type": "BODY", "text": "Sandália a partir de {{1}}",
              "example": { "body_text": [["R$ 149"]] } },
            { "type": "BUTTONS", "buttons": [
              { "type": "URL", "text": "Comprar",
                "url": "https://checkout.bananacalcados.com.br/p/{{1}}",
                "example": ["sandalia-y"] } ] }
          ]
        }
      ]
    }
  ]
}
```

Regras embutidas: todos os cards com mesmo `format` de header (IMAGE) e mesma lista de botões na mesma ordem; cada `{{n}}` (body do card e suffix de URL) com `example`.

---

## PARTE 2 — Visualizar o carrossel na listagem

**Arquivo:** `src/components/MetaTemplateCreator.tsx`

Hoje a lista renderiza só o BODY (`getBodyFromComponents`). Mudanças:
- Estender a interface `MetaTemplate.components` para reconhecer `type: "CAROUSEL"` com `cards[]`.
- Quando o template tiver componente CAROUSEL, renderizar mini-preview: bubble text + carrossel horizontal de cards (placeholder/imagem da `example.header_handle` quando disponível, body text do card e os botões).
- `meta-whatsapp-get-templates` já devolve o JSON completo — nenhuma mudança de backend.

---

## PARTE 3 — Disparo semanal (tela JÁ existente)

**Arquivo:** `src/components/marketing/MassTemplateDispatcher.tsx` (NÃO recriar a tela)

Hoje: `MetaTemplate.components` não modela carrossel; `buildComponentsForRecipient` trata só header simples/body/botões URL. Mudanças:

1. Estender a tipagem local de `components` para incluir `CAROUSEL` + `cards[]`.
2. Detectar `selectedTemplate` do tipo carrossel (`isCarousel`).
3. Quando carrossel, renderizar um bloco por card pedindo:
   - **Upload da imagem DAQUELA SEMANA** (diferente da amostra). Reaproveita o padrão atual `handleHeaderFileUpload` (sobe para Supabase Storage `chat-media`, gera URL pública). Estado por card: `weekCardImages[cardIndex] = publicUrl`.
   - Variáveis de texto do body do card e suffix de URL, se houver (reaproveita o mecanismo de variáveis estático/dinâmico já existente).
4. `buildComponentsForRecipient`: quando carrossel, montar o componente `carousel` com `cards` indexados por `card_index`, cada card com header `image` por `link` (URL pública da semana) + body params + button param. Se o BODY-bubble tiver variáveis, incluir também o `{ type: "body", parameters: [...] }` de topo.
5. Reaproveitar TODA a segmentação de público, cooldown, rate-limit/anti-ban e fila já existentes (sem mudanças). O carrossel só altera o conteúdo de `components`/`template_params`.

**Sobre Resumable Upload no disparo:** a Meta aceita a imagem de envio por `link` público diretamente (nossas imagens já ficam no Storage). Por isso NÃO é necessário re-upload resumable no envio — usamos `link`. (Caso futuramente se queira `id` de mídia, daria para chamar `meta-whatsapp-upload-header`/upload de mídia, mas é desnecessário e mais lento.)

**Edge function `meta-whatsapp-send-template`:** a interface `SendTemplateRequest` JÁ suporta `cards` com `card_index` e `components`. Confere com o que a Meta exige. **Único ajuste a verificar/garantir:** que o array `components` (incluindo o objeto `carousel`) seja repassado intacto para `template.components` — o código atual já faz `template.components = components`, então funciona tanto no envio único quanto no bulk via fila (`template_params`). Sem mudança de código prevista; apenas validar no teste.

### JSON EXATO do envio (imagens da semana)

```json
{
  "phone": "5533999999999",
  "templateName": "promo_semanal",
  "language": "pt_BR",
  "whatsappNumberId": "<id>",
  "components": [
    { "type": "body", "parameters": [ { "type": "text", "text": "Maria" } ] },
    {
      "type": "carousel",
      "cards": [
        {
          "card_index": 0,
          "components": [
            { "type": "header", "parameters": [
              { "type": "image", "image": { "link": "https://<storage>/semana1_card0.jpg" } } ] },
            { "type": "body", "parameters": [ { "type": "text", "text": "R$ 179" } ] },
            { "type": "button", "sub_type": "url", "index": "0",
              "parameters": [ { "type": "text", "text": "tenis-x" } ] }
          ]
        },
        {
          "card_index": 1,
          "components": [
            { "type": "header", "parameters": [
              { "type": "image", "image": { "link": "https://<storage>/semana1_card1.jpg" } } ] },
            { "type": "body", "parameters": [ { "type": "text", "text": "R$ 129" } ] },
            { "type": "button", "sub_type": "url", "index": "0",
              "parameters": [ { "type": "text", "text": "sandalia-y" } ] }
          ]
        }
      ]
    }
  ]
}
```

(O objeto `body` de topo só entra se o bubble text tiver variáveis. `card_index` deve seguir a ordem dos cards aprovados. Cada card repete a mesma estrutura de header/body/button.)

---

## Tabelas / colunas

Nenhuma tabela nova é estritamente necessária — o template vive na Meta e é lido por `meta-whatsapp-get-templates`; o disparo reusa `dispatch_history`/`dispatch_recipients`/`meta_message_queue` atuais.

Opcional (se quiser memorizar imagens da semana para reuso/histórico): uma tabela leve `carousel_dispatch_assets` (template_name, card_index, image_url, week). **Recomendo não criar agora** — manter o conteúdo da semana só no Storage + no payload, conforme o fluxo atual de header media. Decido conforme sua preferência.

---

## Resumo de arquivos afetados

- `src/components/MetaTemplateCreator.tsx` — criação do carrossel (Parte 1) + preview na listagem (Parte 2).
- `src/components/marketing/MassTemplateDispatcher.tsx` — upload da imagem da semana por card + montagem do payload carousel (Parte 3).
- `supabase/functions/meta-whatsapp-create-template/index.ts` — sem mudança (passthrough).
- `supabase/functions/meta-whatsapp-upload-header/index.ts` — sem mudança (reuso para handles de amostra).
- `supabase/functions/meta-whatsapp-send-template/index.ts` — sem mudança prevista; apenas validar que `cards` chega intacto.
- `supabase/functions/meta-whatsapp-get-templates/index.ts` — sem mudança (já devolve JSON completo).

Nada existente é quebrado: templates padrão seguem o caminho atual; o carrossel é um ramo novo acionado só quando o tipo é carrossel.