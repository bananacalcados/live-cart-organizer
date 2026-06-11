
# Reformulação do Link Pages (Marketing)

## Como funciona hoje (análise)
- **Tabelas:** `link_pages` (página), `link_page_items` (botões), `link_page_visits` (cliques/views com UTM).
- **Editor:** `src/components/marketing/LinkPageManager.tsx` — cria página, adiciona itens manuais (link, whatsapp, endereço, catálogo, instagram...), escolhe gradiente de uma lista fixa (visual monótono), e seleciona produtos do catálogo **manualmente** via Shopify Storefront API.
- **Página pública:** `src/pages/LinkPageView.tsx` (rota `/l/:slug`) — botões pequenos estilo Linktree antigo, grid de produtos do catálogo, registra view/click direto do client.
- **Limitações:** botões pequenos; cores fixas; WhatsApp/catálogo digitados na mão; sem status de instância; sem QR/vendedora; sem captura de lead; produtos desatualizam.

Já existe na base o que precisamos reaproveitar:
- `whatsapp_numbers` com `is_online`, `last_health_check`, `provider` (meta/zapi/wasender/uazapi) e telefones por provider.
- `zapi-instance-health-check` (cron de status) + webhooks `wasender-webhook`, `uazapi-webhook`, `meta-whatsapp-webhook`.
- `shopify-webhook` (HMAC, orders/paid) e `src/lib/shopify.ts` (Storefront API com variants/quantidade/imagens).
- `ad_leads` (leads) e `customers_unified` (clientes) + `pos_sellers` para vínculo de vendedora.

---

## Parte 1 — Visual (botões grandes, logo, cores)
- Novo render no `LinkPageView.tsx`: **cards grandes** estilo o modelo da direita (imagem de fundo + título sobreposto + descrição), em vez de botões finos. Tipo de card por item (`card` grande vs `compact`).
- **Header de impacto:** logo Banana em destaque, com opção de banner/cor de marca.
- **Paletas vibrantes:** substituir os gradientes fixos por presets vivos da marca + opção de cor de destaque por botão, fugindo do padrão monótono atual.
- Catálogo de produtos redesenhado para "vender": cards maiores com preço, selo de novidade/desconto e CTA claro.

## Parte 2 — Instâncias de WhatsApp automáticas
- O editor **puxa as instâncias** de `whatsapp_numbers` (todas os providers) automaticamente — você só:
  - define o **nome do botão** (ex.: "Whats Pérola" → outro nome),
  - liga/desliga visibilidade (**ocultar** instância no link),
  - escolhe a **mensagem pré-configurada** que o cliente envia.
- O link gera automaticamente o `wa.me/<telefone-da-instância>?text=<mensagem>` com base no telefone real do provider (meta/zapi/wasender/uazapi).
- **Status online em tempo real:** a página pública só mostra botões de instâncias `is_online = true`. Estendo o cron `zapi-instance-health-check` para cobrir todos os providers e, nos webhooks de status (`wasender-webhook`/`uazapi-webhook`), atualizo `is_online=false` quando a instância cair → botão some/desativa sozinho.

## Parte 3 — Catálogo Shopify auto-atualizado (sem varrer a loja toda)
- Nova tabela `link_page_catalog_products`: só os produtos **marcados** para aparecer no link (não a loja inteira).
- Edge function `link-page-catalog-sync`: importa/atualiza esses produtos aplicando regras:
  - **só com foto** cadastrada;
  - **grade de tamanhos ≥ 60% completa** (calculada das variants disponíveis vs total da grade) → abaixo disso o produto **sai** automaticamente.
- Modo de seleção por página: **Lançamentos**, **Mais vendidos** ou **Todos** (via coleções Shopify).
- **Tempo real:** estendo `shopify-webhook` (orders/paid) para recalcular a grade **apenas dos produtos marcados** vendidos e remover/reativar conforme o 60%. Sem varredura global.

## Parte 4 — Link Pages por vendedora (QR + captura + rastreamento)
- Adiciono `seller_id` em `link_pages` (vínculo opcional com `pos_sellers`).
- **QR Code** gerado no editor para impressão em crachá.
- **Gate de captura (opcional por página):** ao escanear, antes de ver os botões a pessoa registra **Nome + Telefone**:
  - cliente existente → marca no cadastro origem "cadastro por vendedora";
  - lead novo → salvo em `ad_leads` com `source=link_page` + **tag do link page** e vendedora.
- Cada clique grava `seller_id` + identidade do lead em `link_page_visits` (antifraude: cliques contam por lead registrado).
- **Painel no Dashboard Geral do PDV:** progresso por vendedora (cliques em grupo VIP / live / avaliação) e % de conclusão da tarefa de captação — reaproveitando o componente de progresso de tarefas já existente.

## Parte 5 — Preenchimentos automáticos
- Botão **Site** já vem com `https://bananacalcados.com.br/`.
- Botão **WhatsApp** já vem com link redirecionador + mensagem pré-configurada do número da instância.
- Botões de **redes sociais** (Instagram, TikTok, etc.), **Localização das lojas** (Google Maps) e **Grupos VIP** como tipos prontos.

## Parte 6 — Captação de dados / analytics
- Por botão: total de cliques, taxa de engajamento (cliques/views), e (no WhatsApp) a mensagem automática configurada.
- Dashboard de analytics na página, com recorte por vendedora quando aplicável.

---

## Mudanças técnicas (resumo)
**Migração de banco:**
- `link_pages`: + `seller_id`, `require_lead_capture` (bool), `catalog_mode` (lancamentos/mais_vendidos/todos), paleta/branding em `theme_config`.
- `link_page_items`: + `whatsapp_number_id`, `prefill_message`, `card_style`, `social_network`.
- nova `link_page_catalog_products` (produtos marcados + grade % + ativo).
- nova `link_page_leads` (ou reuso de `ad_leads` com tag) para captura.
- `link_page_visits`: + `seller_id`, `lead_id`/`lead_phone`.
- GRANTs + RLS (público lê páginas/itens ativos e insere visitas/leads; autenticado gerencia).

**Edge functions:**
- `link-page-catalog-sync` (nova) — importa/recalcula produtos marcados.
- estender `shopify-webhook` — recalcula grade dos produtos marcados em venda.
- estender `zapi-instance-health-check` + webhooks — status online multi-provider.
- `link-page-capture-lead` (nova) — registra nome/telefone, roteia para cliente/lead.

**Frontend:**
- `LinkPageManager.tsx` — novo editor (instâncias automáticas, catálogo por regras, QR, vendedora, captura opcional).
- `LinkPageView.tsx` — novo visual (cards grandes, header com logo, gate de captura, botões filtrados por instância online).
- Novo painel no Dashboard Geral do PDV para progresso por vendedora.

---

## Sugestão de faseamento
1. **Migração de banco** (estruturas acima).
2. **Visual novo** (editor + página pública com botões grandes, logo, paletas).
3. **Instâncias automáticas + status online**.
4. **Catálogo Shopify por regras + webhook de estoque**.
5. **Vendedora + QR + captura de leads + painel PDV**.

Posso começar pela **Parte 1 (visual)** já entregando impacto rápido, ou pela **migração + estrutura** para destravar tudo. Qual prefere?
