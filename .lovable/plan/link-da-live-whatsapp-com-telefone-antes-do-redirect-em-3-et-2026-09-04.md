# Link da Live → WhatsApp com telefone antes do redirect (em 3 etapas)

Objetivo: transformar o `/zap/:slug` numa ponte que **pede o WhatsApp da cliente antes** de abrir o WhatsApp da loja, para que fbc/fbp/IP/navegador fiquem amarrados ao telefone dela desde o clique — e cheguem completos no pixel e no CAPI quando ela pagar.

As etapas são independentes e entregues uma por vez. Cada uma fica funcionando sozinha antes de começar a próxima.

---

## Etapa 1 — Tela única de telefone (atrito mínimo)

**O que a cliente vê**
- Uma única tela, fundo verde WhatsApp, sem logo de app, sem menu, sem "baixe o aplicativo".
- Texto curto: **"Digite seu WhatsApp pra falar com a gente"**.
- Um campo só, máscara `(33) 99195-5003`, teclado numérico no celular, foco automático.
- Botão verde grande **CONFIRMAR**. Ao confirmar, abre o WhatsApp da loja com a frase pronta ("Oii, vim da Live, pode me ajudar? #CÓDIGO").
- O número fica lembrado no aparelho: na próxima live a tela já vem preenchida e basta tocar em CONFIRMAR (com um "não é você? trocar número").

**Nuances tratadas**
- Validação na hora: 10 ou 11 dígitos, DDD brasileiro válido (lista dos DDDs existentes), injeção automática do 9º dígito quando faltar (padrão E.164 do projeto). Mensagem de erro curta embaixo do campo, sem travar.
- Dentro do Instagram (webview iOS/Android) continua o tratamento atual: intent no Android, botão manual no iOS — mas só **depois** do CONFIRMAR.
- Link pausado / não encontrado seguem com as telas atuais.
- O clique continua sendo registrado **antes** da digitação (o fbc/fbp/IP são capturados assim que a página abre). Quem sai sem confirmar já deixa o clique gravado — base para a Etapa 3.
- Não existe mais redirect automático sem confirmação: a Meta vê a mesma landing, só muda o tempo até o wa.me.

**Entrega:** página `/zap/:slug` nova + função de redirect aceitando o telefone e gravando-o no clique. Painel do link (Eventos > Live > Link WhatsApp) mostra coluna "Telefone digitado" nos cliques.

---

## Etapa 2 — Casamento por telefone com código como reserva

**Regra de ouro:** o telefone digitado vira a chave principal; o código curto vira a segunda chave. **Cada confirmação gera um código novo**, ligado ao telefone digitado — então, se a cliente chegar de um número diferente do que digitou, o código na mensagem revela qual telefone ela informou, e os dois números ficam ligados.

**Como o casamento passa a funcionar quando a mensagem chega**
1. **Telefone bate** (DDD + 8 últimos dígitos, regra padrão do projeto): casa direto com o clique mais recente daquele telefone. Não depende do código.
2. **Telefone não bate, mas o código bate**: casa pelo código. Grava no clique: `telefone_digitado` (o que ela informou) e `telefone_real` (o que chegou). A memória de atribuição é gravada nos **dois** telefones, para o pagamento ser atribuído independente de qual número for usado no pedido.
3. **Nem telefone nem código** (apagou a frase): mantém o fallback atual por janela de tempo/contexto na mesma instância — agora restrito a cliques **sem telefone confirmado**, para não roubar o clique de outra pessoa.
4. **Telefone e código discordam entre si** (código pertence a outro clique): o **código vence** (é a prova do clique real), e o clique do telefone fica marcado como "divergente" para conferência.

**Nuances tratadas**
- Número de terceiro digitado de propósito ou errado: fica registrado como `telefone_digitado`, nunca sobrescreve o cadastro do número que realmente chegou.
- Mesma cliente clica várias vezes: cada clique tem seu código; casa sempre o mais recente sem casamento, os anteriores ficam como "repetidos" (não contam duas vezes na atribuição).
- Alimenta a mesma memória de atribuição por telefone usada pelo checkout, área de membros e CAPI — o Purchase já sai com fbc, fbp, IP, user-agent e telefone hasheado. Só é preciso garantir que o pagamento da Live (confirmação de pagamento / evento de compra) consulte essa memória pelo telefone do pedido **e** pelo telefone digitado.

**Entrega:** trigger de casamento reescrito, colunas novas no clique, painel mostrando o método de casamento (telefone / código / tempo / divergente).

---

## Etapa 3 — Quem clica e não manda mensagem vira lead

**Regra:** toda confirmação de telefone no `/zap` gera (ou atualiza) um **lead de Live Shopping** do evento, mesmo que a pessoa nunca mande mensagem. Sem nome (fica "Lead WhatsApp" até ser identificado), mas com telefone, fbc, fbp, IP, navegador, UTMs e link de origem.

**Nuances tratadas**
- Sem duplicar: se já existe lead do mesmo evento com o mesmo telefone (DDD + 8 dígitos), só atualiza os dados de atribuição — não cria outro.
- Quando a mensagem chegar depois (Etapa 2 casa), o lead recebe o nome do contato do WhatsApp automaticamente.
- Se a cliente comprar, o lead é marcado como convertido (mesmo caminho dos leads de typebot/landing page, que já cruzam compra por telefone).
- Quem sai da tela **sem confirmar** não vira lead (não temos telefone) — continua só como clique anônimo com fbc/fbp, visível no painel do link como "cliques sem confirmação".
- Origem do lead: `live_whatsapp_link`, com o slug do link, para separar dos leads de typebot/LP no painel de Marketing > Leads e nos cohorts do evento.
- Lista "Clicou e não falou": no painel do link, filtro pronto com esses leads para retomada (disparo respeita opt-out, banidos e cotas, como todo disparo).

**Entrega:** criação/atualização do lead na confirmação, marcação de conversão, filtro no painel do link.

---

## Detalhes técnicos

**Etapa 1**
- `src/pages/LiveWhatsAppRedirectPage.tsx`: estado `ask_phone` antes de `redirecting`; máscara e validação com DDDs válidos + regra do 9º dígito (reutilizar normalização de `src/lib` de telefone); `localStorage` chave `bc_zap_phone`.
- `supabase/functions/live-whatsapp-redirect/index.ts`: passa a ter dois passos — `GET` registra o clique (como hoje, sem gerar wa.me) e devolve `click_id`; `POST {click_id, phone}` valida, grava `entered_phone` + `phone_key` (DDD+8), gera código e devolve `wa_url`.
- Migração: `ALTER TABLE live_whatsapp_clicks ADD COLUMN entered_phone text, entered_phone_key text, confirmed_at timestamptz`; índice em `(entered_phone_key, created_at desc)`.

**Etapa 2**
- Migração: colunas `real_phone text`, `divergent boolean default false`, `superseded boolean default false` em `live_whatsapp_clicks`.
- Reescrever `public.live_zap_match_incoming()`: ordem telefone → código → tempo/contexto (apenas `entered_phone_key IS NULL`); `upsert_meta_attribution` para `entered_phone` e para `NEW.phone` quando diferentes; marcar cliques anteriores do mesmo telefone como `superseded`.
- `livete-payment-confirmation` / disparo de Purchase CAPI: buscar memória de atribuição pelo telefone do pedido e, se vazio, pelo `entered_phone` do clique casado.

**Etapa 3**
- Na função de redirect (`POST`): upsert em `event_leads` (`source = 'live_whatsapp_link'`, `link_slug`, `name = 'Lead WhatsApp'`, `phone`, `phone_suffix`, UTMs, `metadata` com fbc/fbp/ip/ua/click_id), chave `(event_id, phone_suffix)`.
- Trigger de casamento atualiza `name` do lead com o nome do contato (`chat_contacts`) quando disponível.
- `LiveWhatsAppLinkConfig.tsx`: aba/tabela de cliques com filtros "confirmou e falou", "confirmou e não falou", "sem confirmação"; e método de casamento.

Nada é alterado no comportamento dos modos Instagram/Direct da Live nem nos templates Meta.
