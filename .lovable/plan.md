# Auditoria (somente leitura) — instalar o sistema do zero para outra empresa

Nenhum código foi alterado. Aprovar este documento não dispara implementação: ele é só o inventário pedido. Valores de segredos não são mostrados.

## 1. Estrutura do banco no código
a) `supabase/migrations`: **943 arquivos**, de 08/02/2026 a 01/10/2026. **Não recriam o banco inteiro do zero de forma confiável**:
- o histórico é incremental e acumulado;
- há objetos criados fora das migrações (item c);
- 46 migrações citam a referência deste projeto.

O banco real tem 400 tabelas, 25 views, 492 funções, 299 gatilhos e 594 políticas. Não foi feita uma comparação objeto por objeto entre as migrações e o banco.

b) `drizzle/`: o `schema.ts` é um arquivo vazio, só para a ferramenta funcionar. `drizzle/migrations` tem 5 migrações recentes (0000 a 0004: links VIP, busca do chat, grade, `get_conversations_since`), aplicadas pela ferramenta de migração do Lovable. São **mudanças reais no banco** e ficam fora de `supabase/migrations`. Uma instalação nova precisa aplicar as duas pastas.

c) Fora das migrações:
- **Tarefas agendadas:** 46 no banco, mas só 12 aparecem em 11 migrações.
- **Pastas de arquivos:** 11 no banco, só 3 em migração.
- Extensões `pg_cron`, `pg_net`, `pg_trgm` e `unaccent` estão em migração.
- Índices e funções criados por SQL direto: não confirmado objeto a objeto.

d) Dados iniciais em migrações: 164 arquivos têm `INSERT`. Exemplos:
- `dre_parameters` (`20261001012811_...sql`);
- `app_settings` (`20260922234312_...sql`, `20260923183456_...sql`);
- `fiscal_sequences` (`20260507202140_...sql`).

Nenhum `INSERT` de `user_roles`, `companies` ou `pos_stores` foi encontrado. Os demais 164 arquivos não foram revisados um a um em busca de dados próprios da Banana.

## 2. Tarefas agendadas
- **46** no banco; **34** chamam a URL fixa deste projeto dentro do SQL.
- Só 12 estão definidas em migrações. As outras 34 existem apenas no banco atual.

## 3. Armazenamento (pastas de arquivos)
- No banco: `whatsapp-media`, `marketing-attachments`, `chat-media`, `payment-receipts`, `product-images`, `media`, `fiscal-certificates`, `event-landing-assets`, `financial-receipts`, `fiscal-documents`, `boletos` (11).
- Criadas em migração: só `media`, `whatsapp-media` e `financial-receipts`. As outras 8 foram criadas à parte.

## 4. Fixo da Banana fora do banco
a) URL do backend escrita à mão: 46 funções, `index.html` (1), `extension/content.js` (1), `public/*.js` (2), `src` (2, fora do client gerado).
b) Domínios: `bananacalcados.com.br` em ~106 arquivos; `lovable.app` em ~50.
c) Outros dados fixos:
- lojas Shopify `banana-calcados.myshopify.com` (2) e `ftx2e2-np.myshopify.com` (4);
- conta de anúncios `2253897104825255` (`meta-ads-sync`);
- dataset CAPI `1346445220878187` (`meta-capi-offline*`);
- 1 arquivo com CNPJ formatado;
- "Pérola" em 39 arquivos;
- o Pixel vem do segredo `VITE_META_PIXEL_ID` e por página; não foi encontrado ID de Pixel fixo no código.

d) Marca: título "GESTOR BANANA", descrição e autor no `index.html`; `public/manifest.json`; textos de IA citando "Banana Store/Brasil" (ex.: `ai-group-content`, `ai-vip-strategy`).
e) Páginas só da Banana: `/banana-verao`, `/banana-verao-gv`, `/live-consumidor`, `/live-ortopedicos`, `/live-ortopedicos-abril`, `/lp/conforto`.

## 5. Segredos lidos pelas funções (só nomes)
- **Backend:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_PUBLISHABLE_KEY.
- **IA:** LOVABLE_API_KEY (**18 funções**), ANTHROPIC_API_KEY, OPENAI_API_KEY.
- **Meta:**
  - WhatsApp: META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID, META_WHATSAPP_BUSINESS_ACCOUNT_ID, META_WHATSAPP_VERIFY_TOKEN;
  - Página/Instagram: META_PAGE_ACCESS_TOKEN, META_INSTAGRAM_USERNAME, INSTAGRAM_USERNAME, IG_USERNAME;
  - Aplicativo: META_APP_ID, META_APP_SECRET;
  - Anúncios: META_ADS_ACCESS_TOKEN, META_ADS_ACCOUNT_ID;
  - CAPI: META_CAPI_ACCESS_TOKEN, META_CAPI_TOKEN, META_CAPI_INTERNAL_SECRET, META_OFFLINE_CAPI_TOKEN;
  - Testes: META_TEST_EVENT_CODE, META_CAPI_TEST_EVENT_CODE, META_OFFLINE_TEST_EVENT_CODE.
- **WhatsApp não oficial:** ZAPI_TOKEN, ZAPI_INSTANCE_ID, ZAPI_CLIENT_TOKEN, UAZAPI_SUBDOMAIN, UAZAPI_ADMIN_TOKEN, WASENDER_API_TOKEN.
- **Shopify:** SHOPIFY_STORE_DOMAIN, SHOPIFY_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_WEBHOOK_SECRET.
- **Pagamentos:**
  - Mercado Pago: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_PUBLIC_KEY, MERCADOPAGO_WEBHOOK_SECRET, MERCADOPAGO_PLATFORM_ID, MERCADOPAGO_INTEGRATOR_ID, MP_POINT_ACCESS_TOKEN;
  - Pagar.me: PAGARME_SECRET_KEY, PAGARME_PUBLIC_KEY;
  - AppMax: APPMAX_ACCESS_TOKEN;
  - Vindi: VINDI_API_KEY;
  - PayPal: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL;
  - AustPay: AUSTPAY_API_KEY, AUSTPAY_MERCHANT_ID, AUSTPAY_ENV, AUSTPAY_PROVIDER, AUSTPAY_WEBHOOK_SECRET.
- **Yampi:** YAMPI_USER_TOKEN, YAMPI_USER_SECRET_KEY, YAMPI_STORE_ALIAS, YAMPI_ALIAS, YAMPI_API_TOKEN.
- **ERP e frete:** TINY_ERP_TOKEN, TINY_APP_CLIENT_ID, TINY_APP_CLIENT_SECRET, FRENET_TOKEN, FRENET_WEBHOOK_TOKEN, MELHOR_ENVIO_TOKEN, CORREIOS_EMPRESA_CODIGO, CORREIOS_EMPRESA_SENHA.
- **Fiscal e outros:** BRASILNFE_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, MCP_AGENT_KEY, CASHBACK_INTEGRATION_SECRET, AGENTE2_PAGAMENTO_CONFIRMADO, VITE_META_PIXEL_ID.

## 6. Primeira instalação
- **Primeiro administrador:** não existe processo. Nenhuma migração cria um papel de administrador, e `admin-create-user` exige já haver um admin logado. Hoje seria preciso inserir à mão em `user_roles`.
- **Linhas iniciais necessárias:** pela leitura do código (não foi testado com banco vazio), `companies`, `pos_stores`, `app_settings` (várias chaves), `dre_parameters` (id 1), `fiscal_sequences`, `whatsapp_numbers` e um vínculo de usuário a loja/vendedora.
- **Assistente de configuração inicial:** não existe.

## 7. Entradas externas (o endereço muda em outra instalação)
- **Meta:** `meta-whatsapp-webhook`, `meta-messenger-webhook`.
- **WhatsApp não oficial:** `uazapi-webhook`, `zapi-webhook`, `wasender-webhook`.
- **Pagamentos:** `payment-webhook`, `pagarme-webhook`, `appmax-webhook`, `appmax-install`, `paypal-webhook`, `point-webhook`, `austpay-webhook`.
- **Lojas e pedidos:** `shopify-webhook`, `shopify-oauth-callback`, `yampi-webhook`, `legacy-order-webhook`, `criar-pedido-externo`.
- **Fiscal e frete:** `brasilnfe-webhook`, `shipment-frenet-webhook`.
- **Outros:** `telegram-financial-webhook`, `mcp-server`.
- **Links públicos:** `live-redirect`, `live-whatsapp-redirect`, `vip-go`, `group-redirect-link`, `shipment-tracking-public`.

## 8. Tamanho
- Edge functions: **300**.
- Tabelas: **400** (mais 25 views e 492 funções).
- Migrações: **943** (`supabase/migrations`) + **5** (`drizzle/migrations`).
- Tarefas agendadas: **46**.
- Pastas de arquivos: **11**.
