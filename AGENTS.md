# Project architecture rules

- Group administration claims serialize on the instance throttle row and persist the sampled delay; finish RPCs preserve that delay and attempt history, because overlapping workers and retries must not bypass anti-ban limits. Only successful provider actions mirror group settings.

- Cached successful checkout attempts block duplicate charges but never restore paid state; AustPay webhook approvals require a production API re-query, captured status, exact transaction/reference/amount and reject invalidated attempts, because sandbox records must never become real payments.
- The payment-source guard permits incident reversal only from a privileged database session with an invalidated sandbox attempt and no successful attempt remaining; application users cannot use this exception.
- Incident payment audits are admin-only, read-only, paginated in fifty rows and limited to three concurrent provider reads; they never send notifications or create charges.

- Expedition gateway badges and server-side filters use pos_sales.payment_gateway, never the cascade selection or a payment-method guess; unified shipments display every constituent gateway to avoid misattributing settlements.

- Every public payment surface must resolve `payment_splits` before rendering a charge; never fall back to the full order total when split status cannot be loaded, because that can double-charge a customer.
- WhatsApp replies must preserve the provider message ID end-to-end (`quoted_message_id`) so quoted context renders for both customer and staff.- Meta Ads token renewed by meta-ads-sync is stored in Vault (meta_ads_token_state + meta_ads_get_token/set_token RPCs, service_role only) and read before the META_ADS_ACCESS_TOKEN secret, because edge functions cannot rewrite secrets.
- DRE (PDV > Dashboard Geral) é calculada só pela RPC dre_period sobre as views v_sale_* (sem grant ao front); custo do item fica gravado em pos_sale_items.cost_price_at_sale via trigger, porque o custo do cadastro muda com o tempo.
- AppMax usa o fluxo OAuth2 da AppStore (edge function appmax-install: validação, autorização e callback); credenciais da loja ficam em appmax_installations (só service_role), porque são geradas na instalação e não podem ser segredos fixos.
- Link de Atendimento VIP é um motor separado (vip_links, vip_link_daily_destination, vip_link_clicks, vip_link_conversations, edge function vip-go, rota /g/:code, trigger trg_vip_link_match_incoming); nunca reaproveita tabelas/funções da Live (/zap) nem do /vip, porque esses fluxos já funcionam e têm regras próprias de casamento.
- Redução de valor de venda (Expedição) altera pos_sale_items.unit_price via RPC apply_sale_price_adjustment, guardando o preço anterior em pos_sale_price_adjustments, porque a NF-e (nfe-emitir) lê unit_price e o imposto deve incidir só sobre o valor real; bloqueada após NF-e emitida.
- Painéis da Live leem comentários só de `live_comments` (sem polling; tempo real por INSERT): `meta-messenger-webhook` grava todo comentário do IG ali (evento com live ativa, ou eventos do dia como reserva) e `instagram-live-sync` roda no servidor pelo worker de 1 min `expire_live_payment_windows` (só com `live_active_until > now()`), porque o navegador não pode ser a fonte da sincronização.
- Overlay da Live (/overlay/:token, OBS) lê só a RPC overlay_pull (token do evento, polling 2 s) sobre live_overlay_settings/live_overlay_events alimentadas por trigger em orders, porque é página pública e não pode tocar em orders/comentários/clientes.
- Overlay scales uniformly to the viewport; EventInnerDashboard mounts controls by event, preventing OBS sizing and settings leakage.
- Overlay editing shares renderer bounds and merges serialized layout-only writes, keeping unapplied settings and alert queues unchanged.
- Leads that are already customers (customers_unified.total_orders > 0, matched by last 8 phone digits) are kept in lp_leads but marked dispatch_excluded_reason='ja_cliente' by a BEFORE INSERT trigger, because history must be preserved while dispatches only target real prospects.
- Event revenue metrics (src/lib/eventRevenue.ts and RPC event_inner_dashboard) count cancelled orders in total orders, total value and the conversion denominator, but never as paid/received, because the business wants real conversion.
- Card gateway split (Admin > Pagamentos, table gateway_split_config) only picks the FIRST gateway of the card cascade, deterministically by order id via _shared/gateway-split.ts; Pix/debit stay on Mercado Pago, AustPay (card only) joins the queue only when it is the drawn start gateway, and any config read failure falls back to the fixed order, because retries must never land on a different gateway.

- Wait-reply outcomes use stable step IDs and conditional row consumption, because replies and timeouts must choose only one branch while preserving legacy routing.
- Presenter alerts accept only team_message; order realtime updates data without interrupting the live panel.
