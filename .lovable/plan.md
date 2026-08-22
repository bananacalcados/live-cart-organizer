# Origem do lead por link/anúncio (nova camada em Marketing > Leads)

A ideia tem base e o dado já existe em parte. Auditei o que está gravado hoje:

- Leads de typebot: 4.953 registros, 4.902 (99%) já têm `utm_source`, `utm_medium` e `utm_campaign` gravados — e o `utm_campaign` é o **ID da campanha da Meta** (ex.: `120250852121330067`).
- O `typebot_id` (ou seja, qual link) também já está gravado em todo lead e é espelhado no log que alimenta o painel de Leads.
- O que **não** existe hoje: conjunto de anúncio e anúncio (`adset`/`ad`). Esses campos nunca foram capturados, então esse nível **não é recuperável retroativamente** — só passa a existir daqui pra frente.

Ou seja: dá pra entregar retroativamente "qual link" e "qual campanha", e daqui pra frente "qual conjunto / qual anúncio" — sem precisar criar um link por conjunto.

## O que vai ser feito

### 1. Capturar a camada que falta (daqui pra frente)

Nas páginas públicas de typebot e de landing page de evento, passar a ler e enviar também:
- `utm_content` (conjunto de anúncio) e `utm_term` (anúncio);
- um parâmetro livre `?tag=` para quando você quiser marcar o link manualmente (ex.: `?tag=conjunto-a`);
- o slug do link usado (`livefinalabril`), já resolvido no back.

Com as macros dinâmicas da Meta (`{{adset.name}}`, `{{ad.name}}`, `{{adset.id}}`, `{{ad.id}}`) num único link, você não precisa de link diferente por conjunto — mas se preferir links diferentes, o `tag`/slug cobre isso também.

### 2. Guardar esses campos

Adicionar `utm_content`, `utm_term` e `link_tag` na tabela de leads de evento e propagar no espelho que o painel lê. Nada é removido nem renomeado.

### 3. Nova sub-camada no painel (sem mexer no que existe)

Na aba Leads, ao clicar num canal de captação (ex.: "Evento / Live (Typebot)"), abre um detalhamento novo listando, por link / campanha / conjunto / anúncio:

- leads captados
- leads novos (primeira captação de todos os tempos naquele link)
- leads convertidos
- taxa de conversão
- receita atribuída

Ranking ordenável por conversão ou por receita — que é exatamente a pergunta "qual conjunto traz venda, não só lead".

O ranking de canais atual, os números totais e a lógica de atribuição por telefone (primeira captação de todos os tempos) continuam **idênticos**. É só uma camada a mais dentro do canal.

### 4. Retroativo

Backfill que preenche o link (slug do typebot) e a campanha para os ~4.900 leads já existentes, a partir do `typebot_id` e do `utm_campaign` já gravados nos metadados. Assim o novo painel já nasce com histórico de link e campanha. Conjunto/anúncio ficam vazios para o histórico e passam a preencher nos leads novos.

## Detalhes técnicos

- Migração: colunas `utm_content`, `utm_term`, `link_tag` em `event_leads` (+ índice por `typebot_id`/`utm_campaign`); backfill em `lp_leads.metadata` com `typebot_slug` a partir de `event_typebots`.
- `src/pages/public/EventTypebotView.tsx` e `EventLandingView.tsx`: enviar os novos parâmetros no `event-lead-capture`.
- `supabase/functions/event-lead-capture/index.ts`: persistir os novos campos e o slug; espelhar no `lp_leads.metadata`.
- `supabase/functions/marketing-leads-dashboard/index.ts`: novo modo `breakdown` (por `link`, `campaign`, `adset`, `ad`) reaproveitando o mesmo conjunto de leads/vendas já calculado — sem alterar o cálculo dos canais.
- `src/components/marketing/LeadsAnalyticsDashboard.tsx`: modal/seção de detalhamento com a tabela e os seletores de dimensão.
