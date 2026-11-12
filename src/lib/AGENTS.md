- Live code-intent confirms only via src/lib/liveCodeOrder.ts; open carts receive items (no 2nd cart).
- Exchange desk (Centrais Fase 3): decisions only via RPC exchange_desk_action, mirrored by src/lib/exchangeDesk/rules.ts; only humans deny, reverse only once on approved, so every step keeps who/when history.
- payment-receipts bucket is private; show receipts via storage/signedReceiptUrl.ts.
- Exchange auto-replies (Phase 4): detection/decision only in DB support_auto_evaluate (trigger on incoming), mirrored by src/lib/supportAuto/intent.ts; it only records support_auto_suggestions, sending is a human click, auto mode has no sender yet.
- Support agent tracking/lane: tracking links come only from shipment_simulations.tracking_code (same /rastreio URL as the payment confirmation) inserted by the server via {{rastreio}}; moving to the PDV SUPORTE lane reuses chat_conversation_lanes through _support_move_to_support_line, automatic only with auto_route_support_line on and mode 'auto'. Training runs (support-ai-training) are read-only, one conversation per call (CPU limit). Central test links (is_test) open while the Central is closed; their requests never get reverse or troca records and can be deleted.

- Pasted tracking links: normalized by DB trigger parse_tracking_input; logistics/trackingInput.ts mirrors it.
