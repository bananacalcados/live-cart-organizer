# Auditoria (somente leitura) — prontidão para Análise do App Meta

Nenhum arquivo foi alterado. Aprovar este documento não dispara nenhuma implementação: ele é só o inventário pedido.

## 1. Páginas públicas
- Política de Privacidade: **não existe** (nenhuma rota em `src/App.tsx`).
- Termos de Serviço: **não existe**.
- Instruções/endpoint de Exclusão de Dados: **não existe** (nem página, nem callback de exclusão).

## 2. WhatsApp Cloud API
a) **Por instância, na tabela** `whatsapp_numbers`: colunas `access_token`, `business_account_id` (WABA), `phone_number_id`, `provider`, `is_default`, `phone_display`. Leitura do token está bloqueada no front (só service_role e view `whatsapp_numbers_safe`). Não há coluna de empresa/tenant.
b) **Existe**: `src/components/admin/MetaInstanceManager.tsx` (cadastro manual de token, WABA e Phone Number ID).
c) Envio via `graph.facebook.com/v21.0/{phone_number_id}/messages`: `meta-whatsapp-send`, `meta-whatsapp-send-template`, `meta-template-send`, `dispatch-worker`, `automation-dispatch-audience` (+ `_shared/meta-fallback.ts`).
d) `supabase/functions/meta-whatsapp-webhook`: identifica a instância por `value.metadata.phone_number_id` → `whatsapp_numbers.phone_number_id`; se não achar, usa `display_phone_number`.

## 3. Modelos (templates)
- Listar/status: **existe** — `meta-whatsapp-get-templates` (`/{waba}/message_templates`, paginado, motivo de rejeição via `meta_template_status_log`).
- Criar: **existe** — `meta-whatsapp-create-template`, `meta-whatsapp-upload-header` (`/{app}/uploads`); telas `src/components/MetaTemplateCreator.tsx`, `src/components/admin/SimpleTemplatesPanel.tsx`, `CarouselTemplatesLadder.tsx`.
- Status atualizado em tempo real: **parcial** (webhook grava o status no log; o construtor consulta ao vivo).
- Envio para número avulso de teste: **parcial** — há envio de teste em `MassTemplateDispatcher.tsx`, `CampaignBuilder.tsx` e `AutomationFlowBuilder.tsx`; não existe tela dedicada a isso.

## 4. Chat
- Envio livre pela Cloud API: **existe** (`WhatsAppChat.tsx`, `src/pages/Chat.tsx`, `useChatSender.ts` → `meta-whatsapp-send`).
- Mostra o número/instância usado: **existe** (etiqueta da instância + `useConversationInstance`).
- Aviso da janela de 24h: **parcial** (há menções em `WhatsAppChat.tsx`; o bloqueio é feito pelo erro que a Meta devolve).

## 5. Instagram / Live
- Comentários da live:
  - (a) extensão do Chrome `extension/content.js` (Livete Anotador), que lê o texto da página do Instagram, sem usar a API;
  - (b) `instagram-live-sync`: `/{ig_id}/live_media` ou `/me/live_media` com o campo comments (graph.facebook e graph.instagram v25);
  - (c) webhook `meta-messenger-webhook` (`object=instagram`, comentários, DMs, respostas a stories).
- DM: **existe** — `/me/messages` em graph.instagram v25 (`instagram-dm-send`, `-send-buttons`, `-send-bulk-dm`, `-resend-live-dm`, `meta-messenger-send`); resposta privada (`recipient.comment_id`); leitura de conversas por `/me/conversations`.
- Resposta pública a comentário: **existe** — `/{comment_id}/replies` (`instagram-comment-reply`, automação de comentários).
- Live Video API do Facebook: **não existe**.
- Outros: `/me` (v23) em `instagram-account-connect`, `/{media}` e `instagram-list-media`, `instagram-token-refresh`.
- Permissões prováveis, conforme a documentação da Meta (não aparecem no código): `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`; para live_media/webhooks via Facebook também `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_messaging`, `pages_show_list`, `pages_read_engagement`.

## 6. Marketing / Páginas / Catálogo / Leads
- `act_{id}/insights` (`meta-ads-sync`, `meta-ads-sync-spend`) → `ads_read`.
- `/me/adaccounts`, `/me/businesses`, `/me`, `debug_token` (`meta-ads-list-accounts`) → `ads_read`/`business_management`.
- `oauth/access_token` com `fb_exchange_token` (renovação do token de anúncios) → nenhuma permissão nova.
- `/{dataset}/events` (CAPI: `meta-capi-*`) → `ads_management`, ou token de sistema do dataset.
- Leadgen: **não existe**. Catálogo da Meta: **não existe** (o que há é da Shopify). Páginas: apenas Messenger `/me/messages`.

## 7. Login do Facebook
- SDK (FB.init / FB.login), `config_id`, troca de `code` por token, Cadastro Incorporado: **não existem**.
- Todos os tokens são colados manualmente (Admin > instâncias / contas do Instagram / segredos). O único fluxo automático é a troca de token de longa duração em `meta-ads-sync`.
- O script em `connect.facebook.net` que aparece no código é só o Pixel (`src/lib/metaPixel.ts`, landing pages).

## 8. IDs fixos da Banana
- Conta de anúncios `2253897104825255`, usada como padrão em `supabase/functions/meta-ads-sync/index.ts:71`.
- Dataset CAPI `1346445220878187` em `meta-capi-offline/index.ts:27` e `meta-capi-offline-backfill/index.ts:13`.
- URL do backend fixa em `extension/content.js`.
- O valor exemplo `1009921908860145` em `MetaInstanceManager.tsx:279` é apenas texto de exemplo no campo.
- WABA, Phone Number ID, ID de página e ID do Instagram ficam no banco, não no código.
- A plataforma não tem separação por empresa (tenant) para os dados da Meta.

## 9. Idioma
- Não existe i18n (nenhuma biblioteca de tradução); a interface é toda em português fixo.
