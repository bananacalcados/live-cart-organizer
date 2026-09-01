# Modo WhatsApp da Live: sem template automático + link redirecionador para o WhatsApp

## Resposta curta às perguntas

- **Desligar o template automático no modo WhatsApp:** simples, é um `if` no disparo que roda quando a cliente confirma o pedido na Área de Membros. O botão manual "enviar template" no Kanban continua funcionando.
- **Pegar fbc/fbp de quem clicou:** sim, é possível. O link redirecionador roda no nosso domínio (`checkout.bananacalcados.com.br`), onde o Pixel já está instalado, então dá para ler o cookie `_fbp` e o `fbclid` da URL (vira `fbc`). Também capturamos UTMs, user-agent e IP.
- **Saber quem veio da Live e ligar ao WhatsApp:** aqui está o detalhe. No momento do clique não sabemos o telefone da pessoa. Ela só aparece para nós quando a mensagem chega no WhatsApp. Para ligar as duas pontas, o link gera um **código curto único** que vai dentro da mensagem pré-preenchida:

```text
Oii, vim da Live, pode me ajudar? #K7M2
```

Quando a mensagem chega no webhook, lemos o código, achamos o clique correspondente (com fbc/fbp) e gravamos tudo no telefone dela. Sem o código, só saberíamos "alguém clicou" e "alguém mandou 'vim da Live'", sem certeza de que é a mesma pessoa. Se a cliente apagar o código, ainda reconhecemos pela frase "vim da Live" e marcamos como lead da live (só sem o fbc/fbp daquele clique).

## O que a cliente vê

1. Está na live, clica no link (ex.: `checkout.bananacalcados.com.br/zap/live`).
2. Página abre por menos de 1 segundo e já redireciona para `wa.me/55DDDNUMERO?text=Oii, vim da Live...#K7M2`.
3. WhatsApp abre com a mensagem pronta; ela só aperta enviar.

## O que a equipe vê

- Na aba **MENSAGEM** do wizard da Live, quando o modo é **WhatsApp**: card "Link da Live para o WhatsApp" com o link pronto, botão copiar, contador de cliques e de conversas iniciadas. Frase pré-preenchida editável (padrão: "Oii, vim da Live, pode me ajudar?"). O número de destino é o da instância WhatsApp configurada no evento.
- Na **Central da Live**, a fila passa a destacar as conversas que vieram pelo link (badge "Veio da Live") e ganha um filtro "Só quem veio da Live". A tag fica gravada por evento, então não depende do período/instância.
- Em **Marketing > Leads**, o contato entra como lead com origem `live_whatsapp_link` e o evento vinculado.

## Atribuição Meta (fbc/fbp)

- No clique: salvamos `fbc`, `fbp`, `fbclid`, UTMs, IP e user-agent junto do código.
- Na chegada da mensagem: gravamos esses sinais na memória de atribuição de 90 dias do telefone (`saveMetaAttribution`, origem `live_whatsapp_link`). Assim, quando ela pagar (checkout, PDV ou link), o Purchase enviado à Meta via CAPI já sai com o `fbc` daquele clique.
- Limite honesto: se ela chegou na live pelo app do Instagram sem `fbclid` na URL (tráfego orgânico), não existe `fbc` para capturar; nesse caso levamos só `fbp` + UTM + a marcação "veio da Live".

## Detalhes técnicos

**Banco**
- `events`: coluna `wa_link_message` (texto pré-preenchido, default "Oii, vim da Live, pode me ajudar?").
- Nova tabela `live_whatsapp_link_clicks`: `id`, `code` (único, 4 chars), `event_id`, `whatsapp_number_id`, `fbc`, `fbp`, `fbclid`, `utm_*`, `user_agent`, `ip`, `clicked_at`, `matched_phone`, `matched_at`. GRANT para `authenticated` (leitura) e `service_role`.
- Nova tabela `event_live_conversations`: `event_id`, `phone`, `whatsapp_number_id`, `click_id`, `source` (`link_code` | `phrase`), `created_at`. Unique `(event_id, phone)`. RLS para autenticados.

**Edge functions**
- `live-whatsapp-link` (pública, GET): recebe `event` (id ou slug) + query params; busca o evento ao vivo em modo WhatsApp e a instância; grava o clique com código; responde JSON `{ wa_url }`. A página React `/zap/:slug` lê o `_fbp` do cookie e o `fbclid` da URL, chama a função e faz `window.location.replace(wa_url)`.
- Webhooks de entrada (`uazapi-webhook`, `meta-whatsapp-webhook`, `wasender-webhook`): helper compartilhado `_shared/live-link-match.ts` que, em mensagens **incoming** de texto, procura `#[A-Z0-9]{4}` no fim ou a frase "vim da live"; se casar, atualiza o clique, grava `event_live_conversations`, chama `saveMetaAttribution` e cria/atualiza o lead em `lp_leads` (origem `live_whatsapp_link`). Nunca lança erro — atribuição não pode quebrar o recebimento.

**Desligar template automático**
- `livete-start-order/index.ts`: quando `operationMode === 'whatsapp'`, `useMetaTemplate = false` e os blocos automáticos de WhatsApp também não disparam (a cliente vai chegar pelo link e a equipe atende manualmente). Instagram Direct segue igual. O botão manual em `event-order-template-send` não muda.

**Frontend**
- `EventSetupWizard.tsx` (etapa MENSAGEM): card do link quando modo = WhatsApp, com aviso "Neste modo o template não é enviado automaticamente".
- `LiveWhatsAppQueue.tsx`: badge "Veio da Live" e filtro, lendo `event_live_conversations` do evento (com Realtime para aparecer na hora).
- Rota `/zap/:slug` em `App.tsx` (página mínima, sem layout).

## Fora do escopo agora
- Marcar automaticamente a conversa como "arquivada" quando não veio da live (a fila continua com o filtro de período atual; o novo filtro é opcional).
