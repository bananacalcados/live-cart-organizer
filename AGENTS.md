# Project architecture rules

- Group administration claims serialize on the instance throttle row and persist the sampled delay; finish RPCs preserve that delay and attempt history, because overlapping workers/retries must not bypass anti-ban limits. Only successful actions mirror settings.

- Cached successful checkout attempts block duplicate charges but never restore paid state; AustPay webhook approvals require a production API re-query, captured status, exact transaction/reference/amount and reject invalidated attempts, because sandbox records must never become real payments. Incident reversal only from a privileged DB session with an invalidated sandbox attempt and no successful attempt remaining. Payment audits: admin/read-only, 50 rows, ≤3 provider reads.

- Expedition gateway badges and server-side filters use pos_sales.payment_gateway, never the cascade selection or a payment-method guess; unified shipments display every constituent gateway to avoid misattributing settlements.

- Every public payment surface must resolve `payment_splits` before rendering a charge; never fall back to the full order total when split status cannot be loaded, because that can double-charge a customer.
- WhatsApp replies must preserve the provider message ID end-to-end (`quoted_message_id`) so quoted context renders for both customer and staff.- Meta Ads token renewed by meta-ads-sync is stored in Vault (meta_ads_token_state + meta_ads_get_token/set_token RPCs, service_role only) and read before the META_ADS_ACCESS_TOKEN secret, because edge functions cannot rewrite secrets.
- DRE (PDV > Dashboard Geral) é calculada só pela RPC dre_period sobre as views v_sale_* (sem grant ao front); custo do item fica gravado em pos_sale_items.cost_price_at_sale via trigger, porque o custo do cadastro muda com o tempo.
- AppMax: AppStore OAuth2 via appmax-install; appmax_installations credentials service-role-only, never fixed secrets.
- VIP attendance uses vip_links/daily_destination/clicks/conversations, vip-go and /g/:code; never reuse /zap or /vip engines: matching rules differ.
- Redução de valor de venda (Expedição) altera pos_sale_items.unit_price via RPC apply_sale_price_adjustment, guardando o preço anterior em pos_sale_price_adjustments, porque a NF-e lê unit_price e o imposto incide só sobre o valor real; bloqueada após NF-e emitida.
- Live panels read live_comments via realtime INSERT. Webhooks persist active-event comments (today as fallback); expire_live_payment_windows syncs server-side only for active lives (one 30s second pass), avoiding browser polling and extra crons.
- Overlay da Live (/overlay/:token, OBS) lê só a RPC overlay_pull (polling 2 s) sobre live_overlay_settings/live_overlay_events alimentadas por trigger em orders — página pública não toca em orders/comentários/clientes.
- Overlay scales to viewport; per-event controls isolate OBS. Raffle eligibility only in RPC event_raffle_pool (bar, list, draw match).
- Overlay editing shares renderer bounds and merges layout-only writes, keeping unapplied settings and alert queues.
- Leads already customers (customers_unified.total_orders > 0, last 8 phone digits) stay in lp_leads marked dispatch_excluded_reason='ja_cliente' via BEFORE INSERT trigger: history preserved, dispatches target only real prospects.
- Event revenue metrics (src/lib/eventRevenue.ts and RPC event_inner_dashboard) count cancelled orders in total orders, total value and the conversion denominator, but never as paid/received, because the business wants real conversion.
- Card gateway split (Admin > Pagamentos, gateway_split_config) picks only the FIRST gateway of the card cascade, deterministic by order id via _shared/gateway-split.ts; Pix/debit stay on Mercado Pago, AustPay (card only) joins only as drawn start gateway, config read failure falls back to the fixed order — retries must never land on a different gateway.

- Wait-reply outcomes use stable step IDs and conditional row consumption, because replies and timeouts must choose only one branch while preserving legacy routing.
- Presenter alerts accept only team_message; order realtime never interrupts the live panel.

- Lazy imports: one reload/tab, visible stale-module fallback.
- Checkout installments expand inline; staff selections stay locked and cannot be filtered by MP-only offers, because the server cascade must honor the agreed terms.

- Chat PIX sends the same standalone code, not native copy buttons: delivery cannot verify recipient clipboard support.

- Event orders reconcile paginated ID/version/phone every 60s while visible, batching changed carts with edit locks; hosted change feeds may be absent.

- VIP inserts normalize names; captions never use media_brief. Shared media helpers preserve draft captions on append/remove.
- MP refunds (phase 1): edge mp-refund (JWT + has_module_access 'estornos'; switches refunds_enabled/refund_approval_threshold in app_settings; idempotency key per row; Pix in_process=processando); audit in gateway_refunds (writes service-role only); status sync rides mercadopago-poll-pending; post-actions in _shared/refund-post-actions.ts; external_reference of an order converted to this pos_sale = same purchase; other gateways/Point/PDF out of scope.
