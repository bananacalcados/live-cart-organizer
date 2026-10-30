# Project architecture rules

- Self-service event shipping is persisted by guarded order-write triggers so previews, payment providers and POS share one amount; preserve manual shipping/exemptions and never recalculate paid, cancelled or provider-linked attempts. Automatic rows carry shipping_info.source=event_rule for item/discount recalculation.

- Correios printing derives persisted thermal/A4 PDFs from the original official label and shipment-linked invoice keys; the default ERP 10x15 label copies the official DataMatrix payload verbatim (it carries a Correios token) and checks object/CEPs before drawing, while the official label stays available as fallback. Reopening and batch printing repair missing formats without creating pre-postage; PDF generation stays server-side.

- Staff self-service drafts use the server's last-ten-digit phone key for contacts without an order, and event-scoped order membership for real orders; manual cart sending saves the exact order registration without claiming WhatsApp confirmation, so provisional phones never select another person's cart.

- Self-service registration derives submission validity and inline field errors from one validation helper; invalid submissions focus the first error without sending registration requests, preserving existing acceptance rules.
- Self-service preview and no-order screens share the registration form and draft effect; retain confirmed/expired guards and explicit-submit registration, so combining screens cannot turn capture or autosave into WhatsApp confirmation.

- Overlay test participants live in the event's existing wheel config; participant-only saves merge that field into current settings, preserving layout and unrelated controls without creating real raffle entries.

- Live lanes project exact registration phones via existing batches, never identity writes; carts override stale incomplete stages. Unread follows the card's chat channel. Share broadcast/read markers and indexed summaries, never per-message queries.

- Self-service late orders resolve one event-scoped verified access by exact order/phone/Instagram or unique conflict-free last four digits, reuse saved registration without overwriting staff fields, and notify through the existing cart queue; repairs link already-sent orders without resending. Payment messages in this mode use the source order's cart URL, never cached cart links or a generic member-area fallback.

- Self-service queue pacing is sampled and persisted atomically per instance; claims reserve only its FIFO head. Minute recovery is armed on enqueue and removed after drain, using the shared cron guard, so crashes cannot strand work or require permanent polling.

- Group administration claims serialize on the instance throttle row and persist the sampled delay; finish RPCs preserve that delay and attempt history, because overlapping workers/retries must not bypass anti-ban limits. Only successful actions mirror settings.

- Checkout success cache prevents duplicate charges, never restores paid state. AustPay approvals: production re-query, captured, exact transaction/reference/amount, no invalidated attempt. Reversal: privileged DB, invalidated sandbox attempt, no remaining success. Audits: admin/read-only, 50 rows, ≤3 provider reads.
- Shopify product links use shared officialProductUrl; attribution rebuilds from validated handles and fails closed, never trusting provider destinations.
- Shopify data updates omit media entirely, preflight linked option values by unique exact dictionary matches, create variants through GraphQL IDs, and reconcile existing combinations only with matching SKU/GTIN; this preserves manual media/legacy links and prevents duplicate retries.

- Expedition gateway badges/filters use pos_sales.payment_gateway only; unified shipments show every gateway.
- Expedition stage counters use the RLS-invoker pos_expedition_stage_counts aggregate over eligible sales and indexed items, never a capped historical item download; quantities can place one sale in multiple stages.

- Every public payment surface must resolve `payment_splits` before rendering a charge; never fall back to the full order total when split status cannot be loaded — that can double-charge a customer.
- WhatsApp replies must preserve the provider message ID end-to-end (`quoted_message_id`) so quoted context renders for both customer and staff.- Meta Ads token renewed by meta-ads-sync lives in Vault (meta_ads_token_state + meta_ads_get_token/set_token RPCs, service_role only), read before the META_ADS_ACCESS_TOKEN secret — edge functions cannot rewrite secrets.
- DRE (PDV > Dashboard Geral) só via RPC dre_period sobre as views v_sale_* (sem grant ao front); custo do item fica em pos_sale_items.cost_price_at_sale via trigger, porque o custo do cadastro muda com o tempo.
- AppMax: AppStore OAuth2 via appmax-install; appmax_installations credentials service-role-only, no fixed secrets.
- VIP attendance uses vip_links/daily_destination/clicks/conversations, vip-go and /g/:code; never reuse /zap or /vip engines: matching rules differ.
- Redução de valor de venda (Expedição) altera pos_sale_items.unit_price via RPC apply_sale_price_adjustment, guardando o preço anterior em pos_sale_price_adjustments, porque a NF-e lê unit_price e o imposto incide só sobre o valor real; bloqueada após NF-e emitida.
- Live panels read live_comments via realtime INSERT. Webhooks persist active-event comments (today as fallback); expire_live_payment_windows syncs server-side only for active lives (one 30s second pass), avoiding browser polling and extra crons.
- Overlay da Live (/overlay/:token, OBS) lê só a RPC overlay_pull (polling 2 s) sobre live_overlay_settings/live_overlay_events alimentadas por trigger em orders — página pública não toca em orders/comentários/clientes.
- Raffle eligibility only in RPC event_raffle_pool (bar, list, draw match).
- Overlay scales to viewport, per-event controls; editing merges layout-only writes, keeping settings and alert queues.
- Leads already customers (customers_unified.total_orders > 0, last 8 phone digits) stay in lp_leads marked dispatch_excluded_reason='ja_cliente' via BEFORE INSERT trigger: history preserved, dispatches target only real prospects.
- Event revenue metrics (src/lib/eventRevenue.ts and RPC event_inner_dashboard) count cancelled orders in totals and the conversion denominator, never as paid/received — the business wants real conversion.
- Card gateway split (Admin > Pagamentos, gateway_split_config) picks only the FIRST gateway of the card cascade, deterministic by order id via _shared/gateway-split.ts; Pix/debit stay on Mercado Pago, AustPay (card only) joins only as drawn start gateway, config read failure falls back to the fixed order — retries must never land on a different gateway.

- Wait-reply outcomes use stable step IDs and conditional row consumption: replies and timeouts choose only one branch while preserving legacy routing.
- Presenter alerts: team_message only; order realtime never interrupts the live panel.

- Lazy imports: one reload/tab, visible stale-module fallback.
- Checkout installments expand inline; staff selections stay locked and cannot be filtered by MP-only offers — the server cascade must honor the agreed terms.
- Self-service product and cart pages resolve event installment ceilings through resolveSelfServiceInstallments per order, not combined totals; the event threshold expands only interest-free terms, preventing contradictory offers.

- Chat PIX: copy-code button is the default on uazapi (operator toggle per send, remembered); failure or opt-out falls back to the isolated standalone code, never mixed with text.
- Payment storage is best-effort: browser denial cannot block checkout; server idempotency remains authoritative.
- AustPay failure identity resolves exact order registration and linked sale IDs, never amount; customers uses full_name and has no email column.

- Event orders reconcile paginated ID/version/phone every 60s while visible, batching changed carts with edit locks; change feeds may be absent.

- VIP inserts normalize names; captions never use media_brief. Shared media helpers preserve draft captions on append/remove.
- Refunds (mp-refund + _shared/refund-gateways): JWT + estornos permission server-side, service-only writes, one in-flight per payment; details in supabase/functions/AGENTS.md.

- Subdirectories have their own `AGENTS.md`; read it before changing files there.
- Self-service capture is idempotent/service-only; provisional last-four matches are display-only and revalidated against the sender. Lead uniqueness conflicts cannot roll back WhatsApp confirmation: preserve acquisition rows, annotate conflict, never merge identities.
- Self-service greetings resolve Instagram through the current event's orders, never arbitrary shared-phone profiles; phone keys match event_phone_key and each fresh confirmation code resets only that access's reply lifecycle. Prize uploads reuse event-landing-assets and the prize banner is shared between product and registration screens.
- Correios rules (service-only credentials, Conference-group quotes, atomic selection) live in supabase/functions/AGENTS.md.
- Self-service live mode (/pedido/:slug): public page never sets eligible_for_prize or registered_at; registration ends in WhatsApp #CODE confirmation and payment only on the cart link; form_draft is debounce-saved and mirrored to CustomerFichaPanel without overwriting staff edits; alt_address only goes to the order's registration.

- Self-service cashback is per source order, service-only and transactionally idempotent; the first provider-confirmed cart send is immutable, and exact linked payment evidence determines the credit. Both POS automation and live confirmation use the shared grant to prevent divergent amounts.
- Self-service advertising: legal basis validated by the controller, so full hashed CAPI matching (em/ph/fn/ln/ct/st/zp/external_id + fbc/fbp/ip/ua) is the default, gated per event by events.capi_advanced_matching (default on); a registered refusal (selfservice_advertising_consents.advertising=false) blocks the send entirely. Exact order registration only, no shared-phone enrichment, CPF never sent. Browser purchase requires server-confirmed value and the same deterministic event ID.
- Expedition "waiting products" tag is recomputed from item conference/completed quantities after every stage move (waitingFlag.ts), never set unconditionally, so complete orders never show it.

- Self-service registration DMs use one ig_live_cart_notifications row per event+@ (unique index), atomic claim and no automatic retry; only staff resend (capped) — duplicate Instagram DMs previously reached customers unseen.
- Stock transfers between stores go only through RPC pos_transfer_stock (via pos-stock-transfer-v2): one transaction, locked rows, official adjustments before stock updates and an idempotency key; legacy transfer functions answer 410 and Shopify is never called because it receives the sum of stores.
- WhatsApp groups: preserve per-instance rows and actions; joins use group_jid_base, never suffixed group_id. Manual is_vip updates mirror by base key, and VIP reports filter that flag; no unified display view, so campaign targeting stays unchanged.
- Group responsible: recompute_group_responsible only; swaps wait for queues/direct leases. Group routing is shared, overrides are per-send, and dispatch claim/finish serialize each instance and reconcile parallel totals atomically to preserve pacing and prevent duplicates. Only the responsible instance writes group chat; RPCs hide mirrors.
- Live Crossell/paid-chat rules also live in supabase/functions/AGENTS.md.
- Self-service #CODE sender becomes the ficha's principal phone (typed one kept in previous_phones); auto-merge another ficha only when name plus CPF/e-mail/address agree and no orders/cashback are lost, else annotate conflict.
- E-mail: every send goes through supabase/functions/_shared/email-send.ts (Resend + email_send_log); fiscal packaging/Sintegra logic lives only in supabase/functions/_shared/fiscal and src/lib/fiscal re-exports it, so browser downloads and the accountant package never diverge.
- Meta Purchase: the orders trigger only fires the request; meta_capi_purchase_sent_at is written by meta-capi-event after Meta's OK, and every failure lands in meta_capi_purchase_log. Self-service Purchase fills fbc/fbp/IP/UA from the exact order's live_selfservice_accesses.advertising_signals (or the single same-event phone match) and an unverified cashback never blocks it — Appmax exposes no approval time.
