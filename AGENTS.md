# Project architecture rules
- Security rules: supabase/functions/_shared/security-architecture.md.

- Guarded order-write triggers persist self-service event shipping so previews, providers and POS share one amount; preserve manual shipping/exemptions and never recalculate paid, cancelled or provider-linked attempts. Automatic rows use shipping_info.source=event_rule for recalculation.


- Staff self-service drafts use server last-ten-digit phone keys (event-scoped with orders, no order otherwise); manual cart sends save the exact registration without WhatsApp confirmation or cross-phone cart selection.

- Self-service registration derives submission validity and inline field errors from one validation helper; invalid submissions focus the first error without sending registration requests, preserving existing acceptance rules.
- Self-service preview and no-order screens share the registration form and draft effect; retain confirmed/expired guards and explicit-submit registration, so combining screens cannot turn capture or autosave into WhatsApp confirmation.

- Overlay test participants live in the event's existing wheel config; participant-only saves merge that field into current settings, preserving layout and unrelated controls without creating real raffle entries.

- Live lanes project exact registration phones via batches; carts override incomplete stages. Unread follows the chat channel; unanswered compares inbound/outbound independently of reads. Reuse broadcasts/indexed summaries, never per-message queries.

- Self-service late orders resolve one event-scoped verified access by exact order/phone/Instagram or unique conflict-free last four digits, reuse registration without overwriting staff fields, notify via cart queue, and repair sent orders without resending; payment messages use only the source order's cart URL.

- Self-service queue pacing is sampled/persisted atomically per instance; claims reserve only the FIFO head. Minute recovery is armed on enqueue and removed after drain, using the shared cron guard, so crashes cannot strand work or require permanent polling.

- Group administration claims serialize on the instance throttle row and persist the sampled delay; finish RPCs preserve that delay and attempt history, because overlapping workers/retries must not bypass anti-ban limits. Only successful actions mirror settings.

- Shopify product links use shared officialProductUrl; attribution rebuilds from validated handles and fails closed, never trusting provider destinations.
- Shopify data updates omit media, preflight option values by unique exact dictionary match, create variants via GraphQL IDs and reconcile combinations only by matching SKU/GTIN, preserving manual media/legacy links and avoiding duplicates.

- Expedition gateway badges/filters use pos_sales.payment_gateway only (unified shipments show all). Stage counters use the RLS-invoker pos_expedition_stage_counts aggregate over eligible sales and indexed items, never a capped historical item download; quantities can place one sale in multiple stages.

- Every public payment surface must resolve `payment_splits` before rendering a charge; never fall back to the full order total when split status cannot be loaded — that can double-charge a customer.
- WhatsApp replies must preserve the provider message ID end-to-end (`quoted_message_id`) so quoted context renders for both customer and staff.
- DRE (PDV > Dashboard Geral) só via RPC dre_period sobre as views v_sale_* (sem grant ao front); custo do item fica em pos_sale_items.cost_price_at_sale via trigger, porque o custo do cadastro muda com o tempo.
- VIP attendance uses vip_links/daily_destination/clicks/conversations, vip-go and /g/:code; never reuse /zap or /vip engines: matching rules differ.
- Redução de valor de venda (Expedição) altera pos_sale_items.unit_price via RPC apply_sale_price_adjustment, guardando o preço anterior em pos_sale_price_adjustments, porque a NF-e lê unit_price e o imposto incide só sobre o valor real; bloqueada após NF-e emitida.
- Live panels read live_comments via realtime INSERT. Webhooks persist active-event comments (today as fallback); expire_live_payment_windows syncs server-side only for active lives (one 30s second pass), avoiding browser polling and extra crons.
- Overlay da Live (/overlay/:token, OBS) lê só a RPC overlay_pull (polling 2 s) sobre live_overlay_settings/live_overlay_events alimentadas por trigger em orders — página pública não toca em orders/comentários/clientes.
- Raffle eligibility only in RPC event_raffle_pool. Fixed OBS token in live_overlay_templates follows newest event; new events inherit last layout without overwrites; reset queues/cursor on live change.
- Leads already customers (customers_unified.total_orders > 0, last 8 phone digits) stay in lp_leads marked dispatch_excluded_reason='ja_cliente' via BEFORE INSERT trigger: history preserved, dispatches target only real prospects.
- Event revenue metrics (src/lib/eventRevenue.ts and RPC event_inner_dashboard) count cancelled orders in totals and the conversion denominator, never as paid/received — the business wants real conversion.
- Card gateway split (Admin > Pagamentos, gateway_split_config) picks only the FIRST gateway of the card cascade, deterministic by order id via _shared/gateway-split.ts; Pix/debit stay on Mercado Pago, AustPay (card only) joins only as drawn start gateway, config read failure falls back to the fixed order — retries must never land on a different gateway.

- Wait-reply outcomes use stable step IDs and conditional row consumption: replies and timeouts choose only one branch while preserving legacy routing.

- Lazy imports: one reload/tab, visible stale-module fallback. Presenter alerts: team_message only; order realtime never interrupts the live panel.
- Checkout installments expand inline; staff selections stay locked and cannot be filtered by MP-only offers — the server cascade must honor the agreed terms.
- Self-service product and cart pages resolve event installment ceilings through resolveSelfServiceInstallments per order, not combined totals; the event threshold expands only interest-free terms, preventing contradictory offers.

- Chat PIX: copy-code button is the default on uazapi (operator toggle per send, remembered); failure or opt-out falls back to the isolated standalone code, never mixed with text.
- Payment storage is best-effort: browser denial cannot block checkout; server idempotency remains authoritative.
- AustPay failure identity resolves exact order registration and linked sale IDs, never amount; customers uses full_name and has no email column.

- Event orders reconcile paginated ID/version/phone every 60s while visible, batching changed carts with edit locks; change feeds may be absent.

- VIP inserts normalize names; captions never use media_brief; media helpers preserve draft captions.

- Live board cards use batched/cached reads (src/lib/orderCardBatches) and mount dialogs only when open; POS WhatsApp list syncs incrementally (full reload on scope change/10 min): per-card work froze lives.
- Subdirectories have their own `AGENTS.md`; read it before changing files there.
- Self-service capture is idempotent/service-only; provisional last-four matches are display-only and sender-revalidated. Lead uniqueness conflicts preserve acquisition rows and WhatsApp confirmation, annotate conflict, and never merge identities.
- Self-service greetings resolve Instagram only through current-event orders; phone keys match event_phone_key and fresh confirmation codes reset only that access's replies. Prize uploads reuse event-landing-assets; product and registration screens share the prize banner.
- Self-service live mode (/pedido/:slug): public pages never set eligible_for_prize/registered_at; registration requires WhatsApp #CODE and payment uses the cart link; debounce-saved form_draft mirrors CustomerFichaPanel without overwriting staff edits; alt_address stays on the order registration.

- Self-service cashback is service-only, transactionally idempotent per source order, and based on exact linked payment evidence; the first provider-confirmed cart send is immutable, and POS/live confirmation share one grant.
- Self-service advertising: controller-validated legal basis; full hashed CAPI matching (em/ph/fn/ln/ct/st/zp/external_id + fbc/fbp/ip/ua) defaults on per events.capi_advanced_matching; registered advertising refusal blocks sending. Use exact order registration only, no shared-phone enrichment or CPF; browser purchases require server-confirmed value and the same deterministic event ID.
- Expedition "waiting products" tag is recomputed from item conference/completed quantities after every stage move (waitingFlag.ts), never set unconditionally, so complete orders never show it.

- Self-service registration DMs use one unique ig_live_cart_notifications row per event+@, atomic claim, no automatic retry, and capped staff-only resends to prevent duplicate Instagram DMs.
- Stock transfers between stores go only through RPC pos_transfer_stock (via pos-stock-transfer-v2): one transaction, locked rows, official adjustments before stock updates and an idempotency key; legacy transfer functions answer 410 and Shopify is never called because it receives the sum of stores.
- WhatsApp groups: preserve per-instance rows and actions; joins use group_jid_base, never suffixed group_id. Manual is_vip updates mirror by base key, and VIP reports filter that flag; no unified display view, so campaign targeting stays unchanged.
- Group responsible: recompute_group_responsible only; swaps wait for queues/direct leases. Group routing is shared, overrides are per-send, and dispatch claim/finish serialize each instance and reconcile parallel totals atomically to preserve pacing and prevent duplicates. Only the responsible instance writes group chat; RPCs hide mirrors.
- Self-service #CODE sender becomes the ficha's principal phone (typed one kept in previous_phones); auto-merge another ficha only when name plus CPF/e-mail/address agree and no orders/cashback are lost, else annotate conflict.
- E-mail: every send goes through supabase/functions/_shared/email-send.ts (Resend + email_send_log); fiscal packaging/Sintegra logic lives only in supabase/functions/_shared/fiscal and src/lib/fiscal re-exports it, so browser downloads and the accountant package never diverge.
- Fiscal/Folha tab passwords are verified only by server RPCs over bcrypt hashes (verify_area_password, 5 tries then 5-min lock; admin-only change_area_password); never ship a password literal to the browser. Sintegra button and accountant package share fiscalMonthBounds and note ordering so files stay identical.
- Refund, Correios, Live Crossell/paid-chat and live catalog invite rules live in supabase/functions/AGENTS.md.
- Dispatch tracking: worker tags our live links with ?d= via _shared/dispatch-tracking.ts; clicks only via RPC dispatch_link_click, linking only via dispatch_link_access, keeping ad_touch and dispatch_touch side by side so neither overwrites the other.
- Editing a dispatch with stored recipients updates only dispatch_history; only 'Recalcular público' re-enqueues (keeps tracking codes).
- Live catalog: own tables; catalog orders skip cart-notify; public via live-catalog; one open cart/customer. Editors reuse EventCatalogManager (wizard Crossell).
- PDV revenue/commission reads sales via lib/pos/commissionSales (live by expedition finish) + saleNet so screens agree.
- Chat side panels use EmbeddedDialog, always inside a Dialog root (modal only when not embedded), since DialogTitle throws without it.
## Permanent security rules
- New public tables: RLS, no anon, explicit policies/grants; backups/temp are service_role-only.
- New SQL functions: revoke PUBLIC/anon EXECUTE, grant explicitly; DEFINER requires has_role/permission check.
- New edges: withAccessLog + requireAuth/requireStaff/requireInternal/webhook signature; verify_jwt=false ≠ public.
- Financial values/status never come from the browser; server recalculates.
- Frontend edge calls always use the session token.
- Finish with zero no-RLS tables; anon EXECUTE only for the documented public list.
- Code search: server RPC search_product_code_keys (fuzzy, cap 200); never filter in browser.
