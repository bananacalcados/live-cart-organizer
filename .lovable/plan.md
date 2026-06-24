# Carrossel Meta: chat completo, identificação de card e ajuste de imagem

Três problemas para resolver, com base na análise do que foi enviado e do que a Meta documenta.

## Diagnóstico

1. **Chat não mostra o template completo.** Ao enviar, a função `meta-whatsapp-send-template` grava só o texto do balão ("Olá Matthews teste de carrossel"). O `renderTemplateMessage` ignora o componente `CAROUSEL`, então fotos/cards/botões não são salvos nem renderizados. No banco a mensagem ficou como `media_type: text` sem nenhuma estrutura de cards.

2. **Não identificou o card clicado.** A resposta recebida gravou `button_payload = "Quero esse"` (o texto do botão), e não `bcq:<dispatch>:<card>`. Ou seja, o payload customizado não chegou de volta. O webhook já sabe ler `bcq:` — o problema é garantir que TODO caminho de envio injete o payload e confirmar que a Meta o devolve (precisa de 1 reteste).

3. **Imagem desproporcional na miniatura.** A Meta renderiza o card do carrossel em **1:1 (quadrado, recomendado 1024×1024)** ou 1.91:1 — nunca retrato. A foto subida era retrato/vertical, então o app oficial faz *center-crop* e corta o produto. Solução: um recorte feito por humano que gere a imagem **1:1 centralizada** antes de subir.

## Proporção correta (resposta à sua pergunta)

A miniatura do card no WhatsApp é **quadrada 1:1** (formato nativo/recomendado, 1024×1024). O que a pessoa enxerga na miniatura É a própria imagem que subimos; ao clicar, abre a mesma imagem maior. Então não existe "miniatura vs original" separados — a correção é compor uma imagem 1:1 bem centralizada. O cropper vai mirar 1:1.

## Plano

### Parte 1 — Mostrar o carrossel inteiro no chat
- Migration: adicionar coluna `template_payload jsonb` em `whatsapp_messages` (guarda `{type:'carousel', body, cards:[{image_url, body, buttons:[{type,text,url}]}]}`).
- `meta-whatsapp-send-template` e `dispatch-worker`: ao enviar carrossel, montar a estrutura resolvida (imagens + textos + botões já com variáveis preenchidas) e gravar em `template_payload`. Manter o texto atual como fallback.
- Novo componente `CarouselMessageBubble` no `ChatView`: quando `template_payload.type === 'carousel'`, renderiza os cards (foto 1:1, texto e botões como badges) num mini-carrossel horizontal.
- `Message` (ChatTypes) + `useChatMessages` passam a trazer `template_payload`.

### Parte 2 — Identificar qual card foi clicado
- Garantir injeção do payload `bcq:<id>:<cardIndex>` em todos os caminhos (dispatcher de teste já faz; conferir dispatch-worker e automação).
- Webhook (`meta-whatsapp-webhook`): já resolve `bcq:` → nome do produto. Reforçar para gravar índice/produto e exibir "🛒 Quero Esse → Card N: Produto" + miniatura do card referido, quando possível.
- Fallback: se vier resposta de botão sem `bcq` mas existir um carrossel recente enviado àquele número, prefixar a mensagem com o contexto do carrossel para o vendedor não ficar cego.
- Reteste obrigatório após o ajuste para confirmar que a Meta devolve o payload customizado em botões de carrossel.

### Parte 3 — Ajuste humano da imagem (1:1)
- Adicionar lib `react-easy-crop`.
- Novo `ImageCropDialog` reutilizável: pan + zoom + arraste, recorte fixo **1:1**, exporta JPEG 1024×1024 e sobe pro storage `chat-media`.
- Plugar nos dois fluxos de upload do card (Subir do PC e Subir do site/Shopify) no `AutomationFlowBuilder` e no `MassTemplateDispatcher`: depois de escolher a imagem (PC ou Shopify), abre o cropper antes de definir a `headerUrl`.

## Detalhes técnicos
- Arquivos: `supabase/migrations/*` (nova coluna), `supabase/functions/meta-whatsapp-send-template/index.ts`, `supabase/functions/dispatch-worker/index.ts`, `supabase/functions/meta-whatsapp-webhook/index.ts`, `src/components/chat/ChatView.tsx` (+ novo `CarouselMessageBubble.tsx`), `src/components/chat/ChatTypes.ts`, `src/hooks/chat/useChatMessages.ts`, `src/components/ImageCropDialog.tsx` (novo), `src/components/marketing/AutomationFlowBuilder.tsx`, `src/components/marketing/MassTemplateDispatcher.tsx`.
- `template_payload` é nullable; mensagens antigas seguem funcionando.
- Cropper só altera o que é enviado (frontend/apresentação) — não muda regra de negócio.
