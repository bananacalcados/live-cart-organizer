// GERADO a partir do banco. Lista ÚNICA de tabelas/colunas que a porta vps-reader pode ler.
// Nunca usar '*'. Tabelas fora daqui são recusadas.
export type ReaderTable = { pk: string; columns: string[]; incremental: 'updated_at' | 'created_at' | null };
export const VPS_READER_ALLOWLIST: Record<string, ReaderTable> = {
"access_log": {
"pk": "id",
"columns": [
"id",
"created_at",
"function_name",
"method",
"path",
"ip",
"ip_chain",
"user_agent",
"origin",
"referer",
"session_id",
"user_id",
"user_email",
"http_status",
"duration_ms",
"blocked",
"reason"
],
"incremental": "created_at"
},
"accountant_recipients": {
"pk": "id",
"columns": [
"id",
"company_id",
"email",
"nome",
"ativo",
"created_at"
],
"incremental": null
},
"accountant_send_config": {
"pk": "company_id",
"columns": [
"company_id",
"auto_send_enabled",
"cc_emails",
"updated_at"
],
"incremental": null
},
"accountant_send_history": {
"pk": "id",
"columns": [
"id",
"company_id",
"reference_month",
"trigger_type",
"status",
"attempt",
"recipients",
"cc",
"notes_count",
"counts",
"storage_path",
"attached",
"error",
"email_log_id",
"created_by",
"created_at"
],
"incremental": null
},
"ad_campaign_nurture_steps": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"days_before_event",
"send_time",
"meta_template_name",
"meta_template_vars",
"zapi_message_text",
"is_active",
"sort_order",
"created_at"
],
"incremental": null
},
"ad_campaign_situation_prompts": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"situation",
"sub_situation",
"prompt_text",
"is_active",
"sort_order",
"created_at",
"updated_at"
],
"incremental": null
},
"ad_campaigns_ai": {
"pk": "id",
"columns": [
"id",
"name",
"objective",
"activation_keywords",
"prompt",
"product_info",
"payment_conditions",
"event_id",
"data_to_collect",
"whatsapp_number_id",
"is_active",
"post_sale_action",
"post_capture_action",
"created_at",
"updated_at",
"shipping_rule",
"pix_discount_percent"
],
"incremental": null
},
"ad_keyword_media": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"keyword",
"media_url",
"media_type",
"filename",
"send_mode",
"caption",
"created_at",
"updated_at"
],
"incremental": null
},
"ad_leads": {
"pk": "id",
"columns": [
"id",
"phone",
"name",
"campaign_id",
"temperature",
"collected_data",
"source",
"event_id",
"whatsapp_number_id",
"channel",
"last_ai_contact_at",
"last_human_contact_at",
"notes",
"is_active",
"created_at",
"updated_at",
"conversation_stage",
"followup_count",
"last_followup_at",
"payment_link_sent",
"live_invite_sent",
"interested_product_keywords",
"tags",
"shoe_size",
"live_campaign_id"
],
"incremental": null
},
"ad_nurture_sent": {
"pk": "id",
"columns": [
"id",
"lead_id",
"nurture_step_id",
"sent_at"
],
"incremental": null
},
"admin_access_log": {
"pk": "id",
"columns": [
"id",
"user_id",
"email",
"event",
"module",
"ip",
"user_agent",
"created_at"
],
"incremental": "created_at"
},
"agent_calendar": {
"pk": "id",
"columns": [
"id",
"conversation_id",
"mes_ref",
"data",
"tipo_acao",
"titulo",
"descricao",
"publico_alvo_descricao",
"custo_estimado_brl",
"status",
"live_event_id",
"created_at",
"updated_at"
],
"incremental": null
},
"agent_conversations": {
"pk": "id",
"columns": [
"id",
"titulo",
"summary",
"summary_updated_at",
"last_message_at",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"agent_decisions": {
"pk": "id",
"columns": [
"id",
"conversation_id",
"tipo",
"descricao",
"motivo",
"contexto",
"ativo",
"revisitar_apos",
"created_at",
"updated_at"
],
"incremental": null
},
"agent_executions": {
"pk": "id",
"columns": [
"id",
"agent_name",
"executed_at",
"input_data",
"output_result",
"status",
"error_message",
"retry_count",
"created_at",
"updated_at"
],
"incremental": null
},
"agent_messages": {
"pk": "id",
"columns": [
"id",
"conversation_id",
"role",
"content",
"tool_calls",
"pending_confirmation",
"tokens_in",
"tokens_out",
"created_at"
],
"incremental": null
},
"agent_weekly_context": {
"pk": "id",
"columns": [
"id",
"key",
"value",
"week_start",
"created_at",
"updated_at"
],
"incremental": null
},
"ai_assistance_requests": {
"pk": "id",
"columns": [
"id",
"request_type",
"status",
"customer_phone",
"customer_name",
"product_title",
"shopify_product_id",
"store_id",
"ai_agent",
"ai_summary",
"priority",
"seller_id",
"response_notes",
"response_media_url",
"whatsapp_number_id",
"claimed_at",
"completed_at",
"created_at",
"updated_at"
],
"incremental": null
},
"ai_conversation_logs": {
"pk": "id",
"columns": [
"id",
"order_id",
"phone",
"stage",
"message_in",
"message_out",
"ai_decision",
"tool_called",
"tool_params",
"response_time_ms",
"error",
"provider",
"created_at"
],
"incremental": null
},
"ai_error_logs": {
"pk": "id",
"columns": [
"id",
"created_at",
"agent",
"phone",
"error_type",
"error_message",
"provider_attempted",
"fallback_provider",
"fallback_success",
"customer_message",
"ai_response",
"history_sent_count",
"context_payload",
"status",
"resolution_notes",
"resolved_by",
"resolved_at"
],
"incremental": "created_at"
},
"ai_knowledge_base": {
"pk": "id",
"columns": [
"id",
"category",
"title",
"content",
"is_active",
"sort_order",
"created_at",
"updated_at",
"agents"
],
"incremental": null
},
"ai_stock_analyses": {
"pk": "id",
"columns": [
"id",
"analise",
"contexto_resumo",
"usage",
"model",
"created_at"
],
"incremental": "created_at"
},
"automation_ai_sessions": {
"pk": "id",
"columns": [
"id",
"phone",
"prompt",
"whatsapp_number_id",
"flow_id",
"is_active",
"max_messages",
"messages_sent",
"created_at",
"updated_at",
"expires_at",
"live_campaign_id"
],
"incremental": null
},
"automation_contact_pacing": {
"pk": "phone",
"columns": [
"phone",
"last_sent_at",
"sent_today",
"sent_7d",
"day_key",
"week_start",
"created_at",
"updated_at"
],
"incremental": null
},
"automation_dispatch_jobs": {
"pk": "id",
"columns": [
"id",
"flow_id",
"status",
"total_audience",
"current_offset",
"batch_size",
"sent",
"failed",
"skipped",
"error_message",
"heartbeat_at",
"started_at",
"completed_at",
"created_by",
"created_at",
"audience_cached_at"
],
"incremental": null
},
"automation_dispatch_sent": {
"pk": "id",
"columns": [
"id",
"flow_id",
"phone",
"sent_at",
"template_category_at_send",
"unit_cost_at_send",
"provider_at_send",
"shadow_mode",
"unified_id",
"status",
"blocked_reason"
],
"incremental": null
},
"automation_dispatch_sent_log": {
"pk": "id",
"columns": [
"id",
"flow_id",
"phone",
"sent_at",
"status",
"provider_at_send",
"unified_id"
],
"incremental": null
},
"automation_executions": {
"pk": "id",
"columns": [
"id",
"flow_id",
"order_id",
"step_id",
"status",
"result",
"error_message",
"executed_at"
],
"incremental": null
},
"automation_flows": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"trigger_type",
"trigger_config",
"is_active",
"event_id",
"created_at",
"updated_at",
"use_jess_agent",
"jess_campaign_name",
"shadow_mode"
],
"incremental": null
},
"automation_message_queue": {
"pk": "id",
"columns": [
"id",
"phone",
"flow_id",
"step_id",
"step_index",
"payload",
"whatsapp_number_id",
"recipient_data",
"status",
"scheduled_at",
"attempts",
"last_error",
"locked_by",
"locked_until",
"sent_at",
"created_at",
"updated_at",
"skip_reason",
"reschedule_count",
"queue_seq"
],
"incremental": null
},
"automation_opt_outs": {
"pk": "id",
"columns": [
"id",
"phone",
"phone_key",
"source",
"keyword",
"whatsapp_number_id",
"created_at",
"updated_at"
],
"incremental": null
},
"automation_pending_replies": {
"pk": "id",
"columns": [
"id",
"phone",
"flow_id",
"pending_step_index",
"step_id",
"button_branches",
"whatsapp_number_id",
"recipient_data",
"created_at",
"expires_at",
"is_active",
"answered_at"
],
"incremental": "created_at"
},
"automation_pos_followups": {
"pk": "id",
"columns": [
"id",
"sale_id",
"flow_id",
"step_id",
"step_index",
"customer_phone",
"customer_phone_suffix",
"scheduled_at",
"sent_at",
"cancelled_at",
"cancel_reason",
"payload",
"created_at",
"customer_cpf"
],
"incremental": null
},
"automation_steps": {
"pk": "id",
"columns": [
"id",
"flow_id",
"step_order",
"action_type",
"action_config",
"delay_seconds",
"created_at",
"updated_at"
],
"incremental": null
},
"bank_accounts": {
"pk": "id",
"columns": [
"id",
"name",
"bank_name",
"account_type",
"balance",
"notes",
"is_active",
"created_at",
"updated_at",
"store_id",
"initial_balance"
],
"incremental": null
},
"bank_import_batches": {
"pk": "id",
"columns": [
"id",
"file_name",
"file_hash",
"source_type",
"rows_total",
"rows_inserted",
"rows_duplicated",
"rows_matched",
"rows_needs_review",
"summary",
"imported_by",
"imported_via",
"created_at"
],
"incremental": null
},
"bank_transactions": {
"pk": "id",
"columns": [
"id",
"bank_account_id",
"transaction_date",
"description",
"memo",
"amount",
"type",
"fitid",
"category_id",
"ai_category_id",
"ai_confidence",
"classification_status",
"notes",
"import_batch_id",
"created_at",
"updated_at"
],
"incremental": null
},
"blocked_contacts": {
"pk": "id",
"columns": [
"id",
"phone",
"whatsapp_number_id",
"provider",
"reason",
"blocked_by",
"blocked_by_name",
"created_at"
],
"incremental": null
},
"campaign_channels": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"channel_type",
"strategy",
"content_plan",
"tone_of_voice",
"schedule",
"notes",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"campaign_landing_pages": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"slug",
"title",
"description",
"hero_image_url",
"form_fields",
"thank_you_message",
"whatsapp_redirect",
"custom_css",
"is_active",
"views",
"submissions",
"created_at",
"updated_at",
"event_date"
],
"incremental": null
},
"campaign_leads": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"name",
"phone",
"email",
"instagram",
"source",
"metadata",
"converted",
"converted_at",
"conversion_value",
"created_at"
],
"incremental": null
},
"campaign_tasks": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"channel_id",
"title",
"description",
"due_date",
"status",
"sort_order",
"assigned_to",
"created_at",
"updated_at"
],
"incremental": null
},
"campaign_variables": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"variable_name",
"variable_value",
"updated_at"
],
"incremental": null
},
"campanha_cards": {
"pk": "id",
"columns": [
"id",
"campanha_id",
"ordem",
"shopify_product_id",
"shopify_variant_id",
"imagem_url",
"legenda",
"botao_tipo",
"botao_payload",
"status",
"ultima_verificacao",
"created_at",
"updated_at"
],
"incremental": null
},
"campanha_envios": {
"pk": "id",
"columns": [
"id",
"campanha_id",
"cliente_id",
"phone",
"phone_suffix8",
"vendedora_id",
"vendedora_nome",
"message_wamid",
"enviado_em",
"status",
"erro",
"tentativas",
"proxima_tentativa",
"created_at",
"updated_at",
"template_category_at_send",
"unit_cost_at_send",
"provider_at_send",
"shadow_mode",
"erro_code",
"fallback_provider",
"fallback_at",
"error_code",
"envios_realizados"
],
"incremental": null
},
"campanha_publicos": {
"pk": "id",
"columns": [
"id",
"nome",
"filtro_json",
"created_at",
"updated_at"
],
"incremental": null
},
"campanhas_auto": {
"pk": "id",
"columns": [
"id",
"nome",
"tipo",
"whatsapp_number_id",
"top_body",
"card_body",
"variaveis",
"botoes",
"filtro_json",
"qtd_por_dia",
"dias_semana",
"cooldown_dias",
"rodizio_vendedora",
"vendedoras_rodizio",
"ativa",
"criada_por",
"created_at",
"updated_at",
"template_modelo",
"publico_id",
"template_categoria",
"shadow_mode",
"tipo_comunicacao",
"template_tipo",
"template_language"
],
"incremental": null
},
"cash_flow_entries": {
"pk": "id",
"columns": [
"id",
"store_id",
"entry_date",
"entry_datetime",
"direction",
"amount",
"category_id",
"payment_method",
"description",
"attachment_url",
"source",
"external_source",
"external_id",
"source_ref_id",
"pos_sale_id",
"bank_external_id",
"status",
"confidence",
"needs_review_reason",
"metadata",
"created_by",
"created_at",
"updated_at",
"bank_account_id",
"transfer_pair_id",
"is_transfer",
"reconciled_with_id",
"reconciliation_status",
"ledger"
],
"incremental": null
},
"catalog_landing_pages": {
"pk": "id",
"columns": [
"id",
"slug",
"title",
"subtitle",
"is_active",
"theme_config",
"welcome_title",
"welcome_subtitle",
"combo_tiers",
"payment_info",
"cta_text",
"categories",
"whatsapp_numbers",
"selected_product_ids",
"product_filter",
"store_base_url",
"views",
"clicks",
"created_at",
"updated_at"
],
"incremental": null
},
"catalog_lead_pages": {
"pk": "id",
"columns": [
"id",
"slug",
"title",
"subtitle",
"is_active",
"theme_config",
"selected_product_ids",
"whatsapp_numbers",
"require_registration",
"views",
"leads_count",
"created_at",
"updated_at",
"shipping_cost",
"product_discounts"
],
"incremental": null
},
"catalog_lead_registrations": {
"pk": "id",
"columns": [
"id",
"catalog_page_id",
"instagram_handle",
"whatsapp",
"created_at",
"cart_items",
"cart_total",
"status",
"checkout_sale_id",
"updated_at",
"chosen_payment_method",
"pix_code",
"pix_expires_at",
"recovery_disparo",
"recovery_ultimo_disparo_at",
"recovery_session_id"
],
"incremental": null
},
"catalog_sync_log": {
"pk": "id",
"columns": [
"id",
"run_id",
"operation",
"master_id",
"variant_id",
"base_name",
"color",
"size",
"details",
"created_at"
],
"incremental": null
},
"chargeback_events": {
"pk": "id",
"columns": [
"id",
"chargeback_id",
"action",
"from_value",
"to_value",
"note",
"customer_name_snapshot",
"order_name_snapshot",
"actor_id",
"created_at"
],
"incremental": null
},
"chargebacks": {
"pk": "id",
"columns": [
"id",
"source",
"source_order_id",
"source_order_name",
"customer_name",
"customer_email",
"customer_phone",
"customer_cpf",
"address_cep",
"address_number",
"address_street",
"address_neighborhood",
"address_city",
"address_state",
"address_complement",
"address_key",
"amount",
"chargeback_date",
"reason",
"status",
"contact_notes",
"created_by",
"created_at",
"updated_at",
"pos_sale_id",
"order_id",
"customer_unified_id",
"phone_key",
"cpf_digits",
"blocked",
"blocked_at",
"blocked_by"
],
"incremental": "created_at"
},
"chat_archived_conversations": {
"pk": "id",
"columns": [
"id",
"phone",
"archived_at",
"archived_by"
],
"incremental": null
},
"chat_assignments": {
"pk": "id",
"columns": [
"id",
"phone",
"sector_id",
"assigned_to",
"assigned_by",
"status",
"ai_classification",
"notes",
"created_at",
"resolved_at",
"updated_at"
],
"incremental": null
},
"chat_attendance_rules": {
"pk": "id",
"columns": [
"id",
"rule_key",
"enabled",
"config",
"created_at",
"updated_at"
],
"incremental": null
},
"chat_awaiting_payment": {
"pk": "id",
"columns": [
"id",
"phone",
"sale_id",
"type",
"created_at",
"store_id",
"whatsapp_number_id"
],
"incremental": null
},
"chat_contacts": {
"pk": "id",
"columns": [
"id",
"phone",
"display_name",
"custom_name",
"created_at",
"updated_at",
"profile_pic_url",
"tags"
],
"incremental": null
},
"chat_conversation_assignments": {
"pk": "id",
"columns": [
"id",
"phone",
"whatsapp_number_id",
"assigned_to",
"assigned_by",
"notes",
"created_at",
"updated_at",
"assigned_name"
],
"incremental": null
},
"chat_conversation_lanes": {
"pk": "id",
"columns": [
"id",
"phone_key",
"whatsapp_number_id",
"lane",
"moved_by",
"moved_at",
"created_at",
"updated_at"
],
"incremental": null
},
"chat_finish_reasons": {
"pk": "id",
"columns": [
"id",
"value",
"label",
"icon",
"color",
"sort_order",
"is_system",
"is_active",
"created_at"
],
"incremental": null
},
"chat_finished_conversations": {
"pk": "id",
"columns": [
"id",
"phone",
"finished_at",
"finished_by",
"created_at",
"finish_reason",
"seller_id",
"sale_value",
"sale_currency",
"trigger_id",
"purchased",
"support_reason",
"support_satisfactory",
"duvida_text",
"whatsapp_number_id",
"instance_key"
],
"incremental": null
},
"chat_nps_surveys": {
"pk": "id",
"columns": [
"id",
"phone",
"seller_id",
"store_id",
"score",
"feedback",
"sent_at",
"responded_at",
"finish_conversation_id",
"whatsapp_number_id",
"created_at"
],
"incremental": null
},
"chat_payment_followups": {
"pk": "id",
"columns": [
"id",
"phone",
"sale_id",
"type",
"reminder_count",
"max_reminders",
"interval_minutes",
"next_reminder_at",
"is_active",
"created_at",
"completed_at",
"seller_id",
"whatsapp_number_id"
],
"incremental": null
},
"chat_scheduled_followups": {
"pk": "id",
"columns": [
"id",
"phone",
"scheduled_at",
"reason",
"situation_hint",
"campaign_id",
"whatsapp_number_id",
"is_sent",
"sent_at",
"created_at"
],
"incremental": null
},
"chat_sector_agents": {
"pk": "id",
"columns": [
"id",
"sector_id",
"user_id",
"is_active",
"is_online",
"current_load",
"max_concurrent",
"last_assigned_at",
"created_at"
],
"incremental": null
},
"chat_sector_round_robin": {
"pk": "sector_id",
"columns": [
"sector_id",
"last_agent_index",
"updated_at"
],
"incremental": null
},
"chat_sectors": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"ai_routing_keywords",
"is_active",
"sort_order",
"created_at",
"updated_at"
],
"incremental": null
},
"chat_seller_assignments": {
"pk": "id",
"columns": [
"id",
"phone",
"seller_id",
"store_id",
"assigned_at",
"first_reply_at",
"opened_at"
],
"incremental": null
},
"companies": {
"pk": "id",
"columns": [
"id",
"legal_name",
"trade_name",
"cnpj",
"ie",
"ie_isento",
"im",
"regime_tributario",
"crt",
"cnae_principal",
"address_cep",
"address_street",
"address_number",
"address_complement",
"address_neighborhood",
"address_city",
"address_city_ibge",
"address_state",
"address_country",
"email",
"phone",
"ambiente_nfe",
"certificate_uploaded_at",
"certificate_expires_at",
"is_active",
"is_pilot",
"notes",
"created_at",
"updated_at",
"certificate_valid_until",
"certificate_filename",
"nfe_serie"
],
"incremental": null
},
"conversation_counts_cache": {
"pk": "id",
"columns": [
"id",
"awaiting_count",
"new_count",
"updated_at"
],
"incremental": null
},
"correios_reverse_shipments": {
"pk": "id",
"columns": [
"id",
"created_at",
"updated_at",
"created_by",
"customer_name",
"customer_phone",
"phone_key",
"customer_cpf",
"address",
"sale_id",
"reason",
"servico_codigo",
"servico_nome",
"package",
"valid_until",
"status",
"prepostagem_id",
"codigo_objeto",
"label_path",
"request",
"response",
"error_message",
"sent_at",
"idempotency_key",
"return_items",
"devolucao_doc_id"
],
"incremental": null
},
"correios_shipments": {
"pk": "id",
"columns": [
"id",
"sale_id",
"group_id",
"sale_ids",
"prepostagem_id",
"codigo_objeto",
"servico_codigo",
"servico_nome",
"status",
"request",
"response",
"nfe_chaves",
"label_path",
"combined_path",
"package",
"price",
"created_by",
"created_at",
"label_generated_at",
"cancelled_at",
"cancelled_by",
"cancel_reason",
"error_message",
"updated_at"
],
"incremental": null
},
"cost_center_fixed_cost_items": {
"pk": "id",
"columns": [
"id",
"fixed_cost_id",
"store_id",
"name",
"amount",
"sort_order",
"created_at",
"updated_at"
],
"incremental": null
},
"cost_center_fixed_costs": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"category",
"sort_order",
"created_at",
"updated_at",
"max_budget"
],
"incremental": null
},
"cost_center_planned_fixed_cuts": {
"pk": "id",
"columns": [
"id",
"store_id",
"fixed_cost_id",
"reduction_amount",
"created_at",
"updated_at",
"description"
],
"incremental": null
},
"cost_center_planned_variable_cuts": {
"pk": "id",
"columns": [
"id",
"store_id",
"variable_cost_id",
"reduction_percentage",
"created_at",
"updated_at",
"description"
],
"incremental": null
},
"cost_center_store_fixed_costs": {
"pk": "id",
"columns": [
"id",
"store_id",
"fixed_cost_id",
"amount",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"cost_center_variable_costs": {
"pk": "id",
"columns": [
"id",
"store_id",
"description",
"percentage",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"crm_message_templates": {
"pk": "id",
"columns": [
"id",
"name",
"message",
"created_at",
"updated_at"
],
"incremental": null
},
"customer_chat_notes": {
"pk": "id",
"columns": [
"id",
"phone",
"phone_suffix8",
"company_id",
"store_id",
"note",
"author_user_id",
"author_name",
"created_at",
"updated_at"
],
"incremental": null
},
"customer_list_memberships": {
"pk": "id",
"columns": [
"id",
"customer_id",
"list_id",
"source",
"metadata",
"added_at"
],
"incremental": null
},
"customer_loyalty_points": {
"pk": "id",
"columns": [
"id",
"customer_phone",
"customer_name",
"store_id",
"total_points",
"lifetime_points",
"last_earn_at",
"expires_at",
"created_at",
"updated_at",
"unified_customer_id"
],
"incremental": null
},
"customer_prizes": {
"pk": "id",
"columns": [
"id",
"customer_phone",
"customer_name",
"customer_email",
"store_id",
"segment_id",
"prize_label",
"prize_type",
"prize_value",
"coupon_code",
"is_redeemed",
"redeemed_at",
"redeemed_sale_id",
"expires_at",
"source",
"live_session_id",
"campaign_id",
"notes",
"created_at",
"updated_at",
"unified_customer_id",
"event_id",
"wheel_id",
"event_segment_id",
"applied_order_id",
"fulfillment_status",
"reserved_at",
"shipped_at",
"forfeited_at",
"forfeit_reason"
],
"incremental": null
},
"customer_registrations": {
"pk": "id",
"columns": [
"id",
"order_id",
"full_name",
"cpf",
"email",
"whatsapp",
"cep",
"address",
"address_number",
"complement",
"neighborhood",
"city",
"state",
"shopify_draft_order_id",
"shopify_draft_order_name",
"status",
"created_at",
"updated_at",
"customer_id",
"fbp",
"fbc",
"client_user_agent",
"client_ip",
"event_source_url",
"selfservice_advertising_consent_id",
"selfservice_advertising_snapshot"
],
"incremental": "created_at"
},
"customers": {
"pk": "id",
"columns": [
"id",
"instagram_handle",
"whatsapp",
"is_banned",
"ban_reason",
"created_at",
"updated_at",
"tags",
"live_cancellation_count",
"full_name"
],
"incremental": null
},
"customers_legacy_rebuild_log": {
"pk": "id",
"columns": [
"id",
"customer_id",
"old_legacy",
"new_legacy",
"created_at"
],
"incremental": null
},
"customers_unified": {
"pk": "id",
"columns": [
"id",
"customer_code",
"tenant_id",
"name",
"cpf",
"email",
"birth_date",
"gender",
"phone_e164",
"phone_suffix8",
"previous_phones",
"instagram_handle",
"instagram_user_id",
"cep",
"address",
"address_number",
"complement",
"neighborhood",
"city",
"state",
"shoe_size",
"preferred_style",
"age_range",
"has_children",
"children_age_range",
"total_orders",
"total_spent",
"avg_ticket",
"total_items",
"first_purchase_at",
"last_purchase_at",
"rfm_segment",
"rfm_r",
"rfm_f",
"rfm_m",
"rfm_total",
"region_type",
"ddd",
"tags",
"is_banned",
"ban_reason",
"live_cancellation_count",
"source_origins",
"metadata",
"created_at",
"updated_at",
"last_seen_at",
"cashback_balance",
"cashback_expires_at",
"loyalty_points",
"loyalty_lifetime_points",
"legacy_orders",
"legacy_spent",
"legacy_first_purchase_at",
"legacy_last_purchase_at",
"merged_into_id",
"is_archived",
"opt_out_mass_dispatch",
"purchased_brands",
"purchased_categories",
"purchased_sizes",
"purchased_stores",
"payment_methods",
"lead_temperature",
"temperature_updated_at",
"last_engagement_at",
"last_engagement_type",
"dispatch_total_count",
"dispatch_reacted_count",
"dispatch_ignored_count",
"classificacao_disparo",
"classificacao_disparo_updated_at",
"dispatch_consecutive_ignored",
"purchased_channels"
],
"incremental": null
},
"delivery_costs": {
"pk": "id",
"columns": [
"id",
"provider_id",
"provider_type",
"amount",
"source",
"store_id",
"pos_sale_id",
"expedition_order_id",
"customer_name",
"notes",
"status",
"payment_id",
"created_at",
"updated_at"
],
"incremental": null
},
"dispatch_history": {
"pk": "id",
"columns": [
"id",
"template_name",
"template_language",
"whatsapp_number_id",
"audience_source",
"audience_filters",
"total_recipients",
"sent_count",
"failed_count",
"rendered_message",
"variables_config",
"force_resend",
"started_at",
"completed_at",
"status",
"created_by",
"created_at",
"processing_batch",
"template_components",
"has_dynamic_vars",
"header_media_url",
"cost_per_message",
"scheduled_at",
"campaign_name",
"template_category",
"cost_override_brl",
"tipo_comunicacao",
"provider",
"quota_check_summary",
"manual_overrides",
"template_category_at_send",
"unit_cost_at_send",
"provider_at_send",
"shadow_mode",
"track_clicks",
"dispatch_link_id"
],
"incremental": null
},
"dispatch_link_attempts": {
"pk": "id",
"columns": [
"id",
"link_id",
"ip",
"success",
"created_at"
],
"incremental": null
},
"dispatch_link_clicks": {
"pk": "id",
"columns": [
"id",
"dispatch_id",
"recipient_id",
"phone",
"phone_key",
"code",
"page",
"clicked_at",
"user_agent",
"ip",
"first_click"
],
"incremental": null
},
"dispatch_link_tests": {
"pk": "id",
"columns": [
"id",
"link_id",
"session_id",
"config_hash",
"phone_masked",
"status",
"message_id",
"error",
"used_at",
"used_dispatch_id",
"created_at"
],
"incremental": null
},
"dispatch_recipients": {
"pk": "id",
"columns": [
"id",
"dispatch_id",
"phone",
"recipient_name",
"status",
"message_wamid",
"created_at",
"lease_until",
"worker_id",
"attempts",
"last_error",
"sent_at",
"unified_customer_id",
"override_reason",
"template_category_at_send",
"unit_cost_at_send",
"provider_at_send",
"shadow_mode",
"error_code",
"fallback_provider",
"fallback_at",
"tracking_code"
],
"incremental": null
},
"dispatch_touch_limits": {
"pk": "classificacao",
"columns": [
"classificacao",
"cota_mensal",
"tipos_permitidos",
"silencio_threshold_ignorados",
"observacoes",
"created_at",
"updated_at",
"min_dias_entre_toques"
],
"incremental": null
},
"dispatch_unit_cost_rates": {
"pk": "category",
"columns": [
"category",
"unit_cost_brl",
"updated_at"
],
"incremental": null
},
"dre_parameters": {
"pk": "id",
"columns": [
"id",
"tax_regime",
"simples_rate_pct",
"commission_pct_store",
"commission_pct_online",
"commission_pct_live",
"packaging_cost_per_shipped_order",
"fixed_cost_allocation",
"updated_at",
"fixed_cost_store_ids",
"exclude_marketing_fixed_cost_names"
],
"incremental": null
},
"email_campaigns": {
"pk": "id",
"columns": [
"id",
"name",
"subject",
"from_name",
"from_email",
"template_id",
"list_id",
"status",
"scheduled_at",
"sent_at",
"total_recipients",
"created_at",
"updated_at",
"user_id"
],
"incremental": null
},
"email_contacts": {
"pk": "id",
"columns": [
"id",
"email",
"name",
"tags",
"custom_fields",
"subscribed",
"unsubscribed_at",
"list_id",
"created_at"
],
"incremental": null
},
"email_events": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"contact_id",
"event_type",
"metadata",
"created_at"
],
"incremental": null
},
"email_lists": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"contact_count",
"created_at",
"user_id"
],
"incremental": null
},
"email_send_log": {
"pk": "id",
"columns": [
"id",
"categoria",
"company_id",
"to",
"cc",
"subject",
"provider_message_id",
"status",
"error",
"metadata",
"created_at"
],
"incremental": "created_at"
},
"email_templates": {
"pk": "id",
"columns": [
"id",
"name",
"subject",
"blocks",
"html_content",
"thumbnail_url",
"created_at",
"updated_at",
"user_id"
],
"incremental": null
},
"event_archived_conversations": {
"pk": "id",
"columns": [
"id",
"event_id",
"phone",
"whatsapp_number_id",
"archived_by",
"created_at"
],
"incremental": null
},
"event_bulk_send_items": {
"pk": "id",
"columns": [
"id",
"send_id",
"order_id",
"phone",
"customer_name",
"whatsapp_number_id",
"components",
"rendered_message",
"status",
"reason",
"message_id",
"attempts",
"locked_until",
"sent_at",
"created_at",
"updated_at",
"crossell_state",
"crossell_progress",
"crossell_next_at",
"crossell_interest_at",
"crossell_interest_message_id"
],
"incremental": null
},
"event_bulk_sends": {
"pk": "id",
"columns": [
"id",
"event_id",
"kind",
"template_name",
"template_language",
"template_label",
"whatsapp_number_id",
"stages",
"variable_map",
"base_components",
"allow_resend",
"status",
"total_count",
"sent_count",
"failed_count",
"skipped_count",
"created_by",
"created_by_name",
"created_at",
"updated_at",
"manual_blocks"
],
"incremental": null
},
"event_catalog_products": {
"pk": "id",
"columns": [
"id",
"event_id",
"shopify_product_id",
"product_handle",
"title",
"image_url",
"images",
"original_price",
"offer_price",
"allow_cashback",
"variants",
"position",
"is_active",
"created_at",
"updated_at",
"free_shipping",
"promotion_id"
],
"incremental": null
},
"event_contact_lanes": {
"pk": "id",
"columns": [
"id",
"event_id",
"phone_key",
"lane",
"reason",
"moved_by",
"moved_at",
"created_at",
"updated_at"
],
"incremental": null
},
"event_crossell_offers": {
"pk": "id",
"columns": [
"id",
"event_id",
"shopify_product_id",
"product_title",
"variant_handle",
"image",
"has_sizes",
"original_price",
"discount_price",
"position",
"is_active",
"created_at",
"updated_at",
"free_shipping",
"promotion_id"
],
"incremental": null
},
"event_followup_configs": {
"pk": "id",
"columns": [
"id",
"event_id",
"channel",
"order_index",
"enabled",
"template_name",
"template_language",
"template_variables",
"whatsapp_number_id",
"message_text",
"buttons",
"delay_minutes",
"trigger_source",
"stop_on_reply",
"stop_on_paid",
"created_at",
"updated_at"
],
"incremental": null
},
"event_followup_dispatches": {
"pk": "id",
"columns": [
"id",
"config_id",
"event_id",
"order_id",
"channel",
"scheduled_at",
"sent_at",
"status",
"skip_reason",
"error_message",
"meta_message_id",
"attempts",
"created_at",
"updated_at"
],
"incremental": null
},
"event_landing_pages": {
"pk": "id",
"columns": [
"id",
"event_id",
"slug",
"title",
"published",
"hero_image_url",
"og_image_url",
"theme_json",
"config_json",
"vip_group_link",
"success_message",
"prize_description",
"event_starts_at",
"require_privacy_consent",
"created_at",
"updated_at"
],
"incremental": null
},
"event_leads": {
"pk": "id",
"columns": [
"id",
"event_id",
"name",
"phone",
"phone_suffix",
"source",
"landing_page_id",
"typebot_id",
"referred_by_lead_id",
"referred_count",
"prize_unlocked_at",
"vip_group_sent_at",
"utm_source",
"utm_medium",
"utm_campaign",
"metadata",
"created_at",
"updated_at",
"instagram",
"custom_fields",
"disqualified",
"utm_content",
"utm_term",
"link_tag",
"link_slug",
"disqualify_reason",
"notified_at",
"notify_status",
"notify_error"
],
"incremental": null
},
"event_message_presets": {
"pk": "id",
"columns": [
"id",
"name",
"kind",
"payload",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"event_pinned_conversations": {
"pk": "id",
"columns": [
"id",
"order_id",
"event_id",
"pinned_by",
"pinned_by_name",
"created_at"
],
"incremental": null
},
"event_prize_spins": {
"pk": "id",
"columns": [
"id",
"wheel_id",
"event_id",
"phone",
"phone_suffix",
"customer_name",
"segment_id",
"prize_id",
"prize_label",
"created_at"
],
"incremental": null
},
"event_prize_wheel_segments": {
"pk": "id",
"columns": [
"id",
"wheel_id",
"label",
"color",
"prize_type",
"prize_value",
"probability",
"expiry_days",
"sort_order",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"event_prize_wheels": {
"pk": "id",
"columns": [
"id",
"event_id",
"name",
"audience",
"is_active",
"min_purchase_value",
"require_otp",
"max_spins_per_customer",
"starts_at",
"ends_at",
"created_at",
"updated_at",
"max_pay_minutes"
],
"incremental": null
},
"event_promotions": {
"pk": "id",
"columns": [
"id",
"event_id",
"name",
"shopify_collection_handle",
"shopify_product_ids",
"tiers",
"is_active",
"created_at",
"updated_at",
"free_shipping",
"blocks_cashback"
],
"incremental": null
},
"event_raffle_entries": {
"pk": "id",
"columns": [
"id",
"raffle_id",
"phone",
"phone_suffix",
"display_name",
"order_id",
"entry_value",
"created_at"
],
"incremental": null
},
"event_raffle_winners": {
"pk": "id",
"columns": [
"id",
"raffle_id",
"entry_id",
"phone",
"display_name",
"position",
"customer_prize_id",
"voided_at",
"created_at"
],
"incremental": null
},
"event_raffles": {
"pk": "id",
"columns": [
"id",
"event_id",
"name",
"prize_label",
"prize_type",
"prize_value",
"expiry_days",
"winners_count",
"audience",
"min_purchase_value",
"exclude_previous_winners",
"status",
"drawn_at",
"drawn_by",
"created_at",
"updated_at",
"max_registration_minutes",
"max_payment_minutes",
"prize_requires_paid"
],
"incremental": null
},
"event_stock_alerts": {
"pk": "id",
"columns": [
"id",
"event_id",
"product_title",
"variant",
"sku",
"image_url",
"status",
"resolved_by",
"resolved_at",
"created_at"
],
"incremental": null
},
"event_team_assignments": {
"pk": "id",
"columns": [
"id",
"event_id",
"team_member_id",
"created_at"
],
"incremental": null
},
"event_team_members": {
"pk": "id",
"columns": [
"id",
"name",
"role",
"whatsapp",
"photo_url",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"event_typebots": {
"pk": "id",
"columns": [
"id",
"event_id",
"slug",
"name",
"published",
"theme_json",
"flow_json",
"welcome_message",
"success_message",
"vip_group_link",
"event_starts_at",
"prize_description",
"created_at",
"updated_at",
"is_global",
"notify_enabled",
"notify_wa_number_id",
"notify_store_id",
"notify_message"
],
"incremental": null
},
"events": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"is_active",
"created_at",
"updated_at",
"default_shipping_cost",
"catalog_lead_page_id",
"active_product_delay_seconds",
"whatsapp_number_id",
"automation_enabled",
"channel",
"default_store_id",
"channel_preference",
"meta_template_name",
"meta_template_language",
"meta_template_body_variables",
"meta_template_header_variable",
"initial_message_enabled",
"initial_message_blocks",
"channel_preferences",
"live_active_until",
"start_date",
"end_date",
"setup_completed",
"free_shipping_threshold",
"installment_min_value",
"installment_max",
"crossell_enabled",
"crossell_configured",
"store_ids",
"manual_pos_routing",
"followup_templates",
"ig_initial_message_buttons",
"ig_automations",
"instagram_live_url",
"is_live_broadcasting",
"live_broadcast_started_at",
"live_url_updated_at",
"operation_mode",
"member_area_slug",
"member_area_notify_enabled",
"member_area_wa_number_id",
"member_area_template_name",
"member_area_template_language",
"member_area_template_body_variables",
"member_area_template_header_variable",
"wa_initial_enabled",
"wa_initial_auto",
"wa_initial_number_id",
"wa_initial_variants",
"wa_initial_rotation",
"payment_window_on_assembly",
"self_service_slug",
"self_service_prize_name",
"self_service_prize_image_url",
"self_service_registration_minutes",
"self_service_product_notice",
"capi_advanced_matching",
"google_rating_text",
"google_profile_url",
"catalog_link_hours",
"catalog_enabled",
"catalog_auto_invite",
"catalog_invite_delay_min",
"catalog_invite_delay_max",
"public_catalog_enabled",
"public_catalog_until",
"live_followup_enabled"
],
"incremental": null
},
"exchange_message_templates": {
"pk": "key",
"columns": [
"key",
"title",
"body",
"updated_at",
"updated_by"
],
"incremental": null
},
"exchange_request_events": {
"pk": "id",
"columns": [
"id",
"request_id",
"actor",
"actor_name",
"action",
"from_status",
"to_status",
"reason",
"note",
"created_at"
],
"incremental": null
},
"exchange_requests": {
"pk": "id",
"columns": [
"id",
"phone",
"customer_name",
"order_number",
"tiny_order_id",
"product_name",
"product_sku",
"product_size",
"desired_size",
"reason_category",
"reason_subcategory",
"ai_nuance_tags",
"customer_verbatim",
"ai_interpretation",
"fit_area",
"fit_detail",
"reverse_shipping_code",
"reverse_tracking_url",
"frenet_quote_id",
"shipping_carrier",
"status",
"auto_approved",
"requires_human_review",
"review_notes",
"reviewed_by",
"reviewed_at",
"support_ticket_id",
"whatsapp_number_id",
"created_at",
"updated_at",
"order_ref",
"request_type",
"channel_origin",
"delivered_at_used",
"delivered_source",
"customer_reported_received_at",
"deadline_at",
"eligibility",
"eligibility_reason",
"new_sku",
"new_variant_id",
"purchase_order_status",
"reverse_shipment_id",
"trocas_devolucoes_id",
"escalated_reason",
"sale_id",
"original_item_id",
"requested_quantity",
"replacement_product_id",
"replacement_reserved_quantity",
"assigned_to",
"assigned_at",
"decided_by",
"decided_at",
"decision_reason",
"desk_info_requested_at",
"customer_product_request",
"product_chosen_by",
"product_chosen_at",
"is_test",
"test_simulation",
"test_simulated_at",
"suggested_size",
"intent_confirmation_required",
"intent_confirmation_note"
],
"incremental": "created_at"
},
"expedition_beta_order_items": {
"pk": "id",
"columns": [
"id",
"expedition_order_id",
"shopify_line_item_id",
"product_name",
"variant_name",
"sku",
"barcode",
"quantity",
"unit_price",
"weight_grams",
"picked_quantity",
"pick_verified",
"packed_quantity",
"pack_verified",
"created_at"
],
"incremental": null
},
"expedition_beta_orders": {
"pk": "id",
"columns": [
"id",
"shopify_order_id",
"shopify_order_name",
"shopify_order_number",
"shopify_created_at",
"customer_name",
"customer_email",
"customer_phone",
"customer_cpf",
"shipping_address",
"financial_status",
"fulfillment_status",
"expedition_status",
"subtotal_price",
"total_price",
"total_discount",
"total_shipping",
"total_weight_grams",
"has_gift",
"is_from_live",
"source_event_name",
"source_event_date",
"notes",
"group_id",
"picking_list_id",
"internal_barcode",
"ean13_barcode",
"dispatch_verified",
"dispatch_verified_at",
"created_at",
"updated_at",
"tiny_order_id",
"tiny_order_number",
"tracking_code",
"shipping_method"
],
"incremental": null
},
"expedition_dispatch_manifest_items": {
"pk": "id",
"columns": [
"id",
"manifest_id",
"expedition_order_id",
"tracking_code",
"verified",
"verified_at",
"created_at"
],
"incremental": null
},
"expedition_dispatch_manifests": {
"pk": "id",
"columns": [
"id",
"carrier",
"manifest_number",
"order_count",
"status",
"collector_name",
"collected_at",
"signature_url",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"expedition_freight_quotes": {
"pk": "id",
"columns": [
"id",
"expedition_order_id",
"carrier",
"service",
"price",
"delivery_days",
"error_message",
"is_selected",
"quoted_at",
"tiny_forma_envio_id",
"tiny_forma_frete_id",
"tiny_service_code"
],
"incremental": null
},
"expedition_gateway_price_rules": {
"pk": "gateway",
"columns": [
"gateway",
"percent",
"is_active",
"updated_by",
"updated_at"
],
"incremental": null
},
"expedition_grade_purchases": {
"pk": "id",
"columns": [
"id",
"product_name",
"cor",
"tipo_grade",
"grades_qty",
"unit_cost",
"total_cost",
"arrival_date",
"received",
"notes",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"expedition_groups": {
"pk": "id",
"columns": [
"id",
"customer_email",
"customer_name",
"order_count",
"total_items",
"status",
"created_at",
"updated_at"
],
"incremental": null
},
"expedition_order_items": {
"pk": "id",
"columns": [
"id",
"expedition_order_id",
"shopify_line_item_id",
"product_name",
"variant_name",
"sku",
"barcode",
"quantity",
"unit_price",
"weight_grams",
"picked_quantity",
"packed_quantity",
"pick_verified",
"pack_verified",
"created_at"
],
"incremental": null
},
"expedition_orders": {
"pk": "id",
"columns": [
"id",
"shopify_order_id",
"shopify_order_number",
"shopify_order_name",
"customer_name",
"customer_email",
"customer_phone",
"customer_cpf",
"shipping_address",
"financial_status",
"fulfillment_status",
"total_price",
"subtotal_price",
"total_shipping",
"total_discount",
"total_weight_grams",
"shopify_created_at",
"expedition_status",
"group_id",
"picking_list_id",
"freight_carrier",
"freight_service",
"freight_price",
"freight_delivery_days",
"freight_tracking_code",
"freight_label_url",
"tiny_order_id",
"invoice_number",
"invoice_series",
"invoice_key",
"invoice_pdf_url",
"invoice_xml_url",
"internal_barcode",
"dispatch_verified",
"dispatch_verified_at",
"notes",
"created_at",
"updated_at",
"tiny_invoice_id",
"is_from_live",
"source_event_name",
"source_event_date",
"has_gift",
"tiny_forma_envio_id",
"tiny_forma_frete_id",
"tiny_service_code",
"priority_sedex"
],
"incremental": null
},
"expedition_picking_lists": {
"pk": "id",
"columns": [
"id",
"name",
"status",
"total_items",
"picked_items",
"created_at",
"updated_at"
],
"incremental": null
},
"expedition_returns": {
"pk": "id",
"columns": [
"id",
"expedition_order_id",
"shopify_order_name",
"customer_name",
"customer_email",
"return_type",
"reason",
"status",
"items",
"tracking_code",
"received_at",
"inspected_at",
"inspection_notes",
"refund_amount",
"exchange_order_id",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"expedition_scan_log": {
"pk": "id",
"columns": [
"id",
"created_at",
"flow",
"stage",
"method",
"code_read",
"variant_code",
"variant_id",
"sale_id",
"sale_item_id",
"expedition_order_id",
"expedition_order_item_id",
"product_name",
"variant_name",
"sku",
"barcode",
"quantity",
"store_id",
"operator_id",
"operator_name"
],
"incremental": "created_at"
},
"expedition_stock_requests": {
"pk": "id",
"columns": [
"id",
"sku",
"product_name",
"variant_name",
"quantity_needed",
"to_store_id",
"to_store_name",
"expedition_order_ids",
"order_names",
"status",
"requested_by",
"responded_by",
"has_stock",
"courier_requested",
"courier_name",
"courier_phone",
"notes",
"response_notes",
"created_at",
"updated_at",
"responded_at"
],
"incremental": null
},
"expedition_sync_log": {
"pk": "id",
"columns": [
"id",
"sync_type",
"status",
"orders_synced",
"error_message",
"started_at",
"completed_at"
],
"incremental": null
},
"expedition_unscannable_items": {
"pk": "id",
"columns": [
"id",
"expedition_order_id",
"expedition_order_item_id",
"product_name",
"variant_name",
"sku",
"barcode",
"scanned_value",
"reason",
"resolved",
"resolved_at",
"resolved_notes",
"created_at",
"created_by"
],
"incremental": null
},
"financial_agent_audit": {
"pk": "id",
"columns": [
"id",
"chat_id",
"direction",
"action",
"message",
"attachment_hash",
"metadata",
"created_at"
],
"incremental": null
},
"financial_agent_authorized_users": {
"pk": "chat_id",
"columns": [
"chat_id",
"user_id",
"display_name",
"role",
"active",
"created_at"
],
"incremental": null
},
"financial_agent_receipts": {
"pk": "id",
"columns": [
"id",
"chat_id",
"telegram_message_id",
"telegram_file_id",
"mime_type",
"storage_path",
"status",
"extracted",
"ai_model",
"ai_raw",
"cash_flow_entry_id",
"duplicate_of",
"error",
"created_at",
"updated_at"
],
"incremental": null
},
"financial_categories": {
"pk": "id",
"columns": [
"id",
"name",
"parent_id",
"type",
"tiny_category_id",
"is_custom",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"fiscal_documents": {
"pk": "id",
"columns": [
"id",
"company_id",
"pos_sale_id",
"order_id",
"modelo",
"serie",
"numero",
"ambiente",
"status",
"chave_acesso",
"protocolo",
"data_autorizacao",
"xml_url",
"xml_content",
"danfe_url",
"qrcode_url",
"valor_total",
"cpf_destinatario",
"nome_destinatario",
"rejection_code",
"rejection_message",
"cancellation_protocol",
"cancelled_at",
"cancellation_reason",
"brasilnfe_request",
"brasilnfe_response",
"events",
"created_at",
"updated_at",
"retry_count",
"last_retry_at",
"next_retry_at",
"contingencia_motivo",
"cancellation_xml",
"finalidade",
"tipo_operacao",
"ref_chave_acesso",
"troca_devolucao_id",
"company_selection_rule",
"company_selection_gateway",
"company_selection_details"
],
"incremental": null
},
"fiscal_emission_pendings": {
"pk": "id",
"columns": [
"id",
"source_type",
"source_id",
"reason",
"gateways",
"company_ids",
"status",
"created_at",
"updated_at",
"resolved_at"
],
"incremental": "created_at"
},
"fiscal_gateway_company_config": {
"pk": "id",
"columns": [
"id",
"emit_by_gateway",
"default_company_id",
"updated_at",
"updated_by"
],
"incremental": null
},
"fiscal_gateway_company_map": {
"pk": "id",
"columns": [
"id",
"gateway",
"company_id",
"is_active",
"created_at",
"updated_at",
"updated_by"
],
"incremental": null
},
"fiscal_holidays": {
"pk": "date",
"columns": [
"date",
"descricao"
],
"incremental": null
},
"fiscal_inutilizations": {
"pk": "id",
"columns": [
"id",
"company_id",
"modelo",
"serie",
"numero_inicial",
"numero_final",
"ano",
"ambiente",
"justificativa",
"status",
"protocolo",
"xml_content",
"rejection_message",
"brasilnfe_request",
"brasilnfe_response",
"created_at",
"updated_at"
],
"incremental": null
},
"fiscal_operations": {
"pk": "id",
"columns": [
"id",
"ncm",
"uf_origem",
"uf_destino",
"tipo_operacao",
"cfop",
"cst_icms",
"csosn_icms",
"aliq_icms",
"cst_pis",
"aliq_pis",
"cst_cofins",
"aliq_cofins",
"origem_mercadoria",
"description",
"is_active",
"priority",
"created_at",
"updated_at"
],
"incremental": null
},
"fiscal_sequences": {
"pk": "id",
"columns": [
"id",
"company_id",
"modelo",
"serie",
"last_number",
"ambiente",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"fiscal_webhook_events": {
"pk": "id",
"columns": [
"id",
"provider",
"event_type",
"chave_acesso",
"identificador_interno",
"fiscal_document_id",
"payload",
"processed",
"error_message",
"received_at",
"processed_at"
],
"incremental": null
},
"gateway_refunds": {
"pk": "id",
"columns": [
"id",
"gateway",
"source",
"source_id",
"mp_account_id",
"payment_id",
"refund_id",
"amount",
"refund_type",
"reason",
"reason_text",
"status",
"idempotency_key",
"e2e_id",
"card_brand",
"card_last4",
"installments",
"mp_response",
"error_message",
"requested_by",
"approved_by",
"created_at",
"updated_at",
"approved_at",
"completed_at",
"cancel_order",
"receipt_code",
"receipt_path",
"receipt_generated_at",
"receipt_sent_at",
"receipt_sent_by",
"receipt_sent_to",
"receipt_sent_channel",
"rejected_reason",
"manual_reference",
"manual_done_at",
"manual_registered_by",
"fiscal_override_by",
"fiscal_override_reason",
"fiscal_override_at",
"receipt_auto_status",
"receipt_auto_error",
"receipt_send_claimed_at"
],
"incremental": null
},
"gateway_split_config": {
"pk": "id",
"columns": [
"id",
"enabled",
"percentages",
"updated_at",
"updated_by"
],
"incremental": null
},
"gateway_split_config_history": {
"pk": "id",
"columns": [
"id",
"changed_at",
"changed_by",
"old_enabled",
"new_enabled",
"old_percentages",
"new_percentages"
],
"incremental": null
},
"group_admin_actions": {
"pk": "id",
"columns": [
"id",
"created_at",
"updated_at",
"whatsapp_number_id",
"group_db_id",
"group_jid",
"group_name_snapshot",
"campaign_id",
"action_type",
"payload",
"status",
"not_before",
"started_at",
"finished_at",
"attempts",
"error_message",
"result",
"requested_by",
"batch",
"notes",
"locked_until",
"seq",
"last_attempt_at",
"attempt_history",
"fallback_number_id",
"override_number_id"
],
"incremental": null
},
"group_admin_throttle": {
"pk": "whatsapp_number_id",
"columns": [
"whatsapp_number_id",
"min_gap_seconds",
"max_gap_seconds",
"long_pause_every",
"long_pause_min_seconds",
"long_pause_max_seconds",
"max_per_hour",
"max_per_day",
"window_start",
"window_end",
"paused",
"paused_reason",
"consecutive_failures",
"last_action_at",
"actions_since_long_pause",
"next_allowed_at"
],
"incremental": null
},
"group_campaign_block_dispatches": {
"pk": "id",
"columns": [
"id",
"scheduled_message_id",
"message_group_id",
"campaign_id",
"group_db_id",
"group_zapi_id",
"group_name",
"block_order",
"block_type",
"whatsapp_number_id",
"status",
"attempts",
"error_message",
"sent_at",
"created_at",
"updated_at",
"send_after",
"delay_after_ms",
"seq",
"locked_until",
"fallback_number_id",
"override_number_id",
"routing_source",
"started_at",
"provider_message_id"
],
"incremental": null
},
"group_campaign_messages": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"group_id",
"status",
"sent_at",
"error_message",
"message_id",
"created_at"
],
"incremental": null
},
"group_campaign_scheduled_messages": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"message_type",
"message_content",
"media_url",
"poll_options",
"scheduled_at",
"status",
"sent_at",
"send_speed",
"sent_count",
"failed_count",
"created_at",
"poll_max_options",
"mention_all",
"whatsapp_number_id",
"message_group_id",
"block_order",
"sent_group_ids",
"locked_until",
"execution_count",
"last_execution_at",
"disable_link_preview",
"contact_name",
"contact_phone",
"vip_link_mode",
"vip_link_product",
"created_by",
"draft_batch",
"media_brief",
"approved_at",
"approved_by",
"draft_notes",
"group_instance_overrides",
"sync_key"
],
"incremental": null
},
"group_campaigns": {
"pk": "id",
"columns": [
"id",
"name",
"status",
"message_type",
"message_content",
"media_url",
"poll_options",
"ai_prompt",
"ai_generated_content",
"target_groups",
"scheduled_at",
"started_at",
"completed_at",
"total_groups",
"sent_count",
"failed_count",
"error_log",
"created_by",
"created_at",
"updated_at",
"send_speed",
"campaign_link_slug",
"is_deep_link",
"strategy_prompt",
"strategy_content",
"group_name_template",
"group_photo_url",
"group_description",
"group_only_admins_send",
"group_only_admins_add",
"group_admin_phones",
"group_pin_duration",
"group_pin_message_text",
"whatsapp_number_id"
],
"incremental": null
},
"group_message_exposures": {
"pk": "id",
"columns": [
"id",
"group_campaign_message_id",
"group_campaign_id",
"group_jid",
"group_name",
"unified_id",
"phone_e164",
"phone_suffix8",
"member_jid",
"snapshotted_at",
"source",
"created_at"
],
"incremental": null
},
"group_message_templates": {
"pk": "id",
"columns": [
"id",
"name",
"message_type",
"message_content",
"media_url",
"poll_options",
"created_at",
"contact_name",
"contact_phone"
],
"incremental": null
},
"group_redirect_clicks": {
"pk": "id",
"columns": [
"id",
"link_id",
"campaign_id",
"slug",
"kind",
"group_db_id",
"user_agent",
"utm_source",
"created_at"
],
"incremental": null
},
"group_redirect_links": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"slug",
"is_deep_link",
"click_count",
"redirect_count",
"is_active",
"created_at",
"cached_invite_url",
"cached_at",
"label",
"forced_group_id",
"forced_strict",
"cached_group_base",
"cached_instance_id"
],
"incremental": null
},
"group_send_leases": {
"pk": "id",
"columns": [
"id",
"group_jid_base",
"whatsapp_number_id",
"started_at",
"finished_at",
"expires_at",
"outcome",
"provider_message_id"
],
"incremental": null
},
"identity_blacklist": {
"pk": "id",
"columns": [
"id",
"kind",
"value",
"reason",
"distinct_cpfs",
"distinct_phones",
"distinct_names",
"created_at"
],
"incremental": null
},
"ig_comment_moderation": {
"pk": "id",
"columns": [
"id",
"comment_id",
"ig_account_id",
"media_id",
"media_permalink",
"media_thumb",
"media_caption",
"media_product_type",
"from_id",
"username",
"text_original",
"received_at",
"status",
"skip_reason",
"attempts",
"class",
"ai_class_raw",
"confidence",
"reason",
"ai_model",
"classified_at",
"hidden_at",
"hide_response",
"private_reply_sent_at",
"private_reply_error",
"suggested_reply",
"public_reply_sent_at",
"public_reply_by",
"unhidden_at",
"unhidden_by",
"review_verdict",
"reviewed_by",
"reviewed_at",
"customer_id",
"customer_name",
"customer_phone",
"contact_status",
"contact_note",
"updated_at"
],
"incremental": null
},
"ig_live_cart_notifications": {
"pk": "id",
"columns": [
"id",
"order_id",
"event_id",
"rule_id",
"kind",
"instagram_handle",
"message",
"status",
"scheduled_at",
"sent_at",
"channel",
"error",
"attempts",
"created_at",
"variant_index",
"manual_resends",
"source_key",
"comment_id",
"recipient_id",
"instagram_account_id"
],
"incremental": null
},
"ig_moderation_settings": {
"pk": "id",
"columns": [
"id",
"enabled",
"class_enabled",
"acusacao_min_confidence",
"private_reply_template",
"private_reply_tracking_suffix",
"public_reply_template",
"own_usernames",
"team_usernames",
"paused_until",
"updated_at"
],
"incremental": null
},
"instagram_account_capabilities": {
"pk": "whatsapp_number_id",
"columns": [
"whatsapp_number_id",
"human_agent_approved",
"checked_at",
"evidence"
],
"incremental": null
},
"instagram_comment_actions": {
"pk": "id",
"columns": [
"id",
"comment_id",
"rule_id",
"action_type",
"status",
"error_message",
"created_at"
],
"incremental": null
},
"instagram_comment_rules": {
"pk": "id",
"columns": [
"id",
"name",
"is_active",
"trigger_type",
"trigger_keywords",
"media_types",
"action_reply_comment",
"reply_comment_text",
"action_send_dm",
"dm_message_text",
"action_trigger_automation",
"automation_flow_id",
"cooldown_minutes",
"ai_generate_reply",
"ai_prompt",
"created_at",
"updated_at",
"target_media_id",
"target_media_caption",
"reply_comment_variations",
"dm_buttons",
"action_capture_lead",
"capture_event_id",
"capture_mode",
"capture_fallback_dm_text",
"min_delay_seconds",
"max_delay_seconds"
],
"incremental": null
},
"instagram_customer_links": {
"pk": "id",
"columns": [
"id",
"ig_user_id",
"username_norm",
"phone",
"customer_id",
"status",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"instagram_dm_reads": {
"pk": "id",
"columns": [
"id",
"user_id",
"username",
"last_read_at"
],
"incremental": null
},
"instagram_user_links": {
"pk": "id",
"columns": [
"id",
"username",
"ig_user_id",
"source",
"last_seen_at",
"created_at",
"previous_ig_user_ids"
],
"incremental": null
},
"internal_cashback": {
"pk": "id",
"columns": [
"id",
"customer_phone",
"customer_name",
"customer_email",
"origin_type",
"cashback_amount",
"min_purchase",
"coupon_code",
"is_used",
"used_at",
"used_sale_id",
"expires_at",
"created_at",
"updated_at",
"used_channel",
"used_external_ref",
"source_order_id"
],
"incremental": null
},
"inventory_audit_runs": {
"pk": "id",
"columns": [
"id",
"status",
"per_store",
"totals",
"error_message",
"started_at",
"finished_at",
"created_at"
],
"incremental": null
},
"inventory_barcode_aliases": {
"pk": "id",
"columns": [
"id",
"store_id",
"original_barcode",
"product_tiny_id",
"product_name",
"product_sku",
"notes",
"created_at"
],
"incremental": null
},
"inventory_correction_queue": {
"pk": "id",
"columns": [
"id",
"count_id",
"count_item_id",
"store_id",
"product_id",
"product_name",
"new_quantity",
"old_quantity",
"status",
"attempts",
"max_attempts",
"error_message",
"processed_at",
"created_at",
"updated_at"
],
"incremental": null
},
"inventory_count_items": {
"pk": "id",
"columns": [
"id",
"count_id",
"product_id",
"product_name",
"sku",
"barcode",
"counted_quantity",
"current_stock",
"divergence",
"correction_status",
"correction_error",
"corrected_at",
"created_at",
"updated_at",
"last_corrected_quantity"
],
"incremental": null
},
"inventory_counts": {
"pk": "id",
"columns": [
"id",
"store_id",
"scope",
"categories",
"status",
"total_products",
"counted_products",
"divergent_products",
"corrected_products",
"correction_errors",
"started_at",
"completed_at",
"created_at",
"updated_at",
"last_batch_at"
],
"incremental": null
},
"inventory_health_cache": {
"pk": "id",
"columns": [
"id",
"store_id",
"horizon_days",
"payload",
"computed_at",
"created_at"
],
"incremental": null
},
"inventory_incremental_runs": {
"pk": "id",
"columns": [
"id",
"status",
"days_window",
"since_date",
"progress",
"per_store",
"totals",
"error_message",
"finished_at",
"created_at"
],
"incremental": "created_at"
},
"inventory_sale_unmatched_items": {
"pk": "id",
"columns": [
"id",
"sale_id",
"item_code",
"product_name",
"variant_name",
"quantity",
"store_id",
"external_source",
"status",
"resolved_product_id",
"resolved_at",
"created_at",
"updated_at"
],
"incremental": null
},
"inventory_unresolved_barcodes": {
"pk": "id",
"columns": [
"id",
"count_id",
"store_id",
"barcode",
"scanned_quantity",
"photo_url",
"notes",
"status",
"resolved_product_tiny_id",
"resolved_product_name",
"resolved_at",
"created_at",
"updated_at"
],
"incremental": null
},
"lead_field_definitions": {
"pk": "id",
"columns": [
"id",
"key",
"label",
"field_type",
"options",
"required",
"is_active",
"sort_order",
"description",
"is_system",
"created_at",
"updated_at"
],
"incremental": null
},
"link_page_catalog_products": {
"pk": "id",
"columns": [
"id",
"page_id",
"shopify_product_id",
"handle",
"title",
"image_url",
"price",
"compare_at_price",
"product_type",
"grade_total",
"grade_available",
"grade_pct",
"is_active",
"is_new_arrival",
"is_bestseller",
"sort_order",
"last_synced_at",
"created_at",
"updated_at",
"clicks"
],
"incremental": null
},
"link_page_items": {
"pk": "id",
"columns": [
"id",
"page_id",
"item_type",
"label",
"url",
"icon",
"description",
"thumbnail_url",
"style_config",
"sort_order",
"is_active",
"clicks",
"created_at",
"updated_at",
"whatsapp_number_id",
"prefill_message",
"card_style",
"social_network"
],
"incremental": null
},
"link_page_leads": {
"pk": "id",
"columns": [
"id",
"page_id",
"seller_id",
"name",
"phone",
"customer_id",
"is_existing_customer",
"ad_lead_id",
"created_at"
],
"incremental": null
},
"link_page_visits": {
"pk": "id",
"columns": [
"id",
"page_id",
"item_id",
"event_type",
"utm_source",
"utm_medium",
"utm_campaign",
"utm_content",
"utm_term",
"referrer",
"user_agent",
"ip_hash",
"created_at",
"seller_id",
"lead_id",
"lead_phone",
"catalog_product_id",
"click_id",
"converted_at",
"conversion_value",
"conversion_external_order_id",
"pos_sale_id"
],
"incremental": "created_at"
},
"link_pages": {
"pk": "id",
"columns": [
"id",
"store_id",
"slug",
"title",
"subtitle",
"avatar_url",
"background_type",
"background_value",
"theme_config",
"meta_pixel_id",
"is_active",
"total_views",
"total_clicks",
"created_at",
"updated_at",
"seller_id",
"require_lead_capture",
"catalog_mode",
"catalog_auto_sync",
"logo_url"
],
"incremental": null
},
"live_campaign_dispatches": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"message_id",
"lead_id",
"phone",
"scheduled_at",
"sent_at",
"status",
"error_message",
"attempts",
"locked_until",
"created_at",
"whatsapp_number_id",
"channel",
"ig_user_id",
"ig_comment_id",
"template_category_at_send",
"unit_cost_at_send",
"provider_at_send",
"shadow_mode"
],
"incremental": null
},
"live_campaign_messages": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"sort_order",
"message_type",
"content",
"media_url",
"caption",
"delay_seconds",
"is_active",
"created_at",
"updated_at",
"meta_template_name",
"meta_template_language",
"meta_template_variables"
],
"incremental": null
},
"live_campaigns": {
"pk": "id",
"columns": [
"id",
"name",
"slug",
"trigger_phrase",
"is_active",
"default_delay_seconds",
"jess_prompt",
"jess_enabled",
"ask_shoe_size",
"whatsapp_number_id",
"total_leads",
"created_at",
"updated_at",
"channel_preference",
"shadow_mode",
"tipo_comunicacao"
],
"incremental": null
},
"live_catalog_invites": {
"pk": "id",
"columns": [
"id",
"event_id",
"order_id",
"customer_id",
"phone_key",
"phone",
"link_id",
"kind",
"status",
"send_after",
"attempts",
"send_seq",
"enqueued_at",
"sent_message_key",
"error",
"requested_by",
"created_at"
],
"incremental": null
},
"live_chat_messages": {
"pk": "id",
"columns": [
"id",
"session_id",
"viewer_name",
"viewer_phone",
"message",
"message_type",
"created_at"
],
"incremental": null
},
"live_code_parse_log": {
"pk": "id",
"columns": [
"id",
"comment_id",
"event_id",
"username",
"comment_text",
"parsed",
"outcome",
"intent_id",
"created_at"
],
"incremental": null
},
"live_code_settings": {
"pk": "event_id",
"columns": [
"event_id",
"mode",
"overlay_previous_minutes",
"overlay_show_codes",
"updated_at",
"store_usernames"
],
"incremental": null
},
"live_comment_dms": {
"pk": "id",
"columns": [
"id",
"event_id",
"comment_id",
"username",
"message",
"status",
"meta_message_id",
"error_details",
"sent_by",
"created_at"
],
"incremental": null
},
"live_comments": {
"pk": "id",
"columns": [
"id",
"event_id",
"comment_id",
"username",
"comment_text",
"profile_pic_url",
"is_order",
"ai_confidence",
"ai_classification",
"extracted_products",
"order_id",
"source_pc",
"raw_timestamp",
"created_at"
],
"incremental": "created_at"
},
"live_followup_cart_leases": {
"pk": "order_id",
"columns": [
"order_id",
"job_id",
"created_at"
],
"incremental": null
},
"live_followup_instances": {
"pk": "whatsapp_number_id",
"columns": [
"whatsapp_number_id",
"next_send_at",
"paused",
"reason",
"consecutive_errors",
"last_message"
],
"incremental": null
},
"live_followup_jobs": {
"pk": "id",
"columns": [
"id",
"event_id",
"order_id",
"access_id",
"customer_key",
"phone",
"instagram",
"whatsapp_number_id",
"channel",
"type",
"step",
"sequence_key",
"variant",
"message",
"scheduled_at",
"base_at",
"status",
"reason",
"claimed_at",
"sent_at",
"message_id",
"created_at",
"button_clicked_at",
"button_expires_at",
"original_scheduled_at",
"postponed_count",
"postponed_minutes",
"postponed_reason"
],
"incremental": "created_at"
},
"live_followup_settings": {
"pk": "id",
"columns": [
"id",
"value",
"updated_at"
],
"incremental": null
},
"live_followup_sources": {
"pk": "source_key",
"columns": [
"source_key",
"event_id",
"order_id",
"access_id",
"changed_at"
],
"incremental": null
},
"live_order_intent_dismissals": {
"pk": "id",
"columns": [
"id",
"event_id",
"username",
"dismissed_at",
"dismissed_by",
"created_at"
],
"incremental": null
},
"live_order_intents": {
"pk": "id",
"columns": [
"id",
"event_id",
"username",
"items",
"phone_last4",
"phone",
"status",
"warnings",
"source_comment_ids",
"last_comment_text",
"order_id",
"confirmed_by",
"confirmed_at",
"created_at",
"updated_at",
"target_order_id",
"kind",
"confirmed_items"
],
"incremental": null
},
"live_overlay_events": {
"pk": "id",
"columns": [
"id",
"event_id",
"kind",
"payload",
"created_at"
],
"incremental": null
},
"live_overlay_settings": {
"pk": "event_id",
"columns": [
"event_id",
"config",
"hidden",
"updated_at"
],
"incremental": null
},
"live_overlay_templates": {
"pk": "id",
"columns": [
"id",
"name",
"config",
"is_default",
"created_at"
],
"incremental": null
},
"live_phone_verifications": {
"pk": "id",
"columns": [
"id",
"phone",
"code",
"verified",
"expires_at",
"created_at"
],
"incremental": null
},
"live_presenter_products": {
"pk": "id",
"columns": [
"id",
"event_id",
"code",
"offer_price",
"free_shipping",
"interest_free_installments",
"created_by",
"created_at",
"updated_at",
"available_sizes",
"promotion_id"
],
"incremental": null
},
"live_redirect_clicks": {
"pk": "id",
"columns": [
"id",
"redirect_id",
"event_id",
"phone",
"utm_source",
"user_agent",
"target_url",
"created_at"
],
"incremental": null
},
"live_redirect_links": {
"pk": "id",
"columns": [
"id",
"name",
"slug",
"is_active",
"click_count",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"live_selfservice_accesses": {
"pk": "id",
"columns": [
"id",
"event_id",
"entered_phone",
"phone_key",
"instagram",
"order_ids",
"lead_id",
"viewed_product_at",
"registered_at",
"paid_at",
"user_agent",
"created_at",
"updated_at",
"confirm_code",
"whatsapp_confirmed_at",
"confirmed_phone",
"confirmed_phone_key",
"confirmed_number_id",
"confirm_message_id",
"metadata",
"form_draft",
"advertising_consent_id",
"advertising_snapshot",
"advertising_signals",
"live_followup_phone_at"
],
"incremental": null
},
"live_sessions": {
"pk": "id",
"columns": [
"id",
"title",
"youtube_video_id",
"whatsapp_link",
"is_active",
"selected_products",
"created_at",
"updated_at",
"spotlight_products",
"freight_config",
"overlay_config"
],
"incremental": null
},
"live_shown_products": {
"pk": "id",
"columns": [
"id",
"event_id",
"code",
"shown_at",
"shown_by",
"source",
"is_current",
"stopped_at"
],
"incremental": null
},
"live_viewers": {
"pk": "id",
"columns": [
"id",
"session_id",
"name",
"phone",
"joined_at",
"last_seen_at",
"is_online",
"cart_value",
"messages_count",
"is_banned",
"ban_reason",
"cart_items",
"checkout_completed",
"checkout_completed_at",
"checkout_url",
"payment_platform",
"payment_method"
],
"incremental": null
},
"live_whatsapp_clicks": {
"pk": "id",
"columns": [
"id",
"link_id",
"event_id",
"code",
"fbc",
"fbp",
"fbclid",
"utm_source",
"utm_medium",
"utm_campaign",
"utm_content",
"utm_term",
"user_agent",
"ip",
"referer",
"phone",
"whatsapp_number_id",
"matched_at",
"match_method",
"message_id",
"created_at",
"entered_phone",
"entered_phone_key",
"confirmed_at",
"real_phone",
"divergent",
"superseded",
"lead_id"
],
"incremental": null
},
"live_whatsapp_links": {
"pk": "id",
"columns": [
"id",
"event_id",
"name",
"slug",
"whatsapp_number_id",
"target_phone",
"message_text",
"is_active",
"click_count",
"created_at",
"updated_at"
],
"incremental": null
},
"livete_ig_initial_dm_log": {
"pk": "id",
"columns": [
"id",
"order_id",
"status",
"pg_net_request_id",
"error_message",
"created_at"
],
"incremental": null
},
"livete_payment_confirmation_sent": {
"pk": "order_id",
"columns": [
"order_id",
"phone",
"sent_at"
],
"incremental": null
},
"livete_presenter_alerts": {
"pk": "id",
"columns": [
"id",
"event_id",
"order_id",
"phone",
"customer_name",
"alert_type",
"message",
"product_title",
"is_read",
"created_at"
],
"incremental": null
},
"livete_processing_locks": {
"pk": "phone",
"columns": [
"phone",
"locked_at",
"message_hash"
],
"incremental": null
},
"loyalty_config": {
"pk": "id",
"columns": [
"id",
"store_id",
"is_enabled",
"points_per_real",
"points_expiry_days",
"wheel_enabled",
"created_at",
"updated_at"
],
"incremental": null
},
"loyalty_points_log": {
"pk": "id",
"columns": [
"id",
"customer_phone",
"store_id",
"points",
"type",
"sale_id",
"prize_id",
"description",
"created_at"
],
"incremental": null
},
"loyalty_prize_tiers": {
"pk": "id",
"columns": [
"id",
"store_id",
"name",
"min_points",
"prize_type",
"prize_value",
"prize_label",
"color",
"is_active",
"sort_order",
"created_at",
"updated_at"
],
"incremental": null
},
"lp_leads": {
"pk": "id",
"columns": [
"id",
"campaign_tag",
"name",
"phone",
"email",
"instagram",
"source",
"metadata",
"converted",
"converted_at",
"created_at",
"recovery_disparo",
"recovery_ultimo_disparo_at",
"recovery_session_id",
"fbc",
"fbp",
"fbclid",
"utm_source",
"utm_medium",
"utm_campaign",
"utm_content",
"utm_term",
"canal_captacao",
"event_id",
"dispatch_excluded_reason",
"dispatch_excluded_at"
],
"incremental": null
},
"marketing_calendar_entries": {
"pk": "id",
"columns": [
"id",
"entry_date",
"title",
"content",
"entry_type",
"media_url",
"media_type",
"color",
"created_at",
"updated_at",
"text_color",
"end_date"
],
"incremental": null
},
"marketing_calendar_goals": {
"pk": "id",
"columns": [
"id",
"year",
"month",
"goals",
"actions",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"marketing_campaigns": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"objective",
"status",
"ai_strategy",
"ai_prompt",
"channels",
"whatsapp_template_name",
"whatsapp_template_params",
"whatsapp_number_id",
"contact_list_id",
"target_audience",
"scheduled_at",
"started_at",
"completed_at",
"total_recipients",
"sent_count",
"delivered_count",
"read_count",
"failed_count",
"content",
"created_at",
"updated_at",
"start_date",
"end_date",
"budget",
"actual_cost",
"attributed_revenue",
"attributed_orders",
"leads_captured",
"people_reached"
],
"incremental": null
},
"marketing_contact_lists": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"source",
"source_event_id",
"contact_count",
"created_at",
"updated_at"
],
"incremental": null
},
"marketing_contacts": {
"pk": "id",
"columns": [
"id",
"list_id",
"name",
"phone",
"email",
"instagram",
"tags",
"metadata",
"created_at"
],
"incremental": null
},
"marketing_recurring_actions": {
"pk": "id",
"columns": [
"id",
"title",
"content",
"color",
"recurrence_type",
"recurrence_config",
"start_date",
"end_date",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"marketing_send_logs": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"contact_id",
"channel",
"phone",
"email",
"status",
"error_message",
"meta_message_id",
"sent_at",
"delivered_at",
"read_at",
"created_at"
],
"incremental": null
},
"mass_dispatch_campaigns": {
"pk": "id",
"columns": [
"id",
"name",
"message",
"audience_filters",
"whatsapp_number_id",
"status",
"attribution_days",
"total_targets",
"sent_count",
"failed_count",
"started_at",
"completed_at",
"created_at",
"updated_at",
"shadow_mode"
],
"incremental": null
},
"mass_dispatch_targets": {
"pk": "id",
"columns": [
"id",
"campaign_id",
"contact_id",
"phone",
"phone_suffix8",
"display_name",
"status",
"message_id",
"error",
"sent_at",
"created_at",
"updated_at",
"template_category_at_send",
"unit_cost_at_send",
"provider_at_send",
"shadow_mode"
],
"incremental": null
},
"master_merge_log": {
"pk": "id",
"columns": [
"id",
"run_id",
"base_name",
"canonical_master_id",
"loser_master_id",
"action",
"details",
"created_at"
],
"incremental": null
},
"message_funnel_steps": {
"pk": "value",
"columns": [
"value",
"label",
"kind",
"sort_order",
"created_at"
],
"incremental": null
},
"message_templates": {
"pk": "id",
"columns": [
"id",
"name",
"message",
"stage",
"created_at",
"updated_at",
"funnel_step",
"variants"
],
"incremental": null
},
"meta_ad_accounts": {
"pk": "id",
"columns": [
"id",
"account_id",
"account_name",
"is_active",
"created_at"
],
"incremental": null
},
"meta_ad_spend_daily": {
"pk": "id",
"columns": [
"id",
"account_id",
"date",
"spend",
"impressions",
"clicks",
"cpm",
"cpc",
"created_at"
],
"incremental": null
},
"meta_ads_adset_spend_daily": {
"pk": "id",
"columns": [
"id",
"account_id",
"campaign_id",
"campaign_name",
"adset_id",
"adset_name",
"date",
"spend",
"impressions",
"reach",
"link_clicks",
"synced_at"
],
"incremental": null
},
"meta_ads_campaign_group_overrides": {
"pk": "campaign_id",
"columns": [
"campaign_id",
"campaign_name",
"group_override",
"updated_at"
],
"incremental": null
},
"meta_ads_campaign_spend_daily": {
"pk": "id",
"columns": [
"id",
"account_id",
"campaign_id",
"campaign_name",
"objective",
"date",
"spend",
"impressions",
"reach",
"link_clicks",
"synced_at"
],
"incremental": null
},
"meta_ads_sync_runs": {
"pk": "id",
"columns": [
"id",
"ran_at",
"status",
"rows_upserted",
"since",
"until",
"error"
],
"incremental": null
},
"meta_attribution_identities": {
"pk": "id",
"columns": [
"id",
"phone",
"fbc",
"fbp",
"ctwa_clid",
"fbclid",
"click_time",
"ad_id",
"source_url",
"origin",
"lead_id",
"metadata",
"first_seen_at",
"last_seen_at",
"expires_at"
],
"incremental": null
},
"meta_audience_definitions": {
"pk": "id",
"columns": [
"id",
"rule_key",
"audience_id",
"name",
"description",
"kind",
"enabled",
"frozen",
"initial_mode",
"initial_load_done",
"initial_load_not_before",
"last_sync_at",
"last_status",
"last_error",
"erp_count",
"invalid_count",
"duplicate_count",
"added_last",
"removed_last",
"total_sent",
"total_removed",
"meta_approx_lower",
"meta_approx_upper",
"meta_checked_at",
"created_at",
"updated_at"
],
"incremental": null
},
"meta_audience_sync_runs": {
"pk": "id",
"columns": [
"id",
"definition_id",
"started_at",
"finished_at",
"status",
"mode",
"erp_count",
"added",
"removed",
"error",
"details"
],
"incremental": null
},
"meta_capi_lead_events": {
"pk": "id",
"columns": [
"id",
"phone",
"event_name",
"event_id",
"campaign_id",
"campaign_slug",
"pixel_id",
"status",
"meta_response",
"error_message",
"sent_at",
"created_at"
],
"incremental": null
},
"meta_capi_offline_log": {
"pk": "id",
"columns": [
"id",
"sale_id",
"event_name",
"event_id",
"dataset_id",
"test_event_code",
"status",
"http_status",
"meta_response",
"error_message",
"payload_summary",
"created_at",
"sent_at"
],
"incremental": "created_at"
},
"meta_capi_purchase_log": {
"pk": "id",
"columns": [
"id",
"order_id",
"event_name",
"event_id",
"pixel_id",
"test_event_code",
"status",
"http_status",
"meta_response",
"error_message",
"payload_summary",
"created_at",
"sent_at"
],
"incremental": "created_at"
},
"meta_media_cache": {
"pk": "id",
"columns": [
"id",
"phone_number_id",
"media_url",
"media_id",
"mime_type",
"uploaded_at",
"expires_at",
"created_at"
],
"incremental": null
},
"meta_message_queue": {
"pk": "id",
"columns": [
"id",
"phone",
"template_name",
"template_language",
"template_params",
"status",
"error_message",
"attempts",
"max_attempts",
"scheduled_at",
"sent_at",
"created_at",
"updated_at"
],
"incremental": null
},
"meta_template_category_alerts": {
"pk": "id",
"columns": [
"id",
"template_name",
"template_language",
"whatsapp_number_id",
"previous_category",
"new_category",
"cost_previous_brl",
"cost_new_brl",
"cost_delta_pct",
"acknowledged",
"acknowledged_by",
"acknowledged_at",
"detected_at",
"created_at",
"updated_at"
],
"incremental": null
},
"meta_template_status_log": {
"pk": "id",
"columns": [
"id",
"template_id",
"template_name",
"language",
"event",
"rejected_reason",
"raw_payload",
"created_at",
"updated_at"
],
"incremental": null
},
"module_access_log": {
"pk": "id",
"columns": [
"id",
"user_id",
"user_email",
"module",
"route",
"event_id",
"ip",
"user_agent",
"hits",
"bucket_at",
"created_at",
"updated_at"
],
"incremental": "created_at"
},
"monthly_goals": {
"pk": "id",
"columns": [
"id",
"mes_ref",
"loja",
"meta_faturamento_brl",
"observacao",
"created_at",
"updated_at"
],
"incremental": null
},
"nfe_distribuicao_state": {
"pk": "company_id",
"columns": [
"company_id",
"ultimo_nsu",
"max_nsu",
"last_sync_at",
"last_error",
"created_at",
"updated_at"
],
"incremental": null
},
"nfe_received": {
"pk": "id",
"columns": [
"id",
"company_id",
"chave_acesso",
"numero",
"serie",
"modelo",
"emitente_cnpj",
"emitente_nome",
"emitente_uf",
"destinatario_cnpj",
"valor_total",
"data_emissao",
"natureza_operacao",
"tipo_operacao",
"manifestacao_status",
"manifestacao_data",
"manifestacao_protocolo",
"manifestacao_justificativa",
"estoque_status",
"estoque_lancado_em",
"estoque_lancado_por",
"xml_resumo_content",
"xml_completo_content",
"xml_url",
"danfe_url",
"brasilnfe_response",
"nsu",
"created_at",
"updated_at"
],
"incremental": null
},
"nfe_received_events": {
"pk": "id",
"columns": [
"id",
"nfe_received_id",
"event_type",
"status",
"protocolo",
"justificativa",
"request_payload",
"response_payload",
"performed_by",
"created_at"
],
"incremental": null
},
"online_exchanges": {
"pk": "id",
"columns": [
"id",
"shopify_order_id",
"shopify_order_name",
"shopify_order_number",
"customer_name",
"customer_email",
"customer_phone",
"customer_cpf",
"product_name",
"product_sku",
"product_variant",
"quantity",
"reason_category",
"reason_detail",
"status",
"received_at",
"inspected_at",
"completed_at",
"created_by",
"notes",
"created_at",
"updated_at"
],
"incremental": "created_at"
},
"order_crossell_items": {
"pk": "id",
"columns": [
"id",
"order_id",
"event_id",
"offer_id",
"shopify_product_id",
"shopify_variant_id",
"title",
"color",
"size",
"image",
"original_price",
"discount_price",
"qty",
"added_at"
],
"incremental": null
},
"order_payment_events": {
"pk": "id",
"columns": [
"id",
"order_id",
"customer_phone",
"event_type",
"method",
"gateway",
"amount",
"detail",
"source",
"metadata",
"created_at"
],
"incremental": null
},
"order_shopify_history": {
"pk": "id",
"columns": [
"id",
"order_id",
"previous_shopify_order_id",
"previous_shopify_order_name",
"new_shopify_order_id",
"new_shopify_order_name",
"action",
"reason",
"performed_by",
"created_at"
],
"incremental": null
},
"order_tag_assignments": {
"pk": "id",
"columns": [
"id",
"order_id",
"tag_id",
"created_by",
"created_at"
],
"incremental": null
},
"order_tags": {
"pk": "id",
"columns": [
"id",
"name",
"color",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"orders": {
"pk": "id",
"columns": [
"id",
"event_id",
"customer_id",
"cart_link",
"notes",
"stage",
"products",
"has_unread_messages",
"last_customer_message_at",
"last_sent_message_at",
"is_paid",
"paid_at",
"created_at",
"updated_at",
"discount_type",
"discount_value",
"free_shipping",
"has_gift",
"coupon_code",
"paid_externally",
"checkout_started_at",
"eligible_for_prize",
"pos_sale_id",
"pagarme_order_id",
"vindi_transaction_id",
"appmax_order_id",
"mercadopago_payment_id",
"shipping_cost",
"custom_shipping_cost",
"pickup_store_id",
"is_pickup",
"is_delivery",
"ai_paused",
"ai_paused_at",
"shopify_order_name",
"delivery_method",
"stage_atendimento",
"mp_account_id",
"max_installments_override",
"meta_capi_purchase_sent_at",
"shopify_order_id",
"customer_unified_id",
"payment_method_label",
"installments",
"shipping_info",
"merged_into_order_id",
"merged_at",
"merged_by",
"payment_confirmed_source",
"gift_description",
"payment_on_delivery",
"expected_payment_method",
"release_to_expedition",
"customer_confirmed_at",
"payment_window_expires_at",
"confirmed_items_signature",
"pos_routing_claimed_at",
"pickup_date",
"pickup_pay_at_store",
"paid_on_site",
"is_sedex",
"phone_last4",
"link_status",
"shipping_type",
"austpay_transaction_id",
"cashback_id",
"cashback_amount",
"preselected_installments",
"registered_at",
"selfservice_cart_sent_at",
"selfservice_cart_message_id",
"selfservice_cashback_receipt",
"dispatch_id",
"dispatch_recipient_id",
"dispatch_clicked_at",
"attribution",
"origin",
"payment_review_required",
"gateway_amount",
"gateway_snapshot",
"live_followup_first_item_at",
"live_followup_cart_sent_at",
"checkout_installment_config",
"voucher_id",
"voucher_amount"
],
"incremental": "created_at"
},
"orders_deleted_log": {
"pk": "id",
"columns": [
"id",
"order_id",
"event_id",
"customer_id",
"stage",
"is_paid",
"mercadopago_payment_id",
"gateway_amount",
"had_pending_charge",
"deleted_at",
"deleted_by",
"snapshot"
],
"incremental": null
},
"orphan_payments": {
"pk": "id",
"columns": [
"id",
"gateway",
"payment_id",
"external_reference",
"event_id",
"amount",
"payer_name",
"payer_email",
"payer_phone",
"deleted_order_snapshot",
"status",
"created_at",
"resolved_at",
"resolved_order_id",
"resolved_by"
],
"incremental": null
},
"otp_template_settings": {
"pk": "id",
"columns": [
"id",
"whatsapp_number_id",
"template_name",
"template_language",
"code_variable_index",
"copy_code_button",
"fallback_to_text",
"updated_at"
],
"incremental": null
},
"participant_score_cache": {
"pk": "handle",
"columns": [
"handle",
"comment_count",
"live_count",
"paid_orders",
"cancelled_orders",
"total_spent",
"avg_ticket",
"last_participation",
"live_dates",
"score",
"category",
"refreshed_at"
],
"incremental": null
},
"payment_method_fees": {
"pk": "id",
"columns": [
"id",
"acquirer",
"method",
"brand",
"installments",
"fee_pct",
"fixed_fee",
"days_to_receive",
"active",
"created_at",
"updated_at",
"product",
"receipt_schedule",
"notes"
],
"incremental": null
},
"payment_splits": {
"pk": "id",
"columns": [
"id",
"order_id",
"sale_id",
"seq",
"method",
"amount",
"discount_amount",
"charge_amount",
"installments",
"gateway",
"gateway_tx_id",
"request_id",
"status",
"paid_at",
"created_by",
"created_at",
"updated_at",
"vps_reference",
"vps_confirmed_by",
"vps_confirmed_at"
],
"incremental": null
},
"paypal_payments": {
"pk": "id",
"columns": [
"id",
"order_id",
"paypal_order_id",
"amount",
"currency",
"status",
"payer_name",
"payer_email",
"capture_id",
"created_at",
"updated_at"
],
"incremental": null
},
"point_payment_intents": {
"pk": "id",
"columns": [
"id",
"external_reference",
"terminal_id",
"amount",
"description",
"mp_order_id",
"mp_payment_id",
"status",
"mp_status",
"store_id",
"sale_id",
"mp_account_id",
"is_sandbox",
"error_message",
"raw_response",
"created_by",
"paid_at",
"created_at",
"updated_at"
],
"incremental": "created_at"
},
"pos_boletos": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"created_by",
"customer_name",
"customer_cpf",
"customer_email",
"customer_phone",
"address_zip",
"address_street",
"address_number",
"address_complement",
"address_neighborhood",
"address_city",
"address_state",
"amount",
"description",
"due_date",
"mp_account_id",
"mp_payment_id",
"mp_boleto_url",
"mp_barcode",
"mp_pix_payment_id",
"mp_pix_qr_code",
"mp_pix_qr_base64",
"pdf_path",
"status",
"paid_at",
"error_message",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_cash_movements": {
"pk": "id",
"columns": [
"id",
"cash_register_id",
"store_id",
"seller_id",
"type",
"amount",
"description",
"created_at",
"counterpart_bank_account_id",
"transfer_pair_id"
],
"incremental": null
},
"pos_cash_registers": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"opened_at",
"closed_at",
"opening_balance",
"closing_balance",
"expected_balance",
"cash_sales",
"card_sales",
"pix_sales",
"other_sales",
"withdrawals",
"deposits",
"difference",
"notes",
"status",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_cashback_config": {
"pk": "id",
"columns": [
"id",
"store_id",
"is_enabled",
"percentage",
"validity_days",
"min_sale_value",
"min_purchase_multiplier",
"max_cashback",
"code_prefix",
"cooldown_days",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_checkout_attempts": {
"pk": "id",
"columns": [
"id",
"sale_id",
"store_id",
"payment_method",
"status",
"error_message",
"amount",
"customer_name",
"customer_phone",
"customer_email",
"gateway",
"transaction_id",
"metadata",
"created_at",
"split_start_gateway",
"gateways_tried"
],
"incremental": null
},
"pos_commission_live_event_optouts": {
"pk": "id",
"columns": [
"id",
"person_id",
"event_id",
"store_id",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_commission_live_participants": {
"pk": "id",
"columns": [
"id",
"person_id",
"store_id",
"period_start",
"period_end",
"created_at"
],
"incremental": null
},
"pos_commission_people": {
"pk": "id",
"columns": [
"id",
"name",
"is_active",
"receives_all_lives",
"manual_goal_value",
"created_at",
"updated_at",
"base_salary",
"role_bonus_percent",
"role_title",
"is_employee_only",
"provision_13",
"provision_vacation",
"provision_notice",
"provision_charges_percent"
],
"incremental": null
},
"pos_commission_people_sellers": {
"pk": "id",
"columns": [
"id",
"person_id",
"seller_id",
"created_at"
],
"incremental": null
},
"pos_commission_scale": {
"pk": "id",
"columns": [
"id",
"achievement_percent",
"commission_percent",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_conditionals": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"customer_id",
"conditional_type",
"items",
"due_date",
"returned_at",
"status",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_crediario_gateways": {
"pk": "id",
"columns": [
"id",
"name",
"is_active",
"sort_order",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_crediario_installments": {
"pk": "id",
"columns": [
"id",
"sale_id",
"store_id",
"customer_id",
"customer_name",
"customer_phone",
"customer_cpf",
"installment_number",
"installments_total",
"amount",
"due_date",
"status",
"paid_amount",
"paid_at",
"paid_method",
"gateway",
"code",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_customers": {
"pk": "id",
"columns": [
"id",
"name",
"email",
"whatsapp",
"cpf",
"address",
"city",
"state",
"cep",
"neighborhood",
"address_number",
"complement",
"age_range",
"preferred_style",
"notes",
"created_at",
"updated_at",
"shoe_size",
"gender",
"has_children",
"children_age_range",
"previous_whatsapp_numbers"
],
"incremental": null
},
"pos_exchanges": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"customer_id",
"exchange_type",
"status",
"original_sale_id",
"returned_items",
"returned_total",
"return_reason",
"new_items",
"new_total",
"difference_amount",
"difference_payment_method",
"credit_amount",
"credit_code",
"credit_used_at",
"credit_expires_at",
"notes",
"created_at",
"updated_at",
"original_sale_source",
"original_seller_id",
"original_seller_name"
],
"incremental": null
},
"pos_expedition_checks": {
"pk": "id",
"columns": [
"id",
"sale_id",
"sale_item_id",
"barcode",
"scanned",
"feet_ok",
"has_defect",
"notes",
"checked_by",
"checked_by_name",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_gamification": {
"pk": "id",
"columns": [
"id",
"seller_id",
"store_id",
"total_points",
"weekly_points",
"total_sales",
"complete_registrations",
"partial_registrations",
"fast_requests_answered",
"returns_count",
"badges",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_goal_progress": {
"pk": "id",
"columns": [
"id",
"goal_id",
"seller_id",
"current_value",
"last_sale_id",
"updated_at"
],
"incremental": null
},
"pos_goals": {
"pk": "id",
"columns": [
"id",
"store_id",
"goal_type",
"goal_value",
"period",
"seller_id",
"is_active",
"created_at",
"updated_at",
"goal_category",
"goal_brand",
"period_start",
"period_end",
"prize_label",
"prize_value",
"prize_type"
],
"incremental": null
},
"pos_inter_store_requests": {
"pk": "id",
"columns": [
"id",
"from_store_id",
"to_store_id",
"requested_by",
"responded_by",
"status",
"items",
"courier_name",
"courier_phone",
"estimated_arrival",
"delivered_at",
"customer_name",
"customer_phone",
"notes",
"priority",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_invoice_config": {
"pk": "id",
"columns": [
"id",
"store_id",
"auto_emit_on_sale",
"auto_emit_min_value",
"auto_emit_payment_methods",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_link_confirmation_sent": {
"pk": "sale_id",
"columns": [
"sale_id",
"whatsapp_number_id",
"sent_at",
"created_at"
],
"incremental": null
},
"pos_payment_receipts": {
"pk": "id",
"columns": [
"id",
"store_id",
"cash_register_id",
"sale_id",
"payment_method",
"amount",
"receipt_image_url",
"notes",
"uploaded_by",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_payroll_period_entries": {
"pk": "id",
"columns": [
"id",
"person_id",
"period_start",
"period_end",
"overtime_hours",
"overtime_value",
"benefits_bonus",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_pickup_alerts": {
"pk": "id",
"columns": [
"id",
"store_id",
"sale_id",
"order_id",
"alert_type",
"target_date",
"customer_name",
"total",
"dismissed_at",
"dismissed_by",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_prizes": {
"pk": "id",
"columns": [
"id",
"store_id",
"name",
"description",
"min_points",
"prize_type",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_product_pricing_rules": {
"pk": "id",
"columns": [
"id",
"store_id",
"pickup_discount_percent",
"physical_store_price_source",
"physical_store_markup_percent",
"delivery_fee",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_product_requests": {
"pk": "id",
"columns": [
"id",
"requesting_store_id",
"target_store_id",
"requested_by",
"answered_by",
"items",
"status",
"priority",
"requested_at",
"answered_at",
"notes",
"points_awarded",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_product_searches": {
"pk": "id",
"columns": [
"id",
"store_id",
"product_description",
"category",
"brand",
"size",
"customer_name",
"customer_phone",
"notes",
"searched_at",
"created_by",
"created_at"
],
"incremental": null
},
"pos_product_sync_log": {
"pk": "id",
"columns": [
"id",
"store_id",
"status",
"products_synced",
"error_message",
"started_at",
"completed_at",
"total_products"
],
"incremental": null
},
"pos_products": {
"pk": "id",
"columns": [
"id",
"store_id",
"tiny_id",
"sku",
"name",
"variant",
"size",
"color",
"category",
"price",
"barcode",
"stock",
"image_url",
"is_active",
"synced_at",
"created_at",
"updated_at",
"cost_price",
"parent_sku",
"category_id",
"gender",
"age_group",
"price_tier_id",
"auto_classified",
"classification_confidence",
"brand",
"brand_source",
"category_source",
"gender_source"
],
"incremental": null
},
"pos_purchase_lists": {
"pk": "id",
"columns": [
"id",
"store_id",
"name",
"created_by",
"created_by_name",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_purchase_requests": {
"pk": "id",
"columns": [
"id",
"store_id",
"list_id",
"product_name",
"variant_name",
"size",
"sku",
"barcode",
"quantity",
"cost_price",
"status",
"notes",
"requested_by",
"requested_by_name",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_returns": {
"pk": "id",
"columns": [
"id",
"store_id",
"sale_id",
"seller_id",
"customer_id",
"return_type",
"reason",
"reason_detail",
"items",
"refund_amount",
"status",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_sale_items": {
"pk": "id",
"columns": [
"id",
"sale_id",
"tiny_product_id",
"sku",
"barcode",
"product_name",
"variant_name",
"size",
"category",
"unit_price",
"quantity",
"total_price",
"created_at",
"ncm_snapshot",
"cfop_snapshot",
"cst_icms",
"csosn_icms",
"aliq_icms",
"cst_pis",
"aliq_pis",
"cst_cofins",
"aliq_cofins",
"origem_mercadoria",
"cest_snapshot",
"unidade_comercial",
"expedition_picked_qty",
"expedition_conference_qty",
"expedition_waiting_qty",
"expedition_completed_qty",
"cost_price_at_sale",
"cost_source",
"original_unit_price",
"fiscal_unit_price"
],
"incremental": null
},
"pos_sale_price_adjustments": {
"pk": "id",
"columns": [
"id",
"sale_id",
"mode",
"value",
"reason",
"total_before",
"total_after",
"refund_amount",
"items_before",
"refund_done_at",
"created_by",
"created_at",
"reverted_at",
"reverted_by",
"auto_rule_gateway"
],
"incremental": null
},
"pos_sales": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"customer_id",
"tiny_order_id",
"tiny_invoice_id",
"invoice_number",
"invoice_pdf_url",
"subtotal",
"discount",
"total",
"payment_method",
"payment_details",
"status",
"cash_register_id",
"notes",
"created_at",
"updated_at",
"nfce_number",
"nfce_key",
"nfce_pdf_url",
"tiny_order_number",
"source_order_id",
"sale_type",
"payment_link",
"payment_gateway",
"stock_source_store_id",
"payment_method_detail",
"crediario_status",
"crediario_due_date",
"crediario_paid_at",
"crediario_paid_method",
"crediario_paid_amount",
"expedition_status",
"tracking_code",
"shipped_at",
"shipping_address",
"shipping_notes",
"customer_name",
"customer_phone",
"checkout_step",
"paid_at",
"pagarme_order_id",
"vindi_transaction_id",
"appmax_order_id",
"mercadopago_payment_id",
"mp_account_id",
"revenue_attribution",
"external_order_id",
"external_source",
"shipping_cost",
"event_id",
"crediario_gateway",
"customer_email",
"customer_cpf",
"customer_city",
"customer_state",
"customer_cep",
"customer_unified_id",
"is_conditional",
"conditional_status",
"conditional_signed_at",
"status_cancelamento",
"motivo_cancelamento",
"tracking_carrier",
"expedition_stage",
"expedition_group_id",
"shipping_carrier",
"courier_name",
"pickup_store_id",
"expedition_finished_at",
"tracking_url",
"delivery_days",
"has_gift",
"gift_description",
"gift_added_at",
"gift_after_completion",
"payment_on_delivery",
"expected_payment_method",
"delivery_payment_received_at",
"delivery_payment_method",
"expedition_deleted_by",
"expedition_deleted_at",
"expedition_deleted_by_email",
"sale_released_at",
"utm_source",
"utm_medium",
"utm_campaign",
"utm_content",
"utm_term",
"lp_click_id",
"link_page_id",
"link_page_item_id",
"link_page_catalog_product_id",
"attribution_source",
"pickup_date",
"is_store_pickup",
"phone_suffix8",
"is_sedex",
"sales_channel",
"shipping_type",
"expedition_waiting_products",
"austpay_transaction_id",
"payment_review_required",
"gateway_amount",
"gateway_snapshot",
"shipped_source",
"voucher_id",
"voucher_amount",
"cashback_id",
"cashback_amount"
],
"incremental": null
},
"pos_sales_cpf_backfill_log": {
"pk": "id",
"columns": [
"id",
"sale_id",
"pos_customer_id",
"cpf_set",
"matched_from",
"created_at"
],
"incremental": null
},
"pos_sales_cpf_pending": {
"pk": "sale_id",
"columns": [
"sale_id",
"sale_created_at",
"customer_name",
"pos_customer_id",
"reason",
"cadastro_cpf",
"pagamento_cpfs",
"resolved_at",
"created_at"
],
"incremental": null
},
"pos_sales_reattribution_log": {
"pk": "id",
"columns": [
"id",
"sale_id",
"old_unified_id",
"new_unified_id",
"reason",
"created_at"
],
"incremental": null
},
"pos_seller_commission_tiers": {
"pk": "id",
"columns": [
"id",
"store_id",
"tier_order",
"min_revenue",
"max_revenue",
"commission_percent",
"period",
"period_start",
"period_end",
"is_active",
"created_at",
"updated_at",
"goal_value",
"achievement_percent"
],
"incremental": null
},
"pos_seller_commissions": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"period_start",
"period_end",
"total_revenue",
"tier_id",
"commission_percent",
"commission_value",
"bonus_value",
"status",
"created_at"
],
"incremental": null
},
"pos_seller_task_instances": {
"pk": "id",
"columns": [
"id",
"definition_id",
"store_id",
"seller_id",
"due_date",
"status",
"progress_current",
"progress_target",
"completion_mode",
"payload",
"completed_at",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_seller_tasks": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"task_type",
"title",
"description",
"customer_phone",
"customer_name",
"source",
"rfm_segment",
"points_reward",
"status",
"completed_at",
"due_date",
"created_at",
"updated_at",
"contact_strategy",
"offer_description",
"avg_ticket",
"completion_notes",
"completed_by_seller_id"
],
"incremental": null
},
"pos_sellers": {
"pk": "id",
"columns": [
"id",
"store_id",
"name",
"tiny_seller_id",
"is_active",
"created_at",
"updated_at",
"pin_code",
"linked_user_id",
"is_manager",
"whatsapp_phone",
"excluded_from_tasks"
],
"incremental": null
},
"pos_site_exchanges": {
"pk": "id",
"columns": [
"id",
"shopify_order_id",
"shopify_order_name",
"original_pos_sale_id",
"new_pos_sale_id",
"seller_id",
"store_id",
"exchange_reason",
"original_items",
"zeroed_barcodes",
"step_status",
"status",
"error_message",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_stock_adjustments": {
"pk": "id",
"columns": [
"id",
"store_id",
"product_id",
"tiny_id",
"sku",
"barcode",
"product_name",
"direction",
"quantity",
"previous_stock",
"new_stock",
"reason",
"seller_id",
"seller_name",
"created_at",
"sale_id",
"sale_event",
"tiny_mirrored_at",
"tiny_mirror_status",
"movement_type",
"exchange_id",
"exchange_number",
"count_id",
"user_id",
"user_name"
],
"incremental": null
},
"pos_stock_transfers": {
"pk": "id",
"columns": [
"id",
"numero",
"from_store_id",
"to_store_id",
"status",
"items",
"total_items",
"notes",
"created_by",
"created_by_name",
"created_at",
"reversed_of",
"reversed_by_transfer",
"reversed_at",
"reverse_reason",
"idempotency_key",
"search_text"
],
"incremental": null
},
"pos_store_sellers": {
"pk": "id",
"columns": [
"id",
"store_id",
"seller_id",
"seller_name",
"tiny_seller_id",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_store_whatsapp_numbers": {
"pk": "id",
"columns": [
"id",
"store_id",
"whatsapp_number_id",
"created_at"
],
"incremental": null
},
"pos_stores": {
"pk": "id",
"columns": [
"id",
"name",
"address",
"is_active",
"created_at",
"updated_at",
"tiny_deposit_name",
"revenue_target",
"is_simulation",
"company_id",
"disable_tiny_orders",
"has_tiny_token"
],
"incremental": null
},
"pos_task_contacts": {
"pk": "id",
"columns": [
"id",
"instance_id",
"customer_phone",
"customer_name",
"customer_meta",
"contacted",
"contacted_at",
"created_at"
],
"incremental": null
},
"pos_task_definitions": {
"pk": "id",
"columns": [
"id",
"store_id",
"title",
"description",
"category",
"verification_mode",
"target_count",
"recurrence",
"recurrence_config",
"assignment",
"assigned_seller_ids",
"points_reward",
"auto_config",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_task_dispatch_schedules": {
"pk": "id",
"columns": [
"id",
"store_id",
"name",
"template_name",
"template_language",
"whatsapp_number_id",
"template_variables",
"target",
"send_times",
"is_active",
"last_run_at",
"created_at",
"updated_at"
],
"incremental": null
},
"pos_tracking_templates": {
"pk": "id",
"columns": [
"id",
"name",
"body",
"is_default",
"created_at",
"updated_at"
],
"incremental": null
},
"price_tiers": {
"pk": "id",
"columns": [
"id",
"label",
"min_price",
"max_price",
"color",
"sort_order",
"created_at",
"updated_at"
],
"incremental": null
},
"prize_wheel_segments": {
"pk": "id",
"columns": [
"id",
"store_id",
"label",
"color",
"prize_type",
"prize_value",
"probability",
"expiry_days",
"is_active",
"sort_order",
"created_at",
"updated_at"
],
"incremental": null
},
"product_brands": {
"pk": "id",
"columns": [
"id",
"name",
"slug",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"product_capture_items": {
"pk": "id",
"columns": [
"id",
"session_id",
"parent_code",
"product_name",
"barcode",
"size",
"color",
"price",
"reference_code",
"quantity",
"tiny_product_id",
"created_at",
"cost_price"
],
"incremental": null
},
"product_capture_sessions": {
"pk": "id",
"columns": [
"id",
"store_id",
"status",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"product_categories": {
"pk": "id",
"columns": [
"id",
"name",
"slug",
"keywords",
"default_gender",
"priority",
"is_active",
"created_at",
"updated_at",
"default_weight_kg",
"default_height_cm",
"default_width_cm",
"default_length_cm"
],
"incremental": null
},
"product_category_merge_log": {
"pk": "id",
"columns": [
"id",
"old_name",
"new_name",
"created_at"
],
"incremental": null
},
"product_code_category_map": {
"pk": "category_id",
"columns": [
"category_id",
"letter"
],
"incremental": null
},
"product_code_letters": {
"pk": "letter",
"columns": [
"letter",
"label",
"last_seq"
],
"incremental": null
},
"product_color_codes": {
"pk": "id",
"columns": [
"id",
"code",
"master_id",
"color",
"color_key",
"letter",
"seq",
"created_at",
"shopify_ok",
"shopify_status",
"shopify_checked_at",
"shopify_sizes_ok",
"shopify_sizes_total"
],
"incremental": null
},
"product_colors": {
"pk": "id",
"columns": [
"id",
"name",
"slug",
"hex",
"created_at",
"updated_at"
],
"incremental": null
},
"product_dedup_index": {
"pk": "id",
"columns": [
"id",
"dedupe_key",
"dedupe_method",
"representative_pos_product_id",
"representative_name",
"representative_category",
"stores_present",
"tiny_ids_per_store",
"imported_at",
"validation_status",
"created_at",
"updated_at"
],
"incremental": null
},
"product_master_data": {
"pk": "parent_sku",
"columns": [
"parent_sku",
"name",
"description",
"brand",
"category",
"classe_produto",
"ncm",
"cest",
"cfop",
"origem",
"unidade",
"cost_price",
"sale_price",
"markup",
"weight_kg",
"height_cm",
"width_cm",
"length_cm",
"images",
"shopify_product_id",
"tiny_product_id",
"is_active",
"needs_review",
"review_reason",
"created_by",
"created_at",
"updated_at",
"category_id",
"brand_id",
"gender"
],
"incremental": null
},
"product_restock_flags": {
"pk": "id",
"columns": [
"id",
"sku",
"shopify_product_id",
"restock_mode",
"note",
"updated_by",
"updated_at",
"central_offer_enabled"
],
"incremental": null
},
"product_sizes": {
"pk": "id",
"columns": [
"id",
"label",
"slug",
"numeric_value",
"size_group",
"created_at",
"updated_at"
],
"incremental": null
},
"product_stock_movements": {
"pk": "id",
"columns": [
"id",
"variant_id",
"store_id",
"movement_type",
"quantity",
"unit_cost",
"reference_type",
"reference_id",
"purchase_invoice_id",
"notes",
"created_by",
"created_at"
],
"incremental": "created_at"
},
"product_variant_codes": {
"pk": "variant_id",
"columns": [
"variant_id",
"code",
"color_code",
"size_suffix",
"created_at"
],
"incremental": null
},
"product_variants": {
"pk": "id",
"columns": [
"id",
"master_id",
"sku",
"gtin",
"color",
"size",
"cost_price_override",
"sale_price_override",
"weight_kg_override",
"initial_stock",
"is_active",
"shopify_variant_id",
"tiny_variant_id",
"created_at",
"updated_at",
"tiny_imported_at",
"last_sync_source",
"color_id",
"size_id"
],
"incremental": null
},
"product_visual_tags": {
"pk": "id",
"columns": [
"id",
"shopify_product_id",
"product_title",
"visual_tags",
"analyzed_image_urls",
"ai_description",
"last_analyzed_at",
"created_at",
"updated_at"
],
"incremental": null
},
"product_wait_notifications": {
"pk": "id",
"columns": [
"id",
"phone",
"customer_name",
"whatsapp_number_id",
"store_id",
"pos_product_id",
"matched_pos_product_id",
"product_name",
"size",
"color",
"barcode",
"parent_sku",
"image_url",
"requested_by_user_id",
"requested_by_name",
"status",
"notes",
"arrived_at",
"notified_at",
"created_at",
"updated_at"
],
"incremental": null
},
"products_master": {
"pk": "id",
"columns": [
"id",
"sku_root",
"name",
"description",
"brand",
"category",
"ncm",
"cest",
"origem",
"unidade",
"cost_price",
"sale_price",
"weight_kg",
"height_cm",
"width_cm",
"length_cm",
"images",
"is_active",
"shopify_product_id",
"tiny_product_id",
"created_by",
"created_at",
"updated_at",
"classe_produto",
"tiny_imported_at",
"tiny_source_store_id",
"needs_review",
"review_reason",
"category_id",
"gender",
"age_group",
"price_tier_id",
"auto_classified",
"classification_confidence",
"brand_id",
"brand_source",
"category_source",
"gender_source"
],
"incremental": null
},
"profiles": {
"pk": "id",
"columns": [
"id",
"user_id",
"display_name",
"created_at",
"updated_at"
],
"incremental": null
},
"provider_payments": {
"pk": "id",
"columns": [
"id",
"provider_id",
"paid_store_id",
"cash_register_id",
"total_amount",
"receipt_pdf_url",
"proof_file_url",
"paid_at",
"created_by",
"notes",
"created_at",
"updated_at"
],
"incremental": null
},
"public_catalog_visits": {
"pk": "id",
"columns": [
"id",
"event_id",
"kind",
"catalog_product_id",
"order_id",
"group_id",
"utm_source",
"utm_campaign",
"dispatch_code",
"created_at"
],
"incremental": null
},
"purchase_grade_types": {
"pk": "id",
"columns": [
"id",
"name",
"sizes",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"purchase_invoice_installments": {
"pk": "id",
"columns": [
"id",
"invoice_id",
"installment_number",
"due_date",
"amount",
"paid",
"paid_at",
"paid_amount",
"payment_notes",
"created_at",
"updated_at"
],
"incremental": null
},
"purchase_invoice_items": {
"pk": "id",
"columns": [
"id",
"invoice_id",
"supplier_product_code",
"description",
"ncm",
"cfop",
"unit",
"quantity",
"unit_cost",
"total_cost",
"ean",
"parsed_color",
"parsed_size",
"variant_id",
"master_id",
"raw_data",
"created_at",
"updated_at",
"linked_parent_sku",
"linked_store_id",
"linked_at",
"line_number"
],
"incremental": null
},
"purchase_invoices": {
"pk": "id",
"columns": [
"id",
"nfe_key",
"invoice_number",
"invoice_series",
"supplier_name",
"supplier_cnpj",
"supplier_ie",
"supplier_address",
"emission_date",
"total_value",
"total_products",
"total_taxes",
"total_freight",
"total_discount",
"payment_method",
"status",
"store_id",
"raw_xml",
"parsed_data",
"notes",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"purchase_request_item_changes": {
"pk": "id",
"columns": [
"id",
"item_id",
"added_grades",
"previous_qty",
"new_qty",
"changed_by_name",
"changed_at"
],
"incremental": null
},
"purchase_request_items": {
"pk": "id",
"columns": [
"id",
"request_id",
"product_code",
"master_id",
"product_name",
"color",
"brand",
"grade_type_id",
"grade_name",
"grade_sizes",
"pairs_per_grade",
"grades_qty",
"status",
"confirmed_at",
"confirmed_by_name",
"expected_arrival",
"notes",
"created_at"
],
"incremental": null
},
"purchase_requests": {
"pk": "id",
"columns": [
"id",
"created_at",
"created_by",
"created_by_name"
],
"incremental": null
},
"push_notification_log": {
"pk": "id",
"columns": [
"id",
"title",
"body",
"image_url",
"click_url",
"sent_count",
"failed_count",
"sent_by",
"created_at"
],
"incremental": null
},
"push_subscriptions": {
"pk": "id",
"columns": [
"id",
"endpoint",
"campaign_tag",
"lead_name",
"lead_phone",
"user_agent",
"created_at"
],
"incremental": null
},
"quick_replies": {
"pk": "id",
"columns": [
"id",
"title",
"message",
"category",
"sort_order",
"created_by",
"created_at",
"updated_at",
"folder_id"
],
"incremental": null
},
"quick_reply_folders": {
"pk": "id",
"columns": [
"id",
"name",
"color",
"sort_order",
"created_by",
"created_at",
"updated_at",
"parent_id"
],
"incremental": null
},
"ravena_customers": {
"pk": "id",
"columns": [
"id",
"name",
"phone",
"email",
"region",
"store",
"seller",
"ddd",
"rfm_segment",
"rfm_r",
"rfm_f",
"rfm_m",
"rfm_total",
"total_orders",
"total_spent",
"avg_ticket",
"last_purchase_at",
"first_purchase_at",
"city",
"state",
"tags",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"referrals": {
"pk": "id",
"columns": [
"id",
"friend_name",
"friend_phone",
"coupon_code",
"coupon_value",
"coupon_expires_at",
"message_sent_at",
"friend_contacted_at",
"coupon_redeemed_at",
"redeemed_in_sale_id",
"status",
"created_at",
"updated_at"
],
"incremental": null
},
"refund_settings": {
"pk": "id",
"columns": [
"id",
"enabled",
"approval_threshold",
"updated_at",
"updated_by",
"receipt_footer_contact",
"receipt_message_template"
],
"incremental": null
},
"rh_avaliacoes": {
"pk": "candidato_id",
"columns": [
"candidato_id",
"nota",
"parcial",
"detalhe",
"resumo_ia",
"alertas",
"ai_attempted_at",
"created_at",
"updated_at",
"manual_attempts",
"evaluating",
"ai_error"
],
"incremental": null
},
"rh_avisos": {
"pk": "candidato_id",
"columns": [
"candidato_id",
"estado",
"claimed_at",
"sent_at",
"erro",
"reenvios",
"created_at",
"provider_message_id",
"updated_at"
],
"incremental": null
},
"rh_bairros_proximos": {
"pk": "id",
"columns": [
"id",
"loja",
"bairro",
"bairro_norm",
"pontos"
],
"incremental": null
},
"rh_candidatos": {
"pk": "id",
"columns": [
"id",
"link_id",
"vaga_id",
"instagram_username",
"nome",
"whatsapp",
"idade",
"bairro",
"cidade",
"transporte",
"aceita_condicoes",
"ja_trabalhou",
"computador",
"situacao",
"dispositivo",
"rascunho",
"rascunho_at",
"status",
"observacao",
"consentimento_at",
"submitted_at",
"created_at",
"updated_at",
"condicoes_versao"
],
"incremental": null
},
"rh_cenarios": {
"pk": "id",
"columns": [
"id",
"vaga_id",
"ordem",
"contexto",
"mensagem_cliente",
"gabarito",
"ativo",
"created_at"
],
"incremental": null
},
"rh_experiencias": {
"pk": "id",
"columns": [
"id",
"candidato_id",
"ordem",
"onde",
"funcao",
"duracao_meses"
],
"incremental": null
},
"rh_links": {
"pk": "id",
"columns": [
"id",
"code",
"instagram_username",
"vaga_id",
"estado",
"created_by",
"created_at",
"opened_at",
"submitted_at"
],
"incremental": "created_at"
},
"rh_respostas_teste": {
"pk": "id",
"columns": [
"id",
"candidato_id",
"cenario_id",
"ordem",
"mensagem_cliente",
"resposta"
],
"incremental": null
},
"rh_settings": {
"pk": "id",
"columns": [
"id",
"guia_atendimento",
"pesos",
"faixas_permanencia",
"pontos_sem_experiencia",
"pontos_transporte",
"pontos_bairro_max",
"teto_transporte",
"pontos_computador",
"aviso_numero",
"aviso_instancia_id",
"aviso_ativo",
"palavra_chave",
"updated_at",
"updated_by",
"ai_blocked_reason",
"aviso_ultimo_status",
"aviso_ultimo_erro",
"aviso_ultimo_at",
"aviso_ultimo_tipo"
],
"incremental": null
},
"rh_vagas": {
"pk": "id",
"columns": [
"id",
"titulo",
"resumo",
"ativo",
"created_at"
],
"incremental": null
},
"sale_freight_quotes": {
"pk": "id",
"columns": [
"id",
"sale_id",
"sale_ids",
"package",
"options",
"errors",
"quoted_by",
"quoted_at",
"selected_option",
"context"
],
"incremental": null
},
"sales_triggers": {
"pk": "id",
"columns": [
"id",
"name",
"description",
"keywords",
"is_active",
"color",
"sort_order",
"ad_campaign_id",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"scheduled_messages": {
"pk": "id",
"columns": [
"id",
"phone",
"message",
"scheduled_at",
"whatsapp_number_id",
"status",
"sent_at",
"error_message",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"secretary_messages": {
"pk": "id",
"columns": [
"id",
"user_id",
"role",
"content",
"tool_calls",
"created_at"
],
"incremental": null
},
"secretary_reminders": {
"pk": "id",
"columns": [
"id",
"user_id",
"title",
"description",
"reminder_type",
"due_date",
"remind_at",
"phone",
"whatsapp_number_id",
"is_completed",
"completed_at",
"last_reminded_at",
"metadata",
"created_at",
"updated_at"
],
"incremental": null
},
"secretary_settings": {
"pk": "id",
"columns": [
"id",
"user_id",
"reminder_phone",
"whatsapp_number_id",
"weekly_reminder_day",
"weekly_reminder_hour",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"security_events": {
"pk": "id",
"columns": [
"id",
"created_at",
"event",
"user_id",
"ip",
"details"
],
"incremental": "created_at"
},
"selfservice_advertising_consents": {
"pk": "id",
"columns": [
"id",
"advertising",
"region",
"notice_version",
"choices_history",
"updated_at"
],
"incremental": null
},
"selfservice_instance_pacing": {
"pk": "whatsapp_number_id",
"columns": [
"whatsapp_number_id",
"last_sent_at",
"next_send_at",
"delay_ms"
],
"incremental": null
},
"selfservice_message_queue": {
"pk": "id",
"columns": [
"id",
"message_key",
"event_id",
"order_id",
"kind",
"phone",
"whatsapp_number_id",
"payload",
"status",
"attempts",
"next_attempt_at",
"last_error",
"created_at",
"sent_at",
"claimed_at"
],
"incremental": null
},
"service_providers": {
"pk": "id",
"columns": [
"id",
"name",
"phone",
"document",
"provider_type",
"notes",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"shadow_cycle_state": {
"pk": "id",
"columns": [
"id",
"started_at",
"min_days",
"min_big_live_viewers",
"captured_big_live_at",
"captured_live_session_id",
"closed_at",
"notes",
"created_at",
"updated_at",
"min_convite_live_recipients",
"captured_criterion"
],
"incremental": null
},
"shipment_simulations": {
"pk": "id",
"columns": [
"id",
"tracking_code",
"customer_name",
"customer_phone",
"order_id",
"order_reference",
"origin_city",
"origin_state",
"destination_city",
"destination_state",
"stops",
"posted_at",
"step_interval_days",
"manual_offset_days",
"status",
"notes",
"created_by",
"created_at",
"updated_at",
"sale_id",
"kind",
"fulfillment",
"stage",
"stage_started_at",
"stage_history",
"stage_days",
"real_tracking_code",
"real_carrier",
"real_events",
"last_real_sync",
"delivered_at",
"real_service_code",
"incident_type",
"incident_at",
"incident_note",
"merged_into_id",
"delivered_source",
"delivery_estimate"
],
"incremental": "created_at"
},
"shipment_unmapped_last_events": {
"pk": "simulation_id",
"columns": [
"simulation_id",
"real_carrier",
"last_description",
"last_at",
"logged_at"
],
"incremental": null
},
"shipping_rules": {
"pk": "id",
"columns": [
"id",
"event_id",
"name",
"is_active",
"rule_type",
"carrier_match",
"region_states",
"cep_range_start",
"cep_range_end",
"fixed_price",
"discount_percentage",
"discount_fixed",
"priority",
"created_at",
"updated_at",
"store_id"
],
"incremental": null
},
"shopify_live_order_locks": {
"pk": "id",
"columns": [
"id",
"dedupe_key",
"session_id",
"source",
"customer_phone_normalized",
"customer_email_normalized",
"customer_cpf_normalized",
"line_signature",
"status",
"locked_at",
"last_seen_at",
"shopify_order_id",
"shopify_order_name",
"error_message",
"created_at",
"updated_at"
],
"incremental": null
},
"shopify_live_order_syncs": {
"pk": "id",
"columns": [
"id",
"dedupe_key",
"session_id",
"source",
"order_id",
"live_viewer_id",
"customer_name",
"customer_phone_normalized",
"customer_email_normalized",
"customer_cpf_normalized",
"line_signature",
"line_items",
"shopify_order_id",
"shopify_order_name",
"shopify_order_created_at",
"sync_status",
"is_duplicate_candidate",
"duplicate_group_key",
"duplicate_reason",
"duplicate_rank",
"reviewed_at",
"reviewed_by",
"review_status",
"resolution_action",
"resolution_notes",
"cancelled_at",
"cancelled_by",
"created_at",
"updated_at"
],
"incremental": null
},
"shopify_variant_mirror": {
"pk": "shopify_variant_id",
"columns": [
"shopify_variant_id",
"shopify_product_id",
"product_title",
"product_status",
"published_lovable",
"variant_title",
"sku",
"barcode",
"option_color",
"option_size",
"price",
"image_url",
"synced_at"
],
"incremental": null
},
"shopify_yampi_mapping": {
"pk": "id",
"columns": [
"id",
"shopify_variant_id",
"shopify_sku",
"yampi_sku_id",
"created_at",
"updated_at"
],
"incremental": null
},
"short_links": {
"pk": "id",
"columns": [
"id",
"code",
"target_path",
"label",
"campaign_id",
"draft_batch",
"created_by",
"click_count",
"first_clicked_at",
"last_clicked_at",
"created_at",
"expires_at"
],
"incremental": null
},
"sticky_notes": {
"pk": "id",
"columns": [
"id",
"user_id",
"content",
"bg_color",
"text_color",
"position_x",
"position_y",
"width",
"height",
"z_index",
"deadline",
"is_shared",
"is_done",
"created_at",
"updated_at"
],
"incremental": null
},
"stock_grade_templates": {
"pk": "id",
"columns": [
"id",
"name",
"sizes",
"created_at",
"updated_at"
],
"incremental": null
},
"stock_inventory_cycles": {
"pk": "id",
"columns": [
"id",
"numero",
"store_id",
"name",
"status",
"started_at",
"closed_at",
"created_by",
"created_by_name",
"closed_by",
"closed_by_name",
"notes"
],
"incremental": null
},
"stock_label_batch_items": {
"pk": "id",
"columns": [
"id",
"batch_id",
"variant_id",
"variant_code",
"pos_product_id",
"labels",
"counted",
"pending_expedition",
"moved_during_count",
"stock_before",
"stock_after",
"delta",
"adjustment_id",
"reverted_adjustment_id",
"skipped_reason"
],
"incremental": null
},
"stock_label_batches": {
"pk": "id",
"columns": [
"id",
"numero",
"store_id",
"master_id",
"mode",
"scope",
"status",
"opened_at",
"applied_at",
"total_labels",
"total_delta",
"items_changed",
"created_by",
"created_by_name",
"reverted_at",
"reverted_by",
"reverted_by_name",
"notes",
"cycle_id"
],
"incremental": null
},
"stock_movements": {
"pk": "id",
"columns": [
"id",
"pos_product_id",
"store_id",
"sku",
"barcode",
"parent_sku",
"movement_type",
"quantity",
"reference_type",
"reference_id",
"idempotency_key",
"unit_cost",
"notes",
"created_by",
"created_at"
],
"incremental": null
},
"store_dispatch_tests": {
"pk": "id",
"columns": [
"id",
"test_round",
"variant",
"phone_suffix8",
"phone",
"recipient_name",
"unified_customer_id",
"dispatch_id",
"planned_send_at",
"created_at"
],
"incremental": null
},
"strategy_tasks": {
"pk": "id",
"columns": [
"id",
"store_id",
"parent_id",
"title",
"description",
"is_completed",
"completed_at",
"sort_order",
"scope",
"created_at",
"updated_at"
],
"incremental": null
},
"support_agent_scripts": {
"pk": "id",
"columns": [
"id",
"version",
"body",
"note",
"created_by",
"created_at"
],
"incremental": null
},
"support_ai_attempts": {
"pk": "id",
"columns": [
"id",
"suggestion_id",
"kind",
"attempt",
"model",
"ok",
"error",
"duration_ms",
"created_at"
],
"incremental": "created_at"
},
"support_ai_calls": {
"pk": "id",
"columns": [
"id",
"suggestion_id",
"phone",
"whatsapp_number_id",
"kind",
"model",
"ok",
"error",
"duration_ms",
"input_tokens",
"output_tokens",
"created_at",
"reservation_tokens",
"settled",
"budget_day",
"gateway_run_id"
],
"incremental": null
},
"support_ai_daily": {
"pk": "day",
"columns": [
"day",
"tokens",
"reserved",
"calls",
"prefiltered",
"suggestions",
"decisions",
"budget_stops"
],
"incremental": null
},
"support_auto_suggestions": {
"pk": "id",
"columns": [
"id",
"created_at",
"message_row_id",
"whatsapp_number_id",
"channel",
"phone",
"customer_name",
"incoming_text",
"intent",
"sale_id",
"sale_channel",
"decision",
"reason",
"link_type",
"suggested_text",
"wa_me_url",
"mode_at_creation",
"auto_send_after",
"status",
"sent_text",
"sent_link_id",
"sent_by",
"sent_at",
"discard_reason",
"discarded_by",
"discarded_at",
"wrong_suggestion",
"ai_status",
"ai_error",
"triage",
"triage_category",
"triage_confidence",
"agent_actions",
"exchange_offered",
"handoff_summary",
"script_version",
"would_route_support",
"routed_at",
"routed_by",
"routed_auto",
"tracking_info",
"other_instances",
"consolidation_target",
"cpf_different_phone",
"prazo_por_envio",
"cost_due_at",
"cost_claimed_at",
"cost_key",
"cost_prefilter_passed",
"return_flow_state",
"return_flow_reason",
"return_flow_pending_link",
"return_flow_continuation"
],
"incremental": null
},
"support_channel_pauses": {
"pk": "whatsapp_number_id",
"columns": [
"whatsapp_number_id",
"paused_at",
"paused_until",
"reason",
"failures",
"updated_at"
],
"incremental": null
},
"support_cpf_attempts": {
"pk": "id",
"columns": [
"id",
"phone_key",
"day",
"source_key",
"cpf_mask",
"candidate_sale_id",
"candidate_first_name",
"candidate_product",
"candidate_month",
"confirmed",
"created_at"
],
"incremental": null
},
"support_finalization_log": {
"pk": "id",
"columns": [
"id",
"phone_key",
"whatsapp_number_id",
"finished_by",
"finished_by_name",
"reason",
"created_at"
],
"incremental": null
},
"support_finalizations": {
"pk": "id",
"columns": [
"id",
"phone_key",
"whatsapp_number_id",
"finished_at",
"finished_by",
"finished_by_name",
"reason",
"created_at"
],
"incremental": null
},
"support_outbox": {
"pk": "id",
"columns": [
"id",
"phone",
"whatsapp_number_id",
"text",
"link",
"requested_by",
"status",
"created_at",
"sent_at",
"error",
"provider_message_id",
"idempotency_key",
"claimed_at",
"available_at",
"suggestion_id",
"link_id"
],
"incremental": "created_at"
},
"support_settings": {
"pk": "id",
"columns": [
"id",
"exchange_window_days",
"return_window_days",
"ship_replacement_when",
"max_offer_attempts",
"central_base_url",
"updated_at",
"central_auto_reverse",
"central_public_enabled",
"central_require_product_choice",
"auto_reply_mode",
"auto_reply_instance_ids",
"support_whatsapp_phone",
"auto_reply_cooldown_hours",
"auto_reply_min_delay_s",
"auto_reply_max_delay_s",
"ai_enabled",
"ai_triage_model",
"ai_agent_model",
"ai_max_calls_per_conversation_day",
"ai_timeout_ms",
"auto_route_support_line",
"tracking_share_last_event",
"ai_daily_token_budget",
"ai_pause_reason",
"ai_pause_until",
"ai_worker_lease",
"ai_worker_until",
"ai_silence_queue_enabled",
"auto_resumed_at",
"shadow_reason",
"shadow_at",
"alert_phone",
"alert_whatsapp_number_id",
"alert_last_sent_at",
"alert_state",
"shadow_auto"
],
"incremental": null
},
"support_tickets": {
"pk": "id",
"columns": [
"id",
"expedition_order_id",
"shopify_order_name",
"customer_name",
"customer_phone",
"subject",
"description",
"status",
"priority",
"assigned_to",
"source",
"deadline_at",
"started_at",
"resolved_at",
"resolution_notes",
"points_awarded",
"created_at",
"updated_at"
],
"incremental": null
},
"support_training_items": {
"pk": "id",
"columns": [
"id",
"run_id",
"created_at",
"phone",
"whatsapp_number_id",
"channel",
"instance_name",
"last_incoming_at",
"status",
"attempts",
"customer_name",
"conversation",
"orders_ctx",
"triage",
"triage_category",
"triage_confidence",
"is_support",
"review_group",
"agent_text",
"agent_actions",
"decision",
"reason",
"handoff_summary",
"would_route_support",
"tracking_info",
"tokens_in",
"tokens_out",
"error",
"processed_at",
"review_class_ok",
"review_correct_category",
"review_reply_ok",
"review_comment",
"review_ideal_reply",
"reviewed_by",
"reviewed_at",
"replay_status",
"replay_result",
"replay_started_at",
"replay3_status",
"replay3_result",
"replay3_started_at"
],
"incremental": null
},
"support_training_runs": {
"pk": "id",
"columns": [
"id",
"created_at",
"label",
"days",
"eligible_conversations",
"selected_conversations",
"est_cost_usd",
"notes",
"finished_at"
],
"incremental": null
},
"team_chat_messages": {
"pk": "id",
"columns": [
"id",
"sender_name",
"message",
"channel",
"created_at",
"message_type",
"metadata"
],
"incremental": null
},
"team_chat_reads": {
"pk": "id",
"columns": [
"id",
"message_id",
"reader_name",
"read_at"
],
"incremental": null
},
"team_gamification": {
"pk": "id",
"columns": [
"id",
"member_name",
"total_points",
"tickets_resolved",
"tickets_fast",
"tickets_medium",
"tickets_slow",
"penalties",
"weekly_points",
"weekly_goal",
"badges",
"created_at",
"updated_at"
],
"incremental": null
},
"template_step_rotation": {
"pk": "id",
"columns": [
"id",
"funnel_step",
"scope_key",
"counter",
"updated_at"
],
"incremental": null
},
"templates_carrossel": {
"pk": "id",
"columns": [
"qtd_cards",
"template_id",
"template_language",
"aprovado",
"meta_status",
"whatsapp_number_id",
"observacao",
"created_at",
"updated_at",
"id",
"nome",
"template_category",
"category_last_synced_at",
"scope",
"event_id"
],
"incremental": null
},
"tiny_accounts_payable": {
"pk": "id",
"columns": [
"id",
"store_id",
"tiny_conta_id",
"nome_fornecedor",
"numero_doc",
"data_vencimento",
"data_emissao",
"data_pagamento",
"valor",
"valor_pago",
"saldo",
"situacao",
"observacoes",
"historico",
"categoria",
"competencia",
"nro_banco",
"raw_data",
"synced_at",
"created_at",
"updated_at"
],
"incremental": null
},
"tiny_accounts_payable_sync_log": {
"pk": "id",
"columns": [
"id",
"store_id",
"status",
"total_synced",
"error_message",
"started_at",
"completed_at"
],
"incremental": null
},
"tiny_fiscal_divergences": {
"pk": "id",
"columns": [
"id",
"dedup_index_id",
"store_a_id",
"store_b_id",
"field_name",
"value_a",
"value_b",
"resolved",
"resolved_value",
"resolved_by",
"resolved_at",
"created_at"
],
"incremental": null
},
"tiny_import_errors": {
"pk": "id",
"columns": [
"id",
"run_id",
"dedup_index_id",
"error_code",
"error_message",
"raw_response",
"created_at"
],
"incremental": null
},
"tiny_import_runs": {
"pk": "id",
"columns": [
"id",
"run_type",
"started_at",
"finished_at",
"total_processed",
"success_count",
"failure_count",
"status",
"dry_run",
"error_message",
"stats",
"created_by"
],
"incremental": null
},
"tiny_management_sync_log": {
"pk": "id",
"columns": [
"id",
"store_id",
"sync_type",
"status",
"orders_synced",
"error_message",
"started_at",
"completed_at",
"current_date_syncing",
"date_from",
"date_to",
"phase"
],
"incremental": null
},
"tiny_sales_history": {
"pk": "id",
"columns": [
"id",
"store_id",
"sku",
"product_name",
"quantity_sold",
"total_revenue",
"sale_count",
"period_start",
"period_end",
"last_synced_at",
"created_at"
],
"incremental": null
},
"tiny_stock_sync_errors": {
"pk": "id",
"columns": [
"id",
"sale_id",
"product_id",
"store_id",
"tiny_id",
"sku",
"attempted_stock",
"direction",
"quantity",
"sale_event",
"error_message",
"attempts",
"status",
"last_attempt_at",
"resolved_at",
"created_at"
],
"incremental": "created_at"
},
"tiny_synced_orders": {
"pk": "id",
"columns": [
"id",
"store_id",
"tiny_order_id",
"tiny_order_number",
"order_date",
"customer_name",
"status",
"payment_method",
"subtotal",
"discount",
"shipping",
"total",
"items",
"raw_data",
"synced_at",
"created_at"
],
"incremental": null
},
"tracked_link_codes": {
"pk": "id",
"columns": [
"id",
"code",
"slug",
"phone",
"whatsapp_number_id",
"source",
"source_ref",
"sent_count",
"last_sent_at",
"click_count",
"first_clicked_at",
"last_clicked_at",
"created_at"
],
"incremental": null
},
"trigger_conversions": {
"pk": "id",
"columns": [
"id",
"trigger_id",
"phone",
"sale_value",
"sale_currency",
"finish_reason",
"seller_id",
"whatsapp_number_id",
"meta_capi_event_id",
"meta_capi_sent_at",
"meta_capi_response",
"created_by",
"created_at"
],
"incremental": "created_at"
},
"trigger_messages": {
"pk": "id",
"columns": [
"id",
"trigger_id",
"sort_order",
"delay_seconds",
"content",
"media_type",
"media_url",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"trocas_devolucoes": {
"pk": "id",
"columns": [
"id",
"codigo_devolucao",
"tipo",
"loja_origem_id",
"pedido_original_id",
"chave_acesso_original",
"cliente_id",
"motivo",
"status",
"codigo_postagem_reversa",
"modo_expedicao",
"vendedora_troca_id",
"origem_canal",
"pedido_novo_id",
"chave_devolucao",
"created_at",
"updated_at",
"devolucao_doc_id",
"venda_nova_doc_id",
"estoque_movimentado",
"pedido_ajustado",
"fase2_erro",
"valor_devolvido",
"valor_reposicao",
"diferenca",
"faturamento_vendedora_troca",
"resolucao_diferenca",
"estorno_forma",
"voucher_id",
"nfe_reposicao_id",
"tracking_code",
"tracking_carrier",
"whatsapp_notification_sent_at",
"gateway_refund_id",
"despachada_em",
"despachada_por",
"motivo_excecao_antecipado",
"cancelada_em",
"cancelada_por",
"motivo_cancelamento_troca",
"diferenca_venda_id",
"historico_reposicao"
],
"incremental": null
},
"trocas_devolucoes_itens": {
"pk": "id",
"columns": [
"id",
"troca_devolucao_id",
"direcao",
"produto_id",
"variacao_id",
"sku",
"tamanho",
"barcode",
"produto_nome",
"quantidade",
"valor_unitario",
"repoe_estoque",
"estado_estoque",
"created_at",
"updated_at"
],
"incremental": null
},
"uazapi_contact_backfill_state": {
"pk": "whatsapp_number_id",
"columns": [
"whatsapp_number_id",
"offset",
"done",
"last_succeeded",
"last_failed",
"total_succeeded",
"total_failed",
"locked_at",
"created_at",
"updated_at"
],
"incremental": null
},
"unified_dedup_snapshots": {
"pk": "id",
"columns": [
"id",
"snapshot_table",
"rows_count",
"created_at",
"created_by",
"note"
],
"incremental": null
},
"unified_merge_log": {
"pk": "id",
"columns": [
"id",
"merge_batch_id",
"rule",
"survivor_id",
"absorbed_id",
"absorbed_row",
"fks_repointed",
"mirror_sales_detected",
"merged_at",
"reverted_at"
],
"incremental": null
},
"user_module_permissions": {
"pk": "id",
"columns": [
"id",
"user_id",
"module",
"created_at"
],
"incremental": null
},
"user_profiles": {
"pk": "id",
"columns": [
"id",
"user_id",
"display_name",
"seller_id",
"store_id",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"user_roles": {
"pk": "id",
"columns": [
"id",
"user_id",
"role",
"created_at"
],
"incremental": null
},
"variant_normalization_log": {
"pk": "id",
"columns": [
"id",
"variant_id",
"master_id",
"master_name",
"old_color",
"old_size",
"new_color",
"new_size",
"reason",
"applied_at",
"applied_by"
],
"incremental": null
},
"variant_stock_cache": {
"pk": "variant_id",
"columns": [
"variant_id",
"master_id",
"color_key",
"total_stock",
"refreshed_at"
],
"incremental": null
},
"vip_group_strategies": {
"pk": "id",
"columns": [
"id",
"month_year",
"strategy_prompt",
"strategy_content",
"created_at",
"updated_at"
],
"incremental": null
},
"vip_link_clicks": {
"pk": "id",
"columns": [
"id",
"link_id",
"code",
"group_db_id",
"campaign_id",
"user_agent",
"is_bot",
"dest_number_id",
"created_at"
],
"incremental": "created_at"
},
"vip_link_conversations": {
"pk": "id",
"columns": [
"id",
"link_id",
"phone",
"phone_key",
"group_db_id",
"group_name",
"campaign_id",
"product_title",
"product",
"whatsapp_number_id",
"message_id",
"match_method",
"created_at"
],
"incremental": "created_at"
},
"vip_link_daily_destination": {
"pk": "day",
"columns": [
"day",
"whatsapp_number_id",
"set_by",
"created_at",
"updated_at"
],
"incremental": null
},
"vip_links": {
"pk": "id",
"columns": [
"id",
"code",
"dispatch_id",
"scheduled_message_id",
"campaign_id",
"group_db_id",
"group_name",
"mode",
"product",
"product_title",
"dest_day",
"message_text",
"click_count",
"created_at"
],
"incremental": "created_at"
},
"vip_orphan_contacts": {
"pk": "id",
"columns": [
"id",
"phone",
"phone_suffix8",
"display_name",
"group_ids",
"group_names",
"status",
"opted_out",
"first_seen_at",
"last_seen_at",
"metadata",
"created_at",
"updated_at"
],
"incremental": null
},
"vouchers": {
"pk": "id",
"columns": [
"id",
"codigo",
"cliente_id",
"valor",
"saldo",
"validade",
"status",
"troca_devolucao_id",
"created_at",
"updated_at",
"used_at",
"used_order_id",
"used_sale_id",
"used_exchange_id"
],
"incremental": null
},
"webhook_events_raw": {
"pk": "id",
"columns": [
"id",
"created_at",
"provider",
"event_type",
"owner",
"payload",
"skip_reason"
],
"incremental": "created_at"
},
"webhook_routing_log": {
"pk": "id",
"columns": [
"id",
"provider",
"sender_phone",
"resolution_method",
"resolved_whatsapp_number_id",
"raw_identifier",
"matched",
"raw_payload",
"created_at"
],
"incremental": "created_at"
},
"webhook_verification_log": {
"pk": "id",
"columns": [
"id",
"created_at",
"provider",
"source",
"event_type",
"external_id",
"transaction_id",
"order_id",
"sale_id",
"verified",
"api_status",
"api_amount",
"expected_amount",
"old_decision",
"new_decision",
"reason",
"strict_mode",
"applied",
"details"
],
"incremental": "created_at"
},
"whatsapp_ad_keywords": {
"pk": "id",
"columns": [
"id",
"keyword",
"campaign_label",
"is_active",
"created_at",
"updated_at"
],
"incremental": null
},
"whatsapp_auto_replies": {
"pk": "id",
"columns": [
"id",
"whatsapp_number_id",
"type",
"message",
"is_active",
"schedule_start",
"schedule_end",
"schedule_days",
"created_by",
"created_at",
"updated_at"
],
"incremental": null
},
"whatsapp_auto_reply_log": {
"pk": "id",
"columns": [
"id",
"phone",
"whatsapp_number_id",
"type",
"sent_at"
],
"incremental": null
},
"whatsapp_group_member_activity": {
"pk": "id",
"columns": [
"id",
"group_id",
"instance_id",
"phone",
"jid",
"activity_type",
"message_id",
"content",
"is_internal",
"customer_id",
"display_name",
"created_at",
"group_jid_base"
],
"incremental": "created_at"
},
"whatsapp_group_member_events": {
"pk": "id",
"columns": [
"id",
"group_id",
"instance_id",
"phone",
"jid",
"event_type",
"is_internal",
"actor_phone",
"customer_id",
"display_name",
"created_at",
"source_version_id",
"group_jid_base"
],
"incremental": "created_at"
},
"whatsapp_group_members": {
"pk": "id",
"columns": [
"id",
"group_id",
"instance_id",
"phone",
"jid",
"status",
"is_admin",
"is_internal",
"internal_kind",
"customer_id",
"display_name",
"joined_at",
"left_at",
"last_event_at",
"created_at",
"updated_at",
"group_jid_base"
],
"incremental": null
},
"whatsapp_group_responsible": {
"pk": "group_jid_base",
"columns": [
"group_jid_base",
"instance_id",
"mode",
"health",
"since",
"reason",
"pending_instance_id",
"pending_reason",
"pending_since",
"updated_at",
"manual_instance_id"
],
"incremental": null
},
"whatsapp_group_responsible_alerts": {
"pk": "id",
"columns": [
"id",
"group_jid_base",
"group_name",
"kind",
"old_instance_id",
"new_instance_id",
"message",
"created_at",
"acknowledged_at",
"acknowledged_by"
],
"incremental": "created_at"
},
"whatsapp_group_snapshots": {
"pk": "id",
"columns": [
"id",
"group_id",
"participant_count",
"recorded_at",
"group_jid_base"
],
"incremental": null
},
"whatsapp_groups": {
"pk": "id",
"columns": [
"id",
"group_id",
"name",
"description",
"photo_url",
"participant_count",
"is_admin",
"is_active",
"is_vip",
"tags",
"instance_id",
"last_synced_at",
"created_at",
"updated_at",
"max_participants",
"is_full",
"invite_link",
"only_admins_send",
"only_admins_add",
"previous_participant_count",
"ddd33_count",
"ddd33_total_resolved",
"ddd33_synced_at",
"group_jid_base"
],
"incremental": null
},
"whatsapp_messages": {
"pk": "id",
"columns": [
"id",
"phone",
"message",
"direction",
"message_id",
"status",
"created_at",
"media_type",
"media_url",
"is_group",
"whatsapp_number_id",
"sender_name",
"error_code",
"error_message",
"channel",
"is_mass_dispatch",
"referral",
"sender_user_id",
"quoted_message_id",
"source",
"sender_phone",
"button_payload",
"template_payload"
],
"incremental": "created_at"
},
"whatsapp_messages_archive": {
"pk": "id",
"columns": [
"id",
"phone",
"message",
"direction",
"message_id",
"status",
"created_at",
"media_type",
"media_url",
"is_group",
"whatsapp_number_id",
"sender_name",
"error_code",
"error_message",
"channel",
"is_mass_dispatch",
"referral",
"sender_user_id",
"quoted_message_id",
"archived_at",
"source"
],
"incremental": "created_at"
},
"whatsapp_numbers": {
"pk": "id",
"columns": [
"id",
"label",
"phone_display",
"phone_number_id",
"business_account_id",
"is_default",
"is_active",
"created_at",
"updated_at",
"provider",
"zapi_instance_id",
"ai_paused",
"is_online",
"last_health_check",
"health_check_error",
"wasender_phone_number",
"wasender_last_qr",
"wasender_qr_updated_at",
"uazapi_instance_name",
"uazapi_owner",
"uazapi_last_qr",
"uazapi_qr_updated_at",
"uazapi_proxy_mode",
"uazapi_proxy_managed_country",
"uazapi_proxy_managed_state",
"uazapi_proxy_managed_city",
"has_meta_token",
"has_zapi_token",
"has_zapi_client_token",
"instagram_account_id",
"instagram_username"
],
"incremental": null
},
"whatsapp_status_posts": {
"pk": "id",
"columns": [
"id",
"message_id",
"whatsapp_number_id",
"type",
"media_url",
"caption",
"text_content",
"created_at"
],
"incremental": null
},
"zoppy_customers": {
"pk": "id",
"columns": [
"id",
"zoppy_id",
"external_id",
"first_name",
"last_name",
"phone",
"email",
"gender",
"birth_date",
"address1",
"address2",
"city",
"state",
"postcode",
"country",
"zoppy_position",
"rfm_recency_score",
"rfm_frequency_score",
"rfm_monetary_score",
"rfm_total_score",
"rfm_segment",
"rfm_calculated_at",
"region_type",
"ddd",
"total_orders",
"total_spent",
"last_purchase_at",
"first_purchase_at",
"avg_ticket",
"zoppy_created_at",
"zoppy_updated_at",
"created_at",
"updated_at",
"coupon_code",
"coupon_amount",
"coupon_type",
"coupon_used",
"coupon_min_purchase",
"coupon_expiry_date",
"coupon_start_date",
"lead_status",
"cpf",
"store_id",
"shoe_size",
"preferred_style",
"age_range",
"source",
"cashback_balance",
"cashback_expires_at",
"tags",
"opt_out_mass_dispatch",
"rfm_r_score",
"rfm_f_score",
"rfm_m_score",
"rfm_score",
"rfm_updated_at"
],
"incremental": null
},
"zoppy_sales": {
"pk": "id",
"columns": [
"id",
"zoppy_order_id",
"external_id",
"customer_name",
"customer_email",
"customer_phone",
"coupon_code",
"status",
"subtotal",
"total",
"discount",
"shipping",
"line_items",
"customer_data",
"completed_at",
"zoppy_created_at",
"zoppy_updated_at",
"created_at",
"updated_at",
"phone_suffix8"
],
"incremental": null
},
"zoppy_sync_log": {
"pk": "id",
"columns": [
"id",
"sync_type",
"status",
"records_synced",
"error_message",
"started_at",
"completed_at"
],
"incremental": null
}
};

// Excluídas de propósito (não retornam nada):
export const VPS_READER_EXCLUDED: Record<string, string> = {
"_backup_function_defs": "backup interno",
"_legacy_livete_followups": "legado interno",
"_perf_snap": "temporária",
"app_settings": "configurações (pode ter chaves)",
"appmax_installations": "credenciais AppMax",
"audit_frenet_shipments_tmp": "temporária de auditoria",
"audit_gateway_refunds_tmp": "temporária de auditoria",
"audit_link": "sem chave primária",
"audit_mirror": "sem chave primária",
"audit_mp_movements_tmp": "temporária de auditoria",
"audit_reverse_costs_tmp": "temporária de auditoria",
"automation_dispatch_job_audience": "chave composta (job_id, pos)",
"central_rate_limits": "controle interno",
"correios_settings": "token Correios",
"customer_access_codes": "códigos de acesso",
"dispatch_link_sessions": "hash de sessão",
"dispatch_links": "hash de senha",
"email_settings": "configurações de e-mail",
"financial_agent_invite_tokens": "tokens de convite",
"financial_agent_sessions": "sessões",
"fiscal_access_attempts": "controle de senha",
"fiscal_access_settings": "hash de senha fiscal",
"ig_moderation_daily": "chave composta (day, class)",
"internal_function_secrets": "segredos internos",
"live_catalog_links": "links com token",
"live_followup_daily": "chave composta (day, event_id)",
"live_member_rate_limits": "controle interno",
"live_member_sessions": "sessões",
"member_area_magic_links": "links de acesso",
"mercadopago_accounts": "credenciais Mercado Pago",
"meta_ads_token_state": "estado do token Meta",
"meta_audience_candidates": "chave composta (definition_id, key)",
"meta_audience_members": "chave composta (definition_id, key)",
"model_number_tokens": "tokens",
"pos_payment_methods": "chave composta (store_id, id)",
"pos_products_dedup_backup": "sem chave primária",
"pos_products_phantom_backup_20260513": "sem chave primária",
"pos_stock_adjustments_dup_backup_20261113": "sem chave primária",
"product_color_shopify_alias": "chave composta (master_id, erp_color_key)",
"product_variants_link_backup_20261105": "sem chave primária",
"products_master_category_backup_20261103": "sem chave primária",
"products_master_link_backup_20261105": "sem chave primária",
"provider_costs": "chave composta (provider, category)",
"review_tokens": "tokens",
"support_links": "links de acesso",
"system_settings": "configurações (pode ter chaves)",
"webhook_signature_state": "estado de assinatura de webhooks",
"whatsapp_archive_conversations": "sem chave primária",
"whatsapp_conversations": "chave composta (phone, instance_key)",
"whatsapp_lid_phone_map": "chave composta (whatsapp_number_id, lid)"
};
