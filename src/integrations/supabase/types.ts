export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      _legacy_livete_followups: {
        Row: {
          completed_at: string | null
          created_at: string
          event_id: string | null
          id: string
          is_active: boolean
          last_client_message_at: string | null
          max_levels: number
          next_reminder_at: string | null
          order_id: string | null
          phone: string
          reminder_level: number
          stage_atendimento: string | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          is_active?: boolean
          last_client_message_at?: string | null
          max_levels?: number
          next_reminder_at?: string | null
          order_id?: string | null
          phone: string
          reminder_level?: number
          stage_atendimento?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          is_active?: boolean
          last_client_message_at?: string | null
          max_levels?: number
          next_reminder_at?: string | null
          order_id?: string | null
          phone?: string
          reminder_level?: number
          stage_atendimento?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "livete_followups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "livete_followups_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaign_nurture_steps: {
        Row: {
          campaign_id: string
          created_at: string
          days_before_event: number
          id: string
          is_active: boolean
          meta_template_name: string | null
          meta_template_vars: Json | null
          send_time: string
          sort_order: number
          zapi_message_text: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          days_before_event?: number
          id?: string
          is_active?: boolean
          meta_template_name?: string | null
          meta_template_vars?: Json | null
          send_time?: string
          sort_order?: number
          zapi_message_text?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          days_before_event?: number
          id?: string
          is_active?: boolean
          meta_template_name?: string | null
          meta_template_vars?: Json | null
          send_time?: string
          sort_order?: number
          zapi_message_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaign_nurture_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns_ai"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaign_situation_prompts: {
        Row: {
          campaign_id: string | null
          created_at: string
          id: string
          is_active: boolean
          prompt_text: string
          situation: string
          sort_order: number
          sub_situation: string | null
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          prompt_text: string
          situation: string
          sort_order?: number
          sub_situation?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          prompt_text?: string
          situation?: string
          sort_order?: number
          sub_situation?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaign_situation_prompts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns_ai"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns_ai: {
        Row: {
          activation_keywords: string[]
          created_at: string
          data_to_collect: string[]
          event_id: string | null
          id: string
          is_active: boolean
          name: string
          objective: string
          payment_conditions: string | null
          pix_discount_percent: number | null
          post_capture_action: string | null
          post_sale_action: string | null
          product_info: Json | null
          prompt: string
          shipping_rule: Json | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          activation_keywords?: string[]
          created_at?: string
          data_to_collect?: string[]
          event_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          objective?: string
          payment_conditions?: string | null
          pix_discount_percent?: number | null
          post_capture_action?: string | null
          post_sale_action?: string | null
          product_info?: Json | null
          prompt?: string
          shipping_rule?: Json | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          activation_keywords?: string[]
          created_at?: string
          data_to_collect?: string[]
          event_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          objective?: string
          payment_conditions?: string | null
          pix_discount_percent?: number | null
          post_capture_action?: string | null
          post_sale_action?: string | null
          product_info?: Json | null
          prompt?: string
          shipping_rule?: Json | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_ai_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_keyword_media: {
        Row: {
          campaign_id: string
          caption: string | null
          created_at: string
          filename: string | null
          id: string
          keyword: string
          media_type: string
          media_url: string
          send_mode: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          caption?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          keyword: string
          media_type?: string
          media_url: string
          send_mode?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          caption?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          keyword?: string
          media_type?: string
          media_url?: string
          send_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_keyword_media_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns_ai"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_leads: {
        Row: {
          campaign_id: string | null
          channel: string | null
          collected_data: Json
          conversation_stage: string | null
          created_at: string
          event_id: string | null
          followup_count: number | null
          id: string
          interested_product_keywords: string[] | null
          is_active: boolean
          last_ai_contact_at: string | null
          last_followup_at: string | null
          last_human_contact_at: string | null
          live_campaign_id: string | null
          live_invite_sent: boolean | null
          name: string | null
          notes: string | null
          payment_link_sent: boolean | null
          phone: string
          shoe_size: string | null
          source: string
          tags: string[] | null
          temperature: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          channel?: string | null
          collected_data?: Json
          conversation_stage?: string | null
          created_at?: string
          event_id?: string | null
          followup_count?: number | null
          id?: string
          interested_product_keywords?: string[] | null
          is_active?: boolean
          last_ai_contact_at?: string | null
          last_followup_at?: string | null
          last_human_contact_at?: string | null
          live_campaign_id?: string | null
          live_invite_sent?: boolean | null
          name?: string | null
          notes?: string | null
          payment_link_sent?: boolean | null
          phone: string
          shoe_size?: string | null
          source?: string
          tags?: string[] | null
          temperature?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          channel?: string | null
          collected_data?: Json
          conversation_stage?: string | null
          created_at?: string
          event_id?: string | null
          followup_count?: number | null
          id?: string
          interested_product_keywords?: string[] | null
          is_active?: boolean
          last_ai_contact_at?: string | null
          last_followup_at?: string | null
          last_human_contact_at?: string | null
          live_campaign_id?: string | null
          live_invite_sent?: boolean | null
          name?: string | null
          notes?: string | null
          payment_link_sent?: boolean | null
          phone?: string
          shoe_size?: string | null
          source?: string
          tags?: string[] | null
          temperature?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns_ai"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_leads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_leads_live_campaign_id_fkey"
            columns: ["live_campaign_id"]
            isOneToOne: false
            referencedRelation: "live_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_nurture_sent: {
        Row: {
          id: string
          lead_id: string
          nurture_step_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          nurture_step_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          nurture_step_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_nurture_sent_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "ad_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_nurture_sent_nurture_step_id_fkey"
            columns: ["nurture_step_id"]
            isOneToOne: false
            referencedRelation: "ad_campaign_nurture_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_calendar: {
        Row: {
          conversation_id: string | null
          created_at: string
          custo_estimado_brl: number | null
          data: string
          descricao: string | null
          id: string
          live_event_id: string | null
          mes_ref: string
          publico_alvo_descricao: string | null
          status: string
          tipo_acao: string
          titulo: string
          updated_at: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          custo_estimado_brl?: number | null
          data: string
          descricao?: string | null
          id?: string
          live_event_id?: string | null
          mes_ref: string
          publico_alvo_descricao?: string | null
          status?: string
          tipo_acao: string
          titulo: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          custo_estimado_brl?: number | null
          data?: string
          descricao?: string | null
          id?: string
          live_event_id?: string | null
          mes_ref?: string
          publico_alvo_descricao?: string | null
          status?: string
          tipo_acao?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_calendar_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_message_at: string
          summary: string | null
          summary_updated_at: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
          summary?: string | null
          summary_updated_at?: string | null
          titulo?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string
          summary?: string | null
          summary_updated_at?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_decisions: {
        Row: {
          ativo: boolean
          contexto: Json
          conversation_id: string | null
          created_at: string
          descricao: string
          id: string
          motivo: string | null
          revisitar_apos: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          contexto?: Json
          conversation_id?: string | null
          created_at?: string
          descricao: string
          id?: string
          motivo?: string | null
          revisitar_apos?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          contexto?: Json
          conversation_id?: string | null
          created_at?: string
          descricao?: string
          id?: string
          motivo?: string | null
          revisitar_apos?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_decisions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_executions: {
        Row: {
          agent_name: string
          created_at: string
          error_message: string | null
          executed_at: string
          id: string
          input_data: Json | null
          output_result: string | null
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          agent_name: string
          created_at?: string
          error_message?: string | null
          executed_at?: string
          id?: string
          input_data?: Json | null
          output_result?: string | null
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          agent_name?: string
          created_at?: string
          error_message?: string | null
          executed_at?: string
          id?: string
          input_data?: Json | null
          output_result?: string | null
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          pending_confirmation: Json | null
          role: string
          tokens_in: number | null
          tokens_out: number | null
          tool_calls: Json | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          pending_confirmation?: Json | null
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          pending_confirmation?: Json | null
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_weekly_context: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: string
          week_start?: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: string
          week_start?: string
        }
        Relationships: []
      }
      ai_assistance_requests: {
        Row: {
          ai_agent: string
          ai_summary: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          priority: string
          product_title: string | null
          request_type: string
          response_media_url: string | null
          response_notes: string | null
          seller_id: string | null
          shopify_product_id: string | null
          status: string
          store_id: string | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          ai_agent?: string
          ai_summary: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          priority?: string
          product_title?: string | null
          request_type: string
          response_media_url?: string | null
          response_notes?: string | null
          seller_id?: string | null
          shopify_product_id?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          ai_agent?: string
          ai_summary?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          priority?: string
          product_title?: string | null
          request_type?: string
          response_media_url?: string | null
          response_notes?: string | null
          seller_id?: string | null
          shopify_product_id?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistance_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversation_logs: {
        Row: {
          ai_decision: string | null
          created_at: string
          error: string | null
          id: string
          message_in: string | null
          message_out: string | null
          order_id: string | null
          phone: string
          provider: string | null
          response_time_ms: number | null
          stage: string | null
          tool_called: string | null
          tool_params: Json | null
        }
        Insert: {
          ai_decision?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message_in?: string | null
          message_out?: string | null
          order_id?: string | null
          phone: string
          provider?: string | null
          response_time_ms?: number | null
          stage?: string | null
          tool_called?: string | null
          tool_params?: Json | null
        }
        Update: {
          ai_decision?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message_in?: string | null
          message_out?: string | null
          order_id?: string | null
          phone?: string
          provider?: string | null
          response_time_ms?: number | null
          stage?: string | null
          tool_called?: string | null
          tool_params?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversation_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_error_logs: {
        Row: {
          agent: string
          ai_response: string | null
          context_payload: Json | null
          created_at: string
          customer_message: string | null
          error_message: string | null
          error_type: string
          fallback_provider: string | null
          fallback_success: boolean | null
          history_sent_count: number | null
          id: string
          phone: string | null
          provider_attempted: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          agent?: string
          ai_response?: string | null
          context_payload?: Json | null
          created_at?: string
          customer_message?: string | null
          error_message?: string | null
          error_type: string
          fallback_provider?: string | null
          fallback_success?: boolean | null
          history_sent_count?: number | null
          id?: string
          phone?: string | null
          provider_attempted?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          agent?: string
          ai_response?: string | null
          context_payload?: Json | null
          created_at?: string
          customer_message?: string | null
          error_message?: string | null
          error_type?: string
          fallback_provider?: string | null
          fallback_success?: boolean | null
          history_sent_count?: number | null
          id?: string
          phone?: string | null
          provider_attempted?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: []
      }
      ai_knowledge_base: {
        Row: {
          agents: string[]
          category: string
          content: string
          created_at: string
          id: string
          is_active: boolean
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          agents?: string[]
          category: string
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          agents?: string[]
          category?: string
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_stock_analyses: {
        Row: {
          analise: Json
          contexto_resumo: Json | null
          created_at: string
          id: string
          model: string | null
          usage: Json | null
        }
        Insert: {
          analise: Json
          contexto_resumo?: Json | null
          created_at?: string
          id?: string
          model?: string | null
          usage?: Json | null
        }
        Update: {
          analise?: Json
          contexto_resumo?: Json | null
          created_at?: string
          id?: string
          model?: string | null
          usage?: Json | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      automation_ai_sessions: {
        Row: {
          created_at: string
          expires_at: string
          flow_id: string | null
          id: string
          is_active: boolean
          live_campaign_id: string | null
          max_messages: number | null
          messages_sent: number | null
          phone: string
          prompt: string | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          flow_id?: string | null
          id?: string
          is_active?: boolean
          live_campaign_id?: string | null
          max_messages?: number | null
          messages_sent?: number | null
          phone: string
          prompt?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          flow_id?: string | null
          id?: string
          is_active?: boolean
          live_campaign_id?: string | null
          max_messages?: number | null
          messages_sent?: number | null
          phone?: string
          prompt?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_ai_sessions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_ai_sessions_live_campaign_id_fkey"
            columns: ["live_campaign_id"]
            isOneToOne: false
            referencedRelation: "live_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_dispatch_jobs: {
        Row: {
          batch_size: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          current_offset: number
          error_message: string | null
          failed: number
          flow_id: string
          heartbeat_at: string
          id: string
          sent: number
          skipped: number
          started_at: string
          status: string
          total_audience: number
        }
        Insert: {
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_offset?: number
          error_message?: string | null
          failed?: number
          flow_id: string
          heartbeat_at?: string
          id?: string
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          total_audience?: number
        }
        Update: {
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_offset?: number
          error_message?: string | null
          failed?: number
          flow_id?: string
          heartbeat_at?: string
          id?: string
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          total_audience?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_dispatch_jobs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_dispatch_sent: {
        Row: {
          blocked_reason: string | null
          flow_id: string
          id: string
          phone: string
          provider_at_send: string | null
          sent_at: string
          shadow_mode: boolean
          status: string
          template_category_at_send: string | null
          unified_id: string | null
          unit_cost_at_send: number | null
        }
        Insert: {
          blocked_reason?: string | null
          flow_id: string
          id?: string
          phone: string
          provider_at_send?: string | null
          sent_at?: string
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          unified_id?: string | null
          unit_cost_at_send?: number | null
        }
        Update: {
          blocked_reason?: string | null
          flow_id?: string
          id?: string
          phone?: string
          provider_at_send?: string | null
          sent_at?: string
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          unified_id?: string | null
          unit_cost_at_send?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_dispatch_sent_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_executions: {
        Row: {
          error_message: string | null
          executed_at: string
          flow_id: string
          id: string
          order_id: string | null
          result: Json | null
          status: string
          step_id: string | null
        }
        Insert: {
          error_message?: string | null
          executed_at?: string
          flow_id: string
          id?: string
          order_id?: string | null
          result?: Json | null
          status?: string
          step_id?: string | null
        }
        Update: {
          error_message?: string | null
          executed_at?: string
          flow_id?: string
          id?: string
          order_id?: string | null
          result?: Json | null
          status?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_flows: {
        Row: {
          created_at: string
          description: string | null
          event_id: string | null
          id: string
          is_active: boolean
          jess_campaign_name: string | null
          name: string
          shadow_mode: boolean
          trigger_config: Json | null
          trigger_type: string
          updated_at: string
          use_jess_agent: boolean | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          jess_campaign_name?: string | null
          name: string
          shadow_mode?: boolean
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
          use_jess_agent?: boolean | null
        }
        Update: {
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          jess_campaign_name?: string | null
          name?: string
          shadow_mode?: boolean
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
          use_jess_agent?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_flows_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_pending_replies: {
        Row: {
          button_branches: Json | null
          created_at: string
          expires_at: string
          flow_id: string
          id: string
          is_active: boolean
          pending_step_index: number
          phone: string
          recipient_data: Json | null
          step_id: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          button_branches?: Json | null
          created_at?: string
          expires_at?: string
          flow_id: string
          id?: string
          is_active?: boolean
          pending_step_index: number
          phone: string
          recipient_data?: Json | null
          step_id?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          button_branches?: Json | null
          created_at?: string
          expires_at?: string
          flow_id?: string
          id?: string
          is_active?: boolean
          pending_step_index?: number
          phone?: string
          recipient_data?: Json | null
          step_id?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_pending_replies_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pending_replies_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_pos_followups: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          customer_cpf: string | null
          customer_phone: string
          customer_phone_suffix: string | null
          flow_id: string
          id: string
          payload: Json
          sale_id: string
          scheduled_at: string
          sent_at: string | null
          step_id: string | null
          step_index: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_cpf?: string | null
          customer_phone: string
          customer_phone_suffix?: string | null
          flow_id: string
          id?: string
          payload?: Json
          sale_id: string
          scheduled_at: string
          sent_at?: string | null
          step_id?: string | null
          step_index: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          customer_cpf?: string | null
          customer_phone?: string
          customer_phone_suffix?: string | null
          flow_id?: string
          id?: string
          payload?: Json
          sale_id?: string
          scheduled_at?: string
          sent_at?: string | null
          step_id?: string | null
          step_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_pos_followups_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pos_followups_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pos_followups_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_steps: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string
          delay_seconds: number
          flow_id: string
          id: string
          step_order: number
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type?: string
          created_at?: string
          delay_seconds?: number
          flow_id: string
          id?: string
          step_order?: number
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string
          delay_seconds?: number
          flow_id?: string
          id?: string
          step_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_steps_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_type: string | null
          balance: number
          bank_name: string | null
          created_at: string
          id: string
          initial_balance: number
          is_active: boolean
          name: string
          notes: string | null
          store_id: string | null
          updated_at: string
        }
        Insert: {
          account_type?: string | null
          balance?: number
          bank_name?: string | null
          created_at?: string
          id?: string
          initial_balance?: number
          is_active?: boolean
          name: string
          notes?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string | null
          balance?: number
          bank_name?: string | null
          created_at?: string
          id?: string
          initial_balance?: number
          is_active?: boolean
          name?: string
          notes?: string | null
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_import_batches: {
        Row: {
          created_at: string
          file_hash: string
          file_name: string
          id: string
          imported_by: string | null
          imported_via: string
          rows_duplicated: number
          rows_inserted: number
          rows_matched: number
          rows_needs_review: number
          rows_total: number
          source_type: string
          summary: Json
        }
        Insert: {
          created_at?: string
          file_hash: string
          file_name: string
          id?: string
          imported_by?: string | null
          imported_via?: string
          rows_duplicated?: number
          rows_inserted?: number
          rows_matched?: number
          rows_needs_review?: number
          rows_total?: number
          source_type: string
          summary?: Json
        }
        Update: {
          created_at?: string
          file_hash?: string
          file_name?: string
          id?: string
          imported_by?: string | null
          imported_via?: string
          rows_duplicated?: number
          rows_inserted?: number
          rows_matched?: number
          rows_needs_review?: number
          rows_total?: number
          source_type?: string
          summary?: Json
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          ai_category_id: string | null
          ai_confidence: number | null
          amount: number
          bank_account_id: string | null
          category_id: string | null
          classification_status: string
          created_at: string
          description: string
          fitid: string | null
          id: string
          import_batch_id: string | null
          memo: string | null
          notes: string | null
          transaction_date: string
          type: string
          updated_at: string
        }
        Insert: {
          ai_category_id?: string | null
          ai_confidence?: number | null
          amount: number
          bank_account_id?: string | null
          category_id?: string | null
          classification_status?: string
          created_at?: string
          description: string
          fitid?: string | null
          id?: string
          import_batch_id?: string | null
          memo?: string | null
          notes?: string | null
          transaction_date: string
          type?: string
          updated_at?: string
        }
        Update: {
          ai_category_id?: string | null
          ai_confidence?: number | null
          amount?: number
          bank_account_id?: string | null
          category_id?: string | null
          classification_status?: string
          created_at?: string
          description?: string
          fitid?: string | null
          id?: string
          import_batch_id?: string | null
          memo?: string | null
          notes?: string | null
          transaction_date?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_ai_category_id_fkey"
            columns: ["ai_category_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_contacts: {
        Row: {
          blocked_by: string | null
          blocked_by_name: string | null
          created_at: string
          id: string
          phone: string
          provider: string | null
          reason: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          blocked_by?: string | null
          blocked_by_name?: string | null
          created_at?: string
          id?: string
          phone: string
          provider?: string | null
          reason?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          blocked_by?: string | null
          blocked_by_name?: string | null
          created_at?: string
          id?: string
          phone?: string
          provider?: string | null
          reason?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_contacts_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_contacts_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_channels: {
        Row: {
          campaign_id: string
          channel_type: string
          content_plan: Json | null
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          schedule: Json | null
          strategy: string | null
          tone_of_voice: string | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          channel_type: string
          content_plan?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          schedule?: Json | null
          strategy?: string | null
          tone_of_voice?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          channel_type?: string
          content_plan?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          schedule?: Json | null
          strategy?: string | null
          tone_of_voice?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_channels_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_landing_pages: {
        Row: {
          campaign_id: string
          created_at: string
          custom_css: string | null
          description: string | null
          event_date: string | null
          form_fields: Json | null
          hero_image_url: string | null
          id: string
          is_active: boolean
          slug: string
          submissions: number
          thank_you_message: string | null
          title: string
          updated_at: string
          views: number
          whatsapp_redirect: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          custom_css?: string | null
          description?: string | null
          event_date?: string | null
          form_fields?: Json | null
          hero_image_url?: string | null
          id?: string
          is_active?: boolean
          slug: string
          submissions?: number
          thank_you_message?: string | null
          title: string
          updated_at?: string
          views?: number
          whatsapp_redirect?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          custom_css?: string | null
          description?: string | null
          event_date?: string | null
          form_fields?: Json | null
          hero_image_url?: string | null
          id?: string
          is_active?: boolean
          slug?: string
          submissions?: number
          thank_you_message?: string | null
          title?: string
          updated_at?: string
          views?: number
          whatsapp_redirect?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_landing_pages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          campaign_id: string
          conversion_value: number | null
          converted: boolean
          converted_at: string | null
          created_at: string
          email: string | null
          id: string
          instagram: string | null
          metadata: Json | null
          name: string | null
          phone: string | null
          source: string | null
        }
        Insert: {
          campaign_id: string
          conversion_value?: number | null
          converted?: boolean
          converted_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          source?: string | null
        }
        Update: {
          campaign_id?: string
          conversion_value?: number | null
          converted?: boolean
          converted_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_tasks: {
        Row: {
          assigned_to: string | null
          campaign_id: string
          channel_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          campaign_id: string
          channel_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          campaign_id?: string
          channel_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_tasks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_tasks_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "campaign_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_variables: {
        Row: {
          campaign_id: string
          id: string
          updated_at: string
          variable_name: string
          variable_value: string
        }
        Insert: {
          campaign_id: string
          id?: string
          updated_at?: string
          variable_name: string
          variable_value?: string
        }
        Update: {
          campaign_id?: string
          id?: string
          updated_at?: string
          variable_name?: string
          variable_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_variables_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "group_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_cards: {
        Row: {
          botao_payload: Json | null
          botao_tipo: string | null
          campanha_id: string
          created_at: string
          id: string
          imagem_url: string | null
          legenda: string | null
          ordem: number
          shopify_product_id: string | null
          shopify_variant_id: string | null
          status: string
          ultima_verificacao: string | null
          updated_at: string
        }
        Insert: {
          botao_payload?: Json | null
          botao_tipo?: string | null
          campanha_id: string
          created_at?: string
          id?: string
          imagem_url?: string | null
          legenda?: string | null
          ordem?: number
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          status?: string
          ultima_verificacao?: string | null
          updated_at?: string
        }
        Update: {
          botao_payload?: Json | null
          botao_tipo?: string | null
          campanha_id?: string
          created_at?: string
          id?: string
          imagem_url?: string | null
          legenda?: string | null
          ordem?: number
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          status?: string
          ultima_verificacao?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanha_cards_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_auto"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_envios: {
        Row: {
          campanha_id: string
          cliente_id: string | null
          created_at: string
          enviado_em: string
          erro: string | null
          id: string
          message_wamid: string | null
          phone: string | null
          phone_suffix8: string | null
          provider_at_send: string | null
          proxima_tentativa: string | null
          shadow_mode: boolean
          status: string
          template_category_at_send: string | null
          tentativas: number
          unit_cost_at_send: number | null
          updated_at: string
          vendedora_id: string | null
          vendedora_nome: string | null
        }
        Insert: {
          campanha_id: string
          cliente_id?: string | null
          created_at?: string
          enviado_em?: string
          erro?: string | null
          id?: string
          message_wamid?: string | null
          phone?: string | null
          phone_suffix8?: string | null
          provider_at_send?: string | null
          proxima_tentativa?: string | null
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          tentativas?: number
          unit_cost_at_send?: number | null
          updated_at?: string
          vendedora_id?: string | null
          vendedora_nome?: string | null
        }
        Update: {
          campanha_id?: string
          cliente_id?: string | null
          created_at?: string
          enviado_em?: string
          erro?: string | null
          id?: string
          message_wamid?: string | null
          phone?: string | null
          phone_suffix8?: string | null
          provider_at_send?: string | null
          proxima_tentativa?: string | null
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          tentativas?: number
          unit_cost_at_send?: number | null
          updated_at?: string
          vendedora_id?: string | null
          vendedora_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_envios_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas_auto"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_publicos: {
        Row: {
          created_at: string
          filtro_json: Json
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          filtro_json?: Json
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          filtro_json?: Json
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      campanhas_auto: {
        Row: {
          ativa: boolean
          botoes: Json
          card_body: string
          cooldown_dias: number
          created_at: string
          criada_por: string | null
          dias_semana: number[]
          filtro_json: Json
          id: string
          nome: string
          publico_id: string | null
          qtd_por_dia: number
          rodizio_vendedora: boolean
          shadow_mode: boolean
          template_categoria: string | null
          template_modelo: string | null
          tipo: string
          tipo_comunicacao: string
          top_body: string
          updated_at: string
          variaveis: Json
          vendedoras_rodizio: string[] | null
          whatsapp_number_id: string | null
        }
        Insert: {
          ativa?: boolean
          botoes?: Json
          card_body?: string
          cooldown_dias?: number
          created_at?: string
          criada_por?: string | null
          dias_semana?: number[]
          filtro_json?: Json
          id?: string
          nome: string
          publico_id?: string | null
          qtd_por_dia?: number
          rodizio_vendedora?: boolean
          shadow_mode?: boolean
          template_categoria?: string | null
          template_modelo?: string | null
          tipo?: string
          tipo_comunicacao: string
          top_body?: string
          updated_at?: string
          variaveis?: Json
          vendedoras_rodizio?: string[] | null
          whatsapp_number_id?: string | null
        }
        Update: {
          ativa?: boolean
          botoes?: Json
          card_body?: string
          cooldown_dias?: number
          created_at?: string
          criada_por?: string | null
          dias_semana?: number[]
          filtro_json?: Json
          id?: string
          nome?: string
          publico_id?: string | null
          qtd_por_dia?: number
          rodizio_vendedora?: boolean
          shadow_mode?: boolean
          template_categoria?: string | null
          template_modelo?: string | null
          tipo?: string
          tipo_comunicacao?: string
          top_body?: string
          updated_at?: string
          variaveis?: Json
          vendedoras_rodizio?: string[] | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_auto_publico_id_fkey"
            columns: ["publico_id"]
            isOneToOne: false
            referencedRelation: "campanha_publicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_auto_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_auto_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_flow_entries: {
        Row: {
          amount: number
          attachment_url: string | null
          bank_account_id: string | null
          bank_external_id: string | null
          category_id: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          description: string | null
          direction: string
          entry_date: string
          entry_datetime: string
          external_id: string | null
          external_source: string | null
          id: string
          is_transfer: boolean
          ledger: Database["public"]["Enums"]["ledger_book"]
          metadata: Json
          needs_review_reason: string | null
          payment_method: string | null
          pos_sale_id: string | null
          reconciled_with_id: string | null
          reconciliation_status: string | null
          source: string
          source_ref_id: string | null
          status: string
          store_id: string | null
          transfer_pair_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          bank_account_id?: string | null
          bank_external_id?: string | null
          category_id?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction: string
          entry_date: string
          entry_datetime?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_transfer?: boolean
          ledger?: Database["public"]["Enums"]["ledger_book"]
          metadata?: Json
          needs_review_reason?: string | null
          payment_method?: string | null
          pos_sale_id?: string | null
          reconciled_with_id?: string | null
          reconciliation_status?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          store_id?: string | null
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          bank_account_id?: string | null
          bank_external_id?: string | null
          category_id?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          direction?: string
          entry_date?: string
          entry_datetime?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_transfer?: boolean
          ledger?: Database["public"]["Enums"]["ledger_book"]
          metadata?: Json
          needs_review_reason?: string | null
          payment_method?: string | null
          pos_sale_id?: string | null
          reconciled_with_id?: string | null
          reconciliation_status?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          store_id?: string | null
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_flow_entries_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flow_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flow_entries_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flow_entries_reconciled_with_id_fkey"
            columns: ["reconciled_with_id"]
            isOneToOne: false
            referencedRelation: "cash_flow_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flow_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_landing_pages: {
        Row: {
          categories: Json
          clicks: number
          combo_tiers: Json | null
          created_at: string
          cta_text: string
          id: string
          is_active: boolean
          payment_info: string | null
          product_filter: Json | null
          selected_product_ids: string[] | null
          slug: string
          store_base_url: string
          subtitle: string | null
          theme_config: Json
          title: string
          updated_at: string
          views: number
          welcome_subtitle: string | null
          welcome_title: string
          whatsapp_numbers: Json
        }
        Insert: {
          categories?: Json
          clicks?: number
          combo_tiers?: Json | null
          created_at?: string
          cta_text?: string
          id?: string
          is_active?: boolean
          payment_info?: string | null
          product_filter?: Json | null
          selected_product_ids?: string[] | null
          slug: string
          store_base_url?: string
          subtitle?: string | null
          theme_config?: Json
          title: string
          updated_at?: string
          views?: number
          welcome_subtitle?: string | null
          welcome_title?: string
          whatsapp_numbers?: Json
        }
        Update: {
          categories?: Json
          clicks?: number
          combo_tiers?: Json | null
          created_at?: string
          cta_text?: string
          id?: string
          is_active?: boolean
          payment_info?: string | null
          product_filter?: Json | null
          selected_product_ids?: string[] | null
          slug?: string
          store_base_url?: string
          subtitle?: string | null
          theme_config?: Json
          title?: string
          updated_at?: string
          views?: number
          welcome_subtitle?: string | null
          welcome_title?: string
          whatsapp_numbers?: Json
        }
        Relationships: []
      }
      catalog_lead_pages: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          leads_count: number
          product_discounts: Json
          require_registration: boolean
          selected_product_ids: string[] | null
          shipping_cost: number | null
          slug: string
          subtitle: string | null
          theme_config: Json
          title: string
          updated_at: string
          views: number
          whatsapp_numbers: Json
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          leads_count?: number
          product_discounts?: Json
          require_registration?: boolean
          selected_product_ids?: string[] | null
          shipping_cost?: number | null
          slug: string
          subtitle?: string | null
          theme_config?: Json
          title: string
          updated_at?: string
          views?: number
          whatsapp_numbers?: Json
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          leads_count?: number
          product_discounts?: Json
          require_registration?: boolean
          selected_product_ids?: string[] | null
          shipping_cost?: number | null
          slug?: string
          subtitle?: string | null
          theme_config?: Json
          title?: string
          updated_at?: string
          views?: number
          whatsapp_numbers?: Json
        }
        Relationships: []
      }
      catalog_lead_registrations: {
        Row: {
          cart_items: Json | null
          cart_total: number | null
          catalog_page_id: string
          checkout_sale_id: string | null
          chosen_payment_method: string | null
          created_at: string
          id: string
          instagram_handle: string
          pix_code: string | null
          pix_expires_at: string | null
          recovery_disparo: number | null
          recovery_session_id: string | null
          recovery_ultimo_disparo_at: string | null
          status: string
          updated_at: string
          whatsapp: string
        }
        Insert: {
          cart_items?: Json | null
          cart_total?: number | null
          catalog_page_id: string
          checkout_sale_id?: string | null
          chosen_payment_method?: string | null
          created_at?: string
          id?: string
          instagram_handle: string
          pix_code?: string | null
          pix_expires_at?: string | null
          recovery_disparo?: number | null
          recovery_session_id?: string | null
          recovery_ultimo_disparo_at?: string | null
          status?: string
          updated_at?: string
          whatsapp: string
        }
        Update: {
          cart_items?: Json | null
          cart_total?: number | null
          catalog_page_id?: string
          checkout_sale_id?: string | null
          chosen_payment_method?: string | null
          created_at?: string
          id?: string
          instagram_handle?: string
          pix_code?: string | null
          pix_expires_at?: string | null
          recovery_disparo?: number | null
          recovery_session_id?: string | null
          recovery_ultimo_disparo_at?: string | null
          status?: string
          updated_at?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_lead_registrations_catalog_page_id_fkey"
            columns: ["catalog_page_id"]
            isOneToOne: false
            referencedRelation: "catalog_lead_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_sync_log: {
        Row: {
          base_name: string | null
          color: string | null
          created_at: string
          details: Json | null
          id: string
          master_id: string | null
          operation: string
          run_id: string
          size: string | null
          variant_id: string | null
        }
        Insert: {
          base_name?: string | null
          color?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          master_id?: string | null
          operation: string
          run_id: string
          size?: string | null
          variant_id?: string | null
        }
        Update: {
          base_name?: string | null
          color?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          master_id?: string | null
          operation?: string
          run_id?: string
          size?: string | null
          variant_id?: string | null
        }
        Relationships: []
      }
      chargebacks: {
        Row: {
          address_cep: string | null
          address_city: string | null
          address_complement: string | null
          address_key: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          amount: number | null
          chargeback_date: string | null
          contact_notes: string | null
          created_at: string
          created_by: string | null
          customer_cpf: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          id: string
          reason: string | null
          source: string
          source_order_id: string | null
          source_order_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_key?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          amount?: number | null
          chargeback_date?: string | null
          contact_notes?: string | null
          created_at?: string
          created_by?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          id?: string
          reason?: string | null
          source: string
          source_order_id?: string | null
          source_order_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address_cep?: string | null
          address_city?: string | null
          address_complement?: string | null
          address_key?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          amount?: number | null
          chargeback_date?: string | null
          contact_notes?: string | null
          created_at?: string
          created_by?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          id?: string
          reason?: string | null
          source?: string
          source_order_id?: string | null
          source_order_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_archived_conversations: {
        Row: {
          archived_at: string
          archived_by: string | null
          id: string
          phone: string
        }
        Insert: {
          archived_at?: string
          archived_by?: string | null
          id?: string
          phone: string
        }
        Update: {
          archived_at?: string
          archived_by?: string | null
          id?: string
          phone?: string
        }
        Relationships: []
      }
      chat_assignments: {
        Row: {
          ai_classification: string | null
          assigned_by: string
          assigned_to: string | null
          created_at: string
          id: string
          notes: string | null
          phone: string
          resolved_at: string | null
          sector_id: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_classification?: string | null
          assigned_by?: string
          assigned_to?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          phone: string
          resolved_at?: string | null
          sector_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_classification?: string | null
          assigned_by?: string
          assigned_to?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          phone?: string
          resolved_at?: string | null
          sector_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_assignments_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "chat_sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_attendance_rules: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          rule_key: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          rule_key: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          rule_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_awaiting_payment: {
        Row: {
          created_at: string
          id: string
          phone: string
          sale_id: string | null
          store_id: string | null
          type: string
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          phone: string
          sale_id?: string | null
          store_id?: string | null
          type?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          sale_id?: string | null
          store_id?: string | null
          type?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      chat_contacts: {
        Row: {
          created_at: string
          custom_name: string | null
          display_name: string | null
          id: string
          phone: string
          profile_pic_url: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          display_name?: string | null
          id?: string
          phone: string
          profile_pic_url?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          display_name?: string | null
          id?: string
          phone?: string
          profile_pic_url?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_conversation_assignments: {
        Row: {
          assigned_by: string | null
          assigned_name: string | null
          assigned_to: string
          created_at: string
          id: string
          notes: string | null
          phone: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          assigned_name?: string | null
          assigned_to: string
          created_at?: string
          id?: string
          notes?: string | null
          phone: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          assigned_name?: string | null
          assigned_to?: string
          created_at?: string
          id?: string
          notes?: string | null
          phone?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      chat_finish_reasons: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          label: string
          sort_order: number | null
          value: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          label: string
          sort_order?: number | null
          value: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          label?: string
          sort_order?: number | null
          value?: string
        }
        Relationships: []
      }
      chat_finished_conversations: {
        Row: {
          created_at: string
          duvida_text: string | null
          finish_reason: string | null
          finished_at: string
          finished_by: string | null
          id: string
          phone: string
          purchased: boolean | null
          sale_currency: string | null
          sale_value: number | null
          seller_id: string | null
          support_reason: string | null
          support_satisfactory: boolean | null
          trigger_id: string | null
        }
        Insert: {
          created_at?: string
          duvida_text?: string | null
          finish_reason?: string | null
          finished_at?: string
          finished_by?: string | null
          id?: string
          phone: string
          purchased?: boolean | null
          sale_currency?: string | null
          sale_value?: number | null
          seller_id?: string | null
          support_reason?: string | null
          support_satisfactory?: boolean | null
          trigger_id?: string | null
        }
        Update: {
          created_at?: string
          duvida_text?: string | null
          finish_reason?: string | null
          finished_at?: string
          finished_by?: string | null
          id?: string
          phone?: string
          purchased?: boolean | null
          sale_currency?: string | null
          sale_value?: number | null
          seller_id?: string | null
          support_reason?: string | null
          support_satisfactory?: boolean | null
          trigger_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_finished_conversations_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "sales_triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_nps_surveys: {
        Row: {
          created_at: string
          feedback: string | null
          finish_conversation_id: string | null
          id: string
          phone: string
          responded_at: string | null
          score: number | null
          seller_id: string | null
          sent_at: string
          store_id: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          finish_conversation_id?: string | null
          id?: string
          phone: string
          responded_at?: string | null
          score?: number | null
          seller_id?: string | null
          sent_at?: string
          store_id?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string
          feedback?: string | null
          finish_conversation_id?: string | null
          id?: string
          phone?: string
          responded_at?: string | null
          score?: number | null
          seller_id?: string | null
          sent_at?: string
          store_id?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      chat_payment_followups: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          interval_minutes: number
          is_active: boolean
          max_reminders: number
          next_reminder_at: string | null
          phone: string
          reminder_count: number
          sale_id: string | null
          seller_id: string | null
          type: string
          whatsapp_number_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          interval_minutes?: number
          is_active?: boolean
          max_reminders?: number
          next_reminder_at?: string | null
          phone: string
          reminder_count?: number
          sale_id?: string | null
          seller_id?: string | null
          type?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          interval_minutes?: number
          is_active?: boolean
          max_reminders?: number
          next_reminder_at?: string | null
          phone?: string
          reminder_count?: number
          sale_id?: string | null
          seller_id?: string | null
          type?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      chat_scheduled_followups: {
        Row: {
          campaign_id: string | null
          created_at: string
          id: string
          is_sent: boolean
          phone: string
          reason: string
          scheduled_at: string
          sent_at: string | null
          situation_hint: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          is_sent?: boolean
          phone: string
          reason?: string
          scheduled_at: string
          sent_at?: string | null
          situation_hint?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          is_sent?: boolean
          phone?: string
          reason?: string
          scheduled_at?: string
          sent_at?: string | null
          situation_hint?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_scheduled_followups_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns_ai"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sector_agents: {
        Row: {
          created_at: string
          current_load: number
          id: string
          is_active: boolean
          is_online: boolean
          last_assigned_at: string | null
          max_concurrent: number
          sector_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_load?: number
          id?: string
          is_active?: boolean
          is_online?: boolean
          last_assigned_at?: string | null
          max_concurrent?: number
          sector_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_load?: number
          id?: string
          is_active?: boolean
          is_online?: boolean
          last_assigned_at?: string | null
          max_concurrent?: number
          sector_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sector_agents_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "chat_sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sector_round_robin: {
        Row: {
          last_agent_index: number
          sector_id: string
          updated_at: string
        }
        Insert: {
          last_agent_index?: number
          sector_id: string
          updated_at?: string
        }
        Update: {
          last_agent_index?: number
          sector_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sector_round_robin_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: true
            referencedRelation: "chat_sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sectors: {
        Row: {
          ai_routing_keywords: string[] | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          ai_routing_keywords?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          ai_routing_keywords?: string[] | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      chat_seller_assignments: {
        Row: {
          assigned_at: string
          first_reply_at: string | null
          id: string
          opened_at: string
          phone: string
          seller_id: string | null
          store_id: string | null
        }
        Insert: {
          assigned_at?: string
          first_reply_at?: string | null
          id?: string
          opened_at?: string
          phone: string
          seller_id?: string | null
          store_id?: string | null
        }
        Update: {
          assigned_at?: string
          first_reply_at?: string | null
          id?: string
          opened_at?: string
          phone?: string
          seller_id?: string | null
          store_id?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          address_cep: string | null
          address_city: string | null
          address_city_ibge: string | null
          address_complement: string | null
          address_country: string
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          ambiente_nfe: Database["public"]["Enums"]["ambiente_nfe"]
          brasilnfe_token: string | null
          certificate_expires_at: string | null
          certificate_filename: string | null
          certificate_password: string | null
          certificate_path: string | null
          certificate_uploaded_at: string | null
          certificate_valid_until: string | null
          cnae_principal: string | null
          cnpj: string
          created_at: string
          crt: number
          email: string | null
          id: string
          ie: string | null
          ie_isento: boolean
          im: string | null
          is_active: boolean
          is_pilot: boolean
          legal_name: string
          notes: string | null
          phone: string | null
          regime_tributario: Database["public"]["Enums"]["regime_tributario"]
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          address_cep?: string | null
          address_city?: string | null
          address_city_ibge?: string | null
          address_complement?: string | null
          address_country?: string
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          ambiente_nfe?: Database["public"]["Enums"]["ambiente_nfe"]
          brasilnfe_token?: string | null
          certificate_expires_at?: string | null
          certificate_filename?: string | null
          certificate_password?: string | null
          certificate_path?: string | null
          certificate_uploaded_at?: string | null
          certificate_valid_until?: string | null
          cnae_principal?: string | null
          cnpj: string
          created_at?: string
          crt?: number
          email?: string | null
          id?: string
          ie?: string | null
          ie_isento?: boolean
          im?: string | null
          is_active?: boolean
          is_pilot?: boolean
          legal_name: string
          notes?: string | null
          phone?: string | null
          regime_tributario?: Database["public"]["Enums"]["regime_tributario"]
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          address_cep?: string | null
          address_city?: string | null
          address_city_ibge?: string | null
          address_complement?: string | null
          address_country?: string
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          ambiente_nfe?: Database["public"]["Enums"]["ambiente_nfe"]
          brasilnfe_token?: string | null
          certificate_expires_at?: string | null
          certificate_filename?: string | null
          certificate_password?: string | null
          certificate_path?: string | null
          certificate_uploaded_at?: string | null
          certificate_valid_until?: string | null
          cnae_principal?: string | null
          cnpj?: string
          created_at?: string
          crt?: number
          email?: string | null
          id?: string
          ie?: string | null
          ie_isento?: boolean
          im?: string | null
          is_active?: boolean
          is_pilot?: boolean
          legal_name?: string
          notes?: string | null
          phone?: string | null
          regime_tributario?: Database["public"]["Enums"]["regime_tributario"]
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversation_counts_cache: {
        Row: {
          awaiting_count: number
          id: number
          new_count: number
          updated_at: string
        }
        Insert: {
          awaiting_count?: number
          id?: number
          new_count?: number
          updated_at?: string
        }
        Update: {
          awaiting_count?: number
          id?: number
          new_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      cost_center_fixed_cost_items: {
        Row: {
          amount: number
          created_at: string
          fixed_cost_id: string
          id: string
          name: string
          sort_order: number | null
          store_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          fixed_cost_id: string
          id?: string
          name: string
          sort_order?: number | null
          store_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          fixed_cost_id?: string
          id?: string
          name?: string
          sort_order?: number | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_center_fixed_cost_items_fixed_cost_id_fkey"
            columns: ["fixed_cost_id"]
            isOneToOne: false
            referencedRelation: "cost_center_fixed_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_center_fixed_cost_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_center_fixed_costs: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          max_budget: number | null
          name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          max_budget?: number | null
          name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          max_budget?: number | null
          name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_center_planned_fixed_cuts: {
        Row: {
          created_at: string
          description: string | null
          fixed_cost_id: string
          id: string
          reduction_amount: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          fixed_cost_id: string
          id?: string
          reduction_amount?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          fixed_cost_id?: string
          id?: string
          reduction_amount?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_center_planned_fixed_cuts_fixed_cost_id_fkey"
            columns: ["fixed_cost_id"]
            isOneToOne: false
            referencedRelation: "cost_center_fixed_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_center_planned_variable_cuts: {
        Row: {
          created_at: string
          description: string | null
          id: string
          reduction_percentage: number
          store_id: string
          updated_at: string
          variable_cost_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          reduction_percentage?: number
          store_id: string
          updated_at?: string
          variable_cost_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          reduction_percentage?: number
          store_id?: string
          updated_at?: string
          variable_cost_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_center_planned_variable_cuts_variable_cost_id_fkey"
            columns: ["variable_cost_id"]
            isOneToOne: false
            referencedRelation: "cost_center_variable_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_center_store_fixed_costs: {
        Row: {
          amount: number
          created_at: string
          fixed_cost_id: string
          id: string
          is_active: boolean
          store_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          fixed_cost_id: string
          id?: string
          is_active?: boolean
          store_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          fixed_cost_id?: string
          id?: string
          is_active?: boolean
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_center_store_fixed_costs_fixed_cost_id_fkey"
            columns: ["fixed_cost_id"]
            isOneToOne: false
            referencedRelation: "cost_center_fixed_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_center_store_fixed_costs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_center_variable_costs: {
        Row: {
          created_at: string
          description: string
          id: string
          is_active: boolean
          percentage: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          is_active?: boolean
          percentage?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          percentage?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_center_variable_costs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_message_templates: {
        Row: {
          created_at: string
          id: string
          message: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_list_memberships: {
        Row: {
          added_at: string
          customer_id: string
          id: string
          list_id: string
          metadata: Json | null
          source: string | null
        }
        Insert: {
          added_at?: string
          customer_id: string
          id?: string
          list_id: string
          metadata?: Json | null
          source?: string | null
        }
        Update: {
          added_at?: string
          customer_id?: string
          id?: string
          list_id?: string
          metadata?: Json | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_list_memberships_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_list_memberships_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_unified"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_loyalty_points: {
        Row: {
          created_at: string
          customer_name: string | null
          customer_phone: string
          expires_at: string
          id: string
          last_earn_at: string
          lifetime_points: number
          store_id: string
          total_points: number
          unified_customer_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          customer_phone: string
          expires_at?: string
          id?: string
          last_earn_at?: string
          lifetime_points?: number
          store_id: string
          total_points?: number
          unified_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          customer_phone?: string
          expires_at?: string
          id?: string
          last_earn_at?: string
          lifetime_points?: number
          store_id?: string
          total_points?: number
          unified_customer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_loyalty_points_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_prizes: {
        Row: {
          campaign_id: string | null
          coupon_code: string
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string
          expires_at: string
          id: string
          is_redeemed: boolean
          live_session_id: string | null
          notes: string | null
          prize_label: string
          prize_type: string
          prize_value: number
          redeemed_at: string | null
          redeemed_sale_id: string | null
          segment_id: string | null
          source: string
          store_id: string | null
          unified_customer_id: string | null
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          coupon_code: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone: string
          expires_at: string
          id?: string
          is_redeemed?: boolean
          live_session_id?: string | null
          notes?: string | null
          prize_label: string
          prize_type: string
          prize_value?: number
          redeemed_at?: string | null
          redeemed_sale_id?: string | null
          segment_id?: string | null
          source?: string
          store_id?: string | null
          unified_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          coupon_code?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string
          expires_at?: string
          id?: string
          is_redeemed?: boolean
          live_session_id?: string | null
          notes?: string | null
          prize_label?: string
          prize_type?: string
          prize_value?: number
          redeemed_at?: string | null
          redeemed_sale_id?: string | null
          segment_id?: string | null
          source?: string
          store_id?: string | null
          unified_customer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_prizes_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "prize_wheel_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_prizes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_registrations: {
        Row: {
          address: string
          address_number: string
          cep: string
          city: string
          complement: string | null
          cpf: string
          created_at: string
          customer_id: string | null
          email: string
          fbc: string | null
          fbp: string | null
          full_name: string
          id: string
          neighborhood: string
          order_id: string
          shopify_draft_order_id: string | null
          shopify_draft_order_name: string | null
          state: string
          status: string
          updated_at: string
          whatsapp: string
        }
        Insert: {
          address: string
          address_number: string
          cep: string
          city: string
          complement?: string | null
          cpf: string
          created_at?: string
          customer_id?: string | null
          email: string
          fbc?: string | null
          fbp?: string | null
          full_name: string
          id?: string
          neighborhood: string
          order_id: string
          shopify_draft_order_id?: string | null
          shopify_draft_order_name?: string | null
          state: string
          status?: string
          updated_at?: string
          whatsapp: string
        }
        Update: {
          address?: string
          address_number?: string
          cep?: string
          city?: string
          complement?: string | null
          cpf?: string
          created_at?: string
          customer_id?: string | null
          email?: string
          fbc?: string | null
          fbp?: string | null
          full_name?: string
          id?: string
          neighborhood?: string
          order_id?: string
          shopify_draft_order_id?: string | null
          shopify_draft_order_name?: string | null
          state?: string
          status?: string
          updated_at?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_registrations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_registrations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          ban_reason: string | null
          created_at: string
          id: string
          instagram_handle: string
          is_banned: boolean
          live_cancellation_count: number | null
          tags: string[] | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          ban_reason?: string | null
          created_at?: string
          id?: string
          instagram_handle: string
          is_banned?: boolean
          live_cancellation_count?: number | null
          tags?: string[] | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          ban_reason?: string | null
          created_at?: string
          id?: string
          instagram_handle?: string
          is_banned?: boolean
          live_cancellation_count?: number | null
          tags?: string[] | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      customers_unified: {
        Row: {
          address: string | null
          address_number: string | null
          age_range: string | null
          avg_ticket: number
          ban_reason: string | null
          birth_date: string | null
          cashback_balance: number
          cashback_expires_at: string | null
          cep: string | null
          children_age_range: string | null
          city: string | null
          classificacao_disparo: string | null
          classificacao_disparo_updated_at: string | null
          complement: string | null
          cpf: string | null
          created_at: string
          customer_code: string | null
          ddd: string | null
          dispatch_consecutive_ignored: number
          dispatch_ignored_count: number
          dispatch_reacted_count: number
          dispatch_total_count: number
          email: string | null
          first_purchase_at: string | null
          gender: string | null
          has_children: boolean | null
          id: string
          instagram_handle: string | null
          instagram_user_id: string | null
          is_archived: boolean
          is_banned: boolean
          last_engagement_at: string | null
          last_engagement_type: string | null
          last_purchase_at: string | null
          last_seen_at: string | null
          lead_temperature: string | null
          legacy_first_purchase_at: string | null
          legacy_last_purchase_at: string | null
          legacy_orders: number
          legacy_spent: number
          live_cancellation_count: number
          loyalty_lifetime_points: number
          loyalty_points: number
          merged_into_id: string | null
          metadata: Json | null
          name: string | null
          neighborhood: string | null
          opt_out_mass_dispatch: boolean
          payment_methods: string[] | null
          phone_e164: string | null
          phone_suffix8: string | null
          preferred_style: string | null
          previous_phones: string[] | null
          purchased_brands: string[] | null
          purchased_categories: string[] | null
          purchased_sizes: string[] | null
          purchased_stores: string[] | null
          region_type: string | null
          rfm_f: number | null
          rfm_m: number | null
          rfm_r: number | null
          rfm_segment: string | null
          rfm_total: number | null
          shoe_size: string | null
          source_origins: Json | null
          state: string | null
          tags: string[] | null
          temperature_updated_at: string | null
          tenant_id: string | null
          total_items: number
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          address_number?: string | null
          age_range?: string | null
          avg_ticket?: number
          ban_reason?: string | null
          birth_date?: string | null
          cashback_balance?: number
          cashback_expires_at?: string | null
          cep?: string | null
          children_age_range?: string | null
          city?: string | null
          classificacao_disparo?: string | null
          classificacao_disparo_updated_at?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          customer_code?: string | null
          ddd?: string | null
          dispatch_consecutive_ignored?: number
          dispatch_ignored_count?: number
          dispatch_reacted_count?: number
          dispatch_total_count?: number
          email?: string | null
          first_purchase_at?: string | null
          gender?: string | null
          has_children?: boolean | null
          id?: string
          instagram_handle?: string | null
          instagram_user_id?: string | null
          is_archived?: boolean
          is_banned?: boolean
          last_engagement_at?: string | null
          last_engagement_type?: string | null
          last_purchase_at?: string | null
          last_seen_at?: string | null
          lead_temperature?: string | null
          legacy_first_purchase_at?: string | null
          legacy_last_purchase_at?: string | null
          legacy_orders?: number
          legacy_spent?: number
          live_cancellation_count?: number
          loyalty_lifetime_points?: number
          loyalty_points?: number
          merged_into_id?: string | null
          metadata?: Json | null
          name?: string | null
          neighborhood?: string | null
          opt_out_mass_dispatch?: boolean
          payment_methods?: string[] | null
          phone_e164?: string | null
          phone_suffix8?: string | null
          preferred_style?: string | null
          previous_phones?: string[] | null
          purchased_brands?: string[] | null
          purchased_categories?: string[] | null
          purchased_sizes?: string[] | null
          purchased_stores?: string[] | null
          region_type?: string | null
          rfm_f?: number | null
          rfm_m?: number | null
          rfm_r?: number | null
          rfm_segment?: string | null
          rfm_total?: number | null
          shoe_size?: string | null
          source_origins?: Json | null
          state?: string | null
          tags?: string[] | null
          temperature_updated_at?: string | null
          tenant_id?: string | null
          total_items?: number
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          address_number?: string | null
          age_range?: string | null
          avg_ticket?: number
          ban_reason?: string | null
          birth_date?: string | null
          cashback_balance?: number
          cashback_expires_at?: string | null
          cep?: string | null
          children_age_range?: string | null
          city?: string | null
          classificacao_disparo?: string | null
          classificacao_disparo_updated_at?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          customer_code?: string | null
          ddd?: string | null
          dispatch_consecutive_ignored?: number
          dispatch_ignored_count?: number
          dispatch_reacted_count?: number
          dispatch_total_count?: number
          email?: string | null
          first_purchase_at?: string | null
          gender?: string | null
          has_children?: boolean | null
          id?: string
          instagram_handle?: string | null
          instagram_user_id?: string | null
          is_archived?: boolean
          is_banned?: boolean
          last_engagement_at?: string | null
          last_engagement_type?: string | null
          last_purchase_at?: string | null
          last_seen_at?: string | null
          lead_temperature?: string | null
          legacy_first_purchase_at?: string | null
          legacy_last_purchase_at?: string | null
          legacy_orders?: number
          legacy_spent?: number
          live_cancellation_count?: number
          loyalty_lifetime_points?: number
          loyalty_points?: number
          merged_into_id?: string | null
          metadata?: Json | null
          name?: string | null
          neighborhood?: string | null
          opt_out_mass_dispatch?: boolean
          payment_methods?: string[] | null
          phone_e164?: string | null
          phone_suffix8?: string | null
          preferred_style?: string | null
          previous_phones?: string[] | null
          purchased_brands?: string[] | null
          purchased_categories?: string[] | null
          purchased_sizes?: string[] | null
          purchased_stores?: string[] | null
          region_type?: string | null
          rfm_f?: number | null
          rfm_m?: number | null
          rfm_r?: number | null
          rfm_segment?: string | null
          rfm_total?: number | null
          shoe_size?: string | null
          source_origins?: Json | null
          state?: string | null
          tags?: string[] | null
          temperature_updated_at?: string | null
          tenant_id?: string | null
          total_items?: number
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_unified_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "crm_customers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_unified_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "customers_unified"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_costs: {
        Row: {
          amount: number
          created_at: string
          customer_name: string | null
          expedition_order_id: string | null
          id: string
          notes: string | null
          payment_id: string | null
          pos_sale_id: string | null
          provider_id: string | null
          provider_type: string
          source: string
          status: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          customer_name?: string | null
          expedition_order_id?: string | null
          id?: string
          notes?: string | null
          payment_id?: string | null
          pos_sale_id?: string | null
          provider_id?: string | null
          provider_type?: string
          source?: string
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_name?: string | null
          expedition_order_id?: string | null
          id?: string
          notes?: string | null
          payment_id?: string | null
          pos_sale_id?: string | null
          provider_id?: string | null
          provider_type?: string
          source?: string
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_costs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "provider_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_costs_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_costs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "service_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_costs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_history: {
        Row: {
          audience_filters: Json | null
          audience_source: string | null
          campaign_name: string | null
          completed_at: string | null
          cost_override_brl: number | null
          cost_per_message: number | null
          created_at: string
          created_by: string | null
          failed_count: number | null
          force_resend: boolean | null
          has_dynamic_vars: boolean | null
          header_media_url: string | null
          id: string
          manual_overrides: Json
          processing_batch: boolean | null
          provider: string | null
          provider_at_send: string | null
          quota_check_summary: Json | null
          rendered_message: string | null
          scheduled_at: string | null
          sent_count: number | null
          shadow_mode: boolean
          started_at: string
          status: string | null
          template_category: string | null
          template_category_at_send: string | null
          template_components: Json | null
          template_language: string | null
          template_name: string
          tipo_comunicacao: string | null
          total_recipients: number | null
          unit_cost_at_send: number | null
          variables_config: Json | null
          whatsapp_number_id: string | null
        }
        Insert: {
          audience_filters?: Json | null
          audience_source?: string | null
          campaign_name?: string | null
          completed_at?: string | null
          cost_override_brl?: number | null
          cost_per_message?: number | null
          created_at?: string
          created_by?: string | null
          failed_count?: number | null
          force_resend?: boolean | null
          has_dynamic_vars?: boolean | null
          header_media_url?: string | null
          id?: string
          manual_overrides?: Json
          processing_batch?: boolean | null
          provider?: string | null
          provider_at_send?: string | null
          quota_check_summary?: Json | null
          rendered_message?: string | null
          scheduled_at?: string | null
          sent_count?: number | null
          shadow_mode?: boolean
          started_at?: string
          status?: string | null
          template_category?: string | null
          template_category_at_send?: string | null
          template_components?: Json | null
          template_language?: string | null
          template_name: string
          tipo_comunicacao?: string | null
          total_recipients?: number | null
          unit_cost_at_send?: number | null
          variables_config?: Json | null
          whatsapp_number_id?: string | null
        }
        Update: {
          audience_filters?: Json | null
          audience_source?: string | null
          campaign_name?: string | null
          completed_at?: string | null
          cost_override_brl?: number | null
          cost_per_message?: number | null
          created_at?: string
          created_by?: string | null
          failed_count?: number | null
          force_resend?: boolean | null
          has_dynamic_vars?: boolean | null
          header_media_url?: string | null
          id?: string
          manual_overrides?: Json
          processing_batch?: boolean | null
          provider?: string | null
          provider_at_send?: string | null
          quota_check_summary?: Json | null
          rendered_message?: string | null
          scheduled_at?: string | null
          sent_count?: number | null
          shadow_mode?: boolean
          started_at?: string
          status?: string | null
          template_category?: string | null
          template_category_at_send?: string | null
          template_components?: Json | null
          template_language?: string | null
          template_name?: string
          tipo_comunicacao?: string | null
          total_recipients?: number | null
          unit_cost_at_send?: number | null
          variables_config?: Json | null
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      dispatch_recipients: {
        Row: {
          attempts: number
          created_at: string
          dispatch_id: string
          id: string
          last_error: string | null
          lease_until: string | null
          message_wamid: string | null
          override_reason: string | null
          phone: string
          provider_at_send: string | null
          recipient_name: string | null
          sent_at: string | null
          shadow_mode: boolean
          status: string | null
          template_category_at_send: string | null
          unified_customer_id: string | null
          unit_cost_at_send: number | null
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          dispatch_id: string
          id?: string
          last_error?: string | null
          lease_until?: string | null
          message_wamid?: string | null
          override_reason?: string | null
          phone: string
          provider_at_send?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          shadow_mode?: boolean
          status?: string | null
          template_category_at_send?: string | null
          unified_customer_id?: string | null
          unit_cost_at_send?: number | null
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          dispatch_id?: string
          id?: string
          last_error?: string | null
          lease_until?: string | null
          message_wamid?: string | null
          override_reason?: string | null
          phone?: string
          provider_at_send?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          shadow_mode?: boolean
          status?: string | null
          template_category_at_send?: string | null
          unified_customer_id?: string | null
          unit_cost_at_send?: number | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_recipients_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatch_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_recipients_unified_customer_id_fkey"
            columns: ["unified_customer_id"]
            isOneToOne: false
            referencedRelation: "crm_customers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_recipients_unified_customer_id_fkey"
            columns: ["unified_customer_id"]
            isOneToOne: false
            referencedRelation: "customers_unified"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_touch_limits: {
        Row: {
          classificacao: string
          cota_mensal: number
          created_at: string
          min_dias_entre_toques: number
          observacoes: string | null
          silencio_threshold_ignorados: number | null
          tipos_permitidos: string[]
          updated_at: string
        }
        Insert: {
          classificacao: string
          cota_mensal?: number
          created_at?: string
          min_dias_entre_toques?: number
          observacoes?: string | null
          silencio_threshold_ignorados?: number | null
          tipos_permitidos?: string[]
          updated_at?: string
        }
        Update: {
          classificacao?: string
          cota_mensal?: number
          created_at?: string
          min_dias_entre_toques?: number
          observacoes?: string | null
          silencio_threshold_ignorados?: number | null
          tipos_permitidos?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      email_campaigns: {
        Row: {
          created_at: string
          from_email: string | null
          from_name: string | null
          id: string
          list_id: string | null
          name: string
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subject: string
          template_id: string | null
          total_recipients: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          list_id?: string | null
          name: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          list_id?: string | null
          name?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "email_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_contacts: {
        Row: {
          created_at: string
          custom_fields: Json | null
          email: string
          id: string
          list_id: string
          name: string | null
          subscribed: boolean
          tags: string[] | null
          unsubscribed_at: string | null
        }
        Insert: {
          created_at?: string
          custom_fields?: Json | null
          email: string
          id?: string
          list_id: string
          name?: string | null
          subscribed?: boolean
          tags?: string[] | null
          unsubscribed_at?: string | null
        }
        Update: {
          created_at?: string
          custom_fields?: Json | null
          email?: string
          id?: string
          list_id?: string
          name?: string | null
          subscribed?: boolean
          tags?: string[] | null
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_contacts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "email_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          campaign_id: string
          contact_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          campaign_id: string
          contact_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          campaign_id?: string
          contact_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "email_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_lists: {
        Row: {
          contact_count: number
          created_at: string
          description: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          contact_count?: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          contact_count?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          blocks: Json | null
          created_at: string
          html_content: string | null
          id: string
          name: string
          subject: string | null
          thumbnail_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          blocks?: Json | null
          created_at?: string
          html_content?: string | null
          id?: string
          name: string
          subject?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          blocks?: Json | null
          created_at?: string
          html_content?: string | null
          id?: string
          name?: string
          subject?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      event_crossell_offers: {
        Row: {
          created_at: string
          discount_price: number
          event_id: string
          has_sizes: boolean
          id: string
          image: string | null
          is_active: boolean
          original_price: number
          position: number
          product_title: string | null
          shopify_product_id: string
          updated_at: string
          variant_handle: string | null
        }
        Insert: {
          created_at?: string
          discount_price?: number
          event_id: string
          has_sizes?: boolean
          id?: string
          image?: string | null
          is_active?: boolean
          original_price?: number
          position?: number
          product_title?: string | null
          shopify_product_id: string
          updated_at?: string
          variant_handle?: string | null
        }
        Update: {
          created_at?: string
          discount_price?: number
          event_id?: string
          has_sizes?: boolean
          id?: string
          image?: string | null
          is_active?: boolean
          original_price?: number
          position?: number
          product_title?: string | null
          shopify_product_id?: string
          updated_at?: string
          variant_handle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_crossell_offers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_followup_configs: {
        Row: {
          buttons: Json
          channel: string
          created_at: string
          delay_minutes: number
          enabled: boolean
          event_id: string
          id: string
          message_text: string | null
          order_index: number
          stop_on_paid: boolean
          stop_on_reply: boolean
          template_language: string | null
          template_name: string | null
          template_variables: Json
          trigger_source: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          buttons?: Json
          channel: string
          created_at?: string
          delay_minutes?: number
          enabled?: boolean
          event_id: string
          id?: string
          message_text?: string | null
          order_index?: number
          stop_on_paid?: boolean
          stop_on_reply?: boolean
          template_language?: string | null
          template_name?: string | null
          template_variables?: Json
          trigger_source?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          buttons?: Json
          channel?: string
          created_at?: string
          delay_minutes?: number
          enabled?: boolean
          event_id?: string
          id?: string
          message_text?: string | null
          order_index?: number
          stop_on_paid?: boolean
          stop_on_reply?: boolean
          template_language?: string | null
          template_name?: string | null
          template_variables?: Json
          trigger_source?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_followup_configs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_followup_configs_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_followup_configs_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      event_followup_dispatches: {
        Row: {
          attempts: number
          channel: string
          config_id: string
          created_at: string
          error_message: string | null
          event_id: string
          id: string
          meta_message_id: string | null
          order_id: string
          scheduled_at: string
          sent_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel: string
          config_id: string
          created_at?: string
          error_message?: string | null
          event_id: string
          id?: string
          meta_message_id?: string | null
          order_id: string
          scheduled_at: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: string
          config_id?: string
          created_at?: string
          error_message?: string | null
          event_id?: string
          id?: string
          meta_message_id?: string | null
          order_id?: string
          scheduled_at?: string
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_followup_dispatches_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "event_followup_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_followup_dispatches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_followup_dispatches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      event_landing_pages: {
        Row: {
          config_json: Json
          created_at: string
          event_id: string
          event_starts_at: string | null
          hero_image_url: string | null
          id: string
          og_image_url: string | null
          prize_description: string | null
          published: boolean
          require_privacy_consent: boolean
          slug: string
          success_message: string | null
          theme_json: Json
          title: string
          updated_at: string
          vip_group_link: string | null
        }
        Insert: {
          config_json?: Json
          created_at?: string
          event_id: string
          event_starts_at?: string | null
          hero_image_url?: string | null
          id?: string
          og_image_url?: string | null
          prize_description?: string | null
          published?: boolean
          require_privacy_consent?: boolean
          slug: string
          success_message?: string | null
          theme_json?: Json
          title?: string
          updated_at?: string
          vip_group_link?: string | null
        }
        Update: {
          config_json?: Json
          created_at?: string
          event_id?: string
          event_starts_at?: string | null
          hero_image_url?: string | null
          id?: string
          og_image_url?: string | null
          prize_description?: string | null
          published?: boolean
          require_privacy_consent?: boolean
          slug?: string
          success_message?: string | null
          theme_json?: Json
          title?: string
          updated_at?: string
          vip_group_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_landing_pages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_leads: {
        Row: {
          created_at: string
          event_id: string
          id: string
          instagram: string | null
          landing_page_id: string | null
          metadata: Json
          name: string
          phone: string
          phone_suffix: string | null
          prize_unlocked_at: string | null
          referral_token: string
          referred_by_lead_id: string | null
          referred_count: number
          source: string
          typebot_id: string | null
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          vip_group_sent_at: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          instagram?: string | null
          landing_page_id?: string | null
          metadata?: Json
          name: string
          phone: string
          phone_suffix?: string | null
          prize_unlocked_at?: string | null
          referral_token?: string
          referred_by_lead_id?: string | null
          referred_count?: number
          source?: string
          typebot_id?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          vip_group_sent_at?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          instagram?: string | null
          landing_page_id?: string | null
          metadata?: Json
          name?: string
          phone?: string
          phone_suffix?: string | null
          prize_unlocked_at?: string | null
          referral_token?: string
          referred_by_lead_id?: string | null
          referred_count?: number
          source?: string
          typebot_id?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          vip_group_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_leads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_leads_landing_page_id_fkey"
            columns: ["landing_page_id"]
            isOneToOne: false
            referencedRelation: "event_landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_leads_referred_by_lead_id_fkey"
            columns: ["referred_by_lead_id"]
            isOneToOne: false
            referencedRelation: "event_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_leads_typebot_id_fkey"
            columns: ["typebot_id"]
            isOneToOne: false
            referencedRelation: "event_typebots"
            referencedColumns: ["id"]
          },
        ]
      }
      event_pinned_conversations: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          order_id: string
          pinned_by: string | null
          pinned_by_name: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          order_id: string
          pinned_by?: string | null
          pinned_by_name?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          order_id?: string
          pinned_by?: string | null
          pinned_by_name?: string | null
        }
        Relationships: []
      }
      event_promotions: {
        Row: {
          created_at: string
          event_id: string
          id: string
          is_active: boolean
          name: string
          shopify_collection_handle: string | null
          shopify_product_ids: string[] | null
          tiers: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          is_active?: boolean
          name: string
          shopify_collection_handle?: string | null
          shopify_product_ids?: string[] | null
          tiers?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          is_active?: boolean
          name?: string
          shopify_collection_handle?: string | null
          shopify_product_ids?: string[] | null
          tiers?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_promotions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_stock_alerts: {
        Row: {
          created_at: string
          event_id: string
          id: string
          image_url: string | null
          product_title: string
          resolved_at: string | null
          resolved_by: string | null
          sku: string | null
          status: string
          variant: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          image_url?: string | null
          product_title: string
          resolved_at?: string | null
          resolved_by?: string | null
          sku?: string | null
          status?: string
          variant?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          image_url?: string | null
          product_title?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sku?: string | null
          status?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_stock_alerts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_team_assignments: {
        Row: {
          created_at: string
          event_id: string
          id: string
          team_member_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          team_member_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_team_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_team_assignments_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "event_team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      event_team_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          photo_url: string | null
          role: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          photo_url?: string | null
          role?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          photo_url?: string | null
          role?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      event_typebots: {
        Row: {
          created_at: string
          event_id: string
          event_starts_at: string | null
          flow_json: Json
          id: string
          name: string
          prize_description: string | null
          published: boolean
          slug: string
          success_message: string | null
          theme_json: Json
          updated_at: string
          vip_group_link: string | null
          welcome_message: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          event_starts_at?: string | null
          flow_json?: Json
          id?: string
          name?: string
          prize_description?: string | null
          published?: boolean
          slug: string
          success_message?: string | null
          theme_json?: Json
          updated_at?: string
          vip_group_link?: string | null
          welcome_message?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          event_starts_at?: string | null
          flow_json?: Json
          id?: string
          name?: string
          prize_description?: string | null
          published?: boolean
          slug?: string
          success_message?: string | null
          theme_json?: Json
          updated_at?: string
          vip_group_link?: string | null
          welcome_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_typebots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          active_product_delay_seconds: number
          automation_enabled: boolean
          catalog_lead_page_id: string | null
          channel: Database["public"]["Enums"]["event_channel"]
          channel_preference: string
          channel_preferences: string[]
          created_at: string
          crossell_configured: boolean
          crossell_enabled: boolean
          default_shipping_cost: number | null
          default_store_id: string | null
          description: string | null
          end_date: string | null
          followup_templates: Json
          free_shipping_threshold: number | null
          id: string
          ig_automations: Json
          ig_initial_message_buttons: Json
          initial_message_blocks: Json
          initial_message_enabled: boolean
          instagram_live_url: string | null
          installment_max: number | null
          installment_min_value: number | null
          is_active: boolean
          is_live_broadcasting: boolean
          live_active_until: string | null
          live_broadcast_started_at: string | null
          live_url_updated_at: string | null
          manual_pos_routing: boolean
          meta_template_body_variables: Json | null
          meta_template_header_variable: string | null
          meta_template_language: string | null
          meta_template_name: string | null
          name: string
          setup_completed: boolean
          start_date: string | null
          store_ids: string[] | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          active_product_delay_seconds?: number
          automation_enabled?: boolean
          catalog_lead_page_id?: string | null
          channel?: Database["public"]["Enums"]["event_channel"]
          channel_preference?: string
          channel_preferences?: string[]
          created_at?: string
          crossell_configured?: boolean
          crossell_enabled?: boolean
          default_shipping_cost?: number | null
          default_store_id?: string | null
          description?: string | null
          end_date?: string | null
          followup_templates?: Json
          free_shipping_threshold?: number | null
          id?: string
          ig_automations?: Json
          ig_initial_message_buttons?: Json
          initial_message_blocks?: Json
          initial_message_enabled?: boolean
          instagram_live_url?: string | null
          installment_max?: number | null
          installment_min_value?: number | null
          is_active?: boolean
          is_live_broadcasting?: boolean
          live_active_until?: string | null
          live_broadcast_started_at?: string | null
          live_url_updated_at?: string | null
          manual_pos_routing?: boolean
          meta_template_body_variables?: Json | null
          meta_template_header_variable?: string | null
          meta_template_language?: string | null
          meta_template_name?: string | null
          name: string
          setup_completed?: boolean
          start_date?: string | null
          store_ids?: string[] | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          active_product_delay_seconds?: number
          automation_enabled?: boolean
          catalog_lead_page_id?: string | null
          channel?: Database["public"]["Enums"]["event_channel"]
          channel_preference?: string
          channel_preferences?: string[]
          created_at?: string
          crossell_configured?: boolean
          crossell_enabled?: boolean
          default_shipping_cost?: number | null
          default_store_id?: string | null
          description?: string | null
          end_date?: string | null
          followup_templates?: Json
          free_shipping_threshold?: number | null
          id?: string
          ig_automations?: Json
          ig_initial_message_buttons?: Json
          initial_message_blocks?: Json
          initial_message_enabled?: boolean
          instagram_live_url?: string | null
          installment_max?: number | null
          installment_min_value?: number | null
          is_active?: boolean
          is_live_broadcasting?: boolean
          live_active_until?: string | null
          live_broadcast_started_at?: string | null
          live_url_updated_at?: string | null
          manual_pos_routing?: boolean
          meta_template_body_variables?: Json | null
          meta_template_header_variable?: string | null
          meta_template_language?: string | null
          meta_template_name?: string | null
          name?: string
          setup_completed?: boolean
          start_date?: string | null
          store_ids?: string[] | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_catalog_lead_page_id_fkey"
            columns: ["catalog_lead_page_id"]
            isOneToOne: false
            referencedRelation: "catalog_lead_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_requests: {
        Row: {
          ai_interpretation: string | null
          ai_nuance_tags: string[] | null
          auto_approved: boolean | null
          created_at: string
          customer_name: string | null
          customer_verbatim: string | null
          desired_size: string | null
          fit_area: string | null
          fit_detail: string | null
          frenet_quote_id: string | null
          id: string
          order_number: string | null
          phone: string
          product_name: string
          product_size: string | null
          product_sku: string | null
          reason_category: Database["public"]["Enums"]["exchange_reason_category"]
          reason_subcategory: string | null
          requires_human_review: boolean | null
          reverse_shipping_code: string | null
          reverse_tracking_url: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shipping_carrier: string | null
          status: Database["public"]["Enums"]["exchange_status"]
          support_ticket_id: string | null
          tiny_order_id: string | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          ai_interpretation?: string | null
          ai_nuance_tags?: string[] | null
          auto_approved?: boolean | null
          created_at?: string
          customer_name?: string | null
          customer_verbatim?: string | null
          desired_size?: string | null
          fit_area?: string | null
          fit_detail?: string | null
          frenet_quote_id?: string | null
          id?: string
          order_number?: string | null
          phone: string
          product_name: string
          product_size?: string | null
          product_sku?: string | null
          reason_category?: Database["public"]["Enums"]["exchange_reason_category"]
          reason_subcategory?: string | null
          requires_human_review?: boolean | null
          reverse_shipping_code?: string | null
          reverse_tracking_url?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipping_carrier?: string | null
          status?: Database["public"]["Enums"]["exchange_status"]
          support_ticket_id?: string | null
          tiny_order_id?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          ai_interpretation?: string | null
          ai_nuance_tags?: string[] | null
          auto_approved?: boolean | null
          created_at?: string
          customer_name?: string | null
          customer_verbatim?: string | null
          desired_size?: string | null
          fit_area?: string | null
          fit_detail?: string | null
          frenet_quote_id?: string | null
          id?: string
          order_number?: string | null
          phone?: string
          product_name?: string
          product_size?: string | null
          product_sku?: string | null
          reason_category?: Database["public"]["Enums"]["exchange_reason_category"]
          reason_subcategory?: string | null
          requires_human_review?: boolean | null
          reverse_shipping_code?: string | null
          reverse_tracking_url?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shipping_carrier?: string | null
          status?: Database["public"]["Enums"]["exchange_status"]
          support_ticket_id?: string | null
          tiny_order_id?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      expedition_beta_order_items: {
        Row: {
          barcode: string | null
          created_at: string
          expedition_order_id: string
          id: string
          pack_verified: boolean | null
          packed_quantity: number | null
          pick_verified: boolean | null
          picked_quantity: number | null
          product_name: string
          quantity: number
          shopify_line_item_id: string | null
          sku: string | null
          unit_price: number | null
          variant_name: string | null
          weight_grams: number | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          expedition_order_id: string
          id?: string
          pack_verified?: boolean | null
          packed_quantity?: number | null
          pick_verified?: boolean | null
          picked_quantity?: number | null
          product_name: string
          quantity?: number
          shopify_line_item_id?: string | null
          sku?: string | null
          unit_price?: number | null
          variant_name?: string | null
          weight_grams?: number | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          expedition_order_id?: string
          id?: string
          pack_verified?: boolean | null
          packed_quantity?: number | null
          pick_verified?: boolean | null
          picked_quantity?: number | null
          product_name?: string
          quantity?: number
          shopify_line_item_id?: string | null
          sku?: string | null
          unit_price?: number | null
          variant_name?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expedition_beta_order_items_expedition_order_id_fkey"
            columns: ["expedition_order_id"]
            isOneToOne: false
            referencedRelation: "expedition_beta_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_beta_orders: {
        Row: {
          created_at: string
          customer_cpf: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          dispatch_verified: boolean | null
          dispatch_verified_at: string | null
          ean13_barcode: string | null
          expedition_status: string
          financial_status: string
          fulfillment_status: string | null
          group_id: string | null
          has_gift: boolean
          id: string
          internal_barcode: string | null
          is_from_live: boolean
          notes: string | null
          picking_list_id: string | null
          shipping_address: Json | null
          shipping_method: string | null
          shopify_created_at: string | null
          shopify_order_id: string
          shopify_order_name: string | null
          shopify_order_number: string | null
          source_event_date: string | null
          source_event_name: string | null
          subtotal_price: number | null
          tiny_order_id: string | null
          tiny_order_number: string | null
          total_discount: number | null
          total_price: number | null
          total_shipping: number | null
          total_weight_grams: number | null
          tracking_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          dispatch_verified?: boolean | null
          dispatch_verified_at?: string | null
          ean13_barcode?: string | null
          expedition_status?: string
          financial_status?: string
          fulfillment_status?: string | null
          group_id?: string | null
          has_gift?: boolean
          id?: string
          internal_barcode?: string | null
          is_from_live?: boolean
          notes?: string | null
          picking_list_id?: string | null
          shipping_address?: Json | null
          shipping_method?: string | null
          shopify_created_at?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
          shopify_order_number?: string | null
          source_event_date?: string | null
          source_event_name?: string | null
          subtotal_price?: number | null
          tiny_order_id?: string | null
          tiny_order_number?: string | null
          total_discount?: number | null
          total_price?: number | null
          total_shipping?: number | null
          total_weight_grams?: number | null
          tracking_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          dispatch_verified?: boolean | null
          dispatch_verified_at?: string | null
          ean13_barcode?: string | null
          expedition_status?: string
          financial_status?: string
          fulfillment_status?: string | null
          group_id?: string | null
          has_gift?: boolean
          id?: string
          internal_barcode?: string | null
          is_from_live?: boolean
          notes?: string | null
          picking_list_id?: string | null
          shipping_address?: Json | null
          shipping_method?: string | null
          shopify_created_at?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          shopify_order_number?: string | null
          source_event_date?: string | null
          source_event_name?: string | null
          subtotal_price?: number | null
          tiny_order_id?: string | null
          tiny_order_number?: string | null
          total_discount?: number | null
          total_price?: number | null
          total_shipping?: number | null
          total_weight_grams?: number | null
          tracking_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expedition_dispatch_manifest_items: {
        Row: {
          created_at: string
          expedition_order_id: string
          id: string
          manifest_id: string
          tracking_code: string | null
          verified: boolean | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          expedition_order_id: string
          id?: string
          manifest_id: string
          tracking_code?: string | null
          verified?: boolean | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          expedition_order_id?: string
          id?: string
          manifest_id?: string
          tracking_code?: string | null
          verified?: boolean | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expedition_dispatch_manifest_items_expedition_order_id_fkey"
            columns: ["expedition_order_id"]
            isOneToOne: false
            referencedRelation: "expedition_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedition_dispatch_manifest_items_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "expedition_dispatch_manifests"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_dispatch_manifests: {
        Row: {
          carrier: string
          collected_at: string | null
          collector_name: string | null
          created_at: string
          id: string
          manifest_number: string | null
          notes: string | null
          order_count: number | null
          signature_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          carrier: string
          collected_at?: string | null
          collector_name?: string | null
          created_at?: string
          id?: string
          manifest_number?: string | null
          notes?: string | null
          order_count?: number | null
          signature_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          carrier?: string
          collected_at?: string | null
          collector_name?: string | null
          created_at?: string
          id?: string
          manifest_number?: string | null
          notes?: string | null
          order_count?: number | null
          signature_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      expedition_freight_quotes: {
        Row: {
          carrier: string
          delivery_days: number | null
          error_message: string | null
          expedition_order_id: string
          id: string
          is_selected: boolean | null
          price: number
          quoted_at: string
          service: string
          tiny_forma_envio_id: string | null
          tiny_forma_frete_id: string | null
          tiny_service_code: string | null
        }
        Insert: {
          carrier: string
          delivery_days?: number | null
          error_message?: string | null
          expedition_order_id: string
          id?: string
          is_selected?: boolean | null
          price: number
          quoted_at?: string
          service: string
          tiny_forma_envio_id?: string | null
          tiny_forma_frete_id?: string | null
          tiny_service_code?: string | null
        }
        Update: {
          carrier?: string
          delivery_days?: number | null
          error_message?: string | null
          expedition_order_id?: string
          id?: string
          is_selected?: boolean | null
          price?: number
          quoted_at?: string
          service?: string
          tiny_forma_envio_id?: string | null
          tiny_forma_frete_id?: string | null
          tiny_service_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expedition_freight_quotes_expedition_order_id_fkey"
            columns: ["expedition_order_id"]
            isOneToOne: false
            referencedRelation: "expedition_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_groups: {
        Row: {
          created_at: string
          customer_email: string | null
          customer_name: string | null
          id: string
          order_count: number | null
          status: string
          total_items: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          order_count?: number | null
          status?: string
          total_items?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          order_count?: number | null
          status?: string
          total_items?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      expedition_order_items: {
        Row: {
          barcode: string | null
          created_at: string
          expedition_order_id: string
          id: string
          pack_verified: boolean | null
          packed_quantity: number | null
          pick_verified: boolean | null
          picked_quantity: number | null
          product_name: string
          quantity: number
          shopify_line_item_id: string | null
          sku: string | null
          unit_price: number | null
          variant_name: string | null
          weight_grams: number | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          expedition_order_id: string
          id?: string
          pack_verified?: boolean | null
          packed_quantity?: number | null
          pick_verified?: boolean | null
          picked_quantity?: number | null
          product_name: string
          quantity?: number
          shopify_line_item_id?: string | null
          sku?: string | null
          unit_price?: number | null
          variant_name?: string | null
          weight_grams?: number | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          expedition_order_id?: string
          id?: string
          pack_verified?: boolean | null
          packed_quantity?: number | null
          pick_verified?: boolean | null
          picked_quantity?: number | null
          product_name?: string
          quantity?: number
          shopify_line_item_id?: string | null
          sku?: string | null
          unit_price?: number | null
          variant_name?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expedition_order_items_expedition_order_id_fkey"
            columns: ["expedition_order_id"]
            isOneToOne: false
            referencedRelation: "expedition_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_orders: {
        Row: {
          created_at: string
          customer_cpf: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          dispatch_verified: boolean | null
          dispatch_verified_at: string | null
          expedition_status: string
          financial_status: string
          freight_carrier: string | null
          freight_delivery_days: number | null
          freight_label_url: string | null
          freight_price: number | null
          freight_service: string | null
          freight_tracking_code: string | null
          fulfillment_status: string | null
          group_id: string | null
          has_gift: boolean
          id: string
          internal_barcode: string | null
          invoice_key: string | null
          invoice_number: string | null
          invoice_pdf_url: string | null
          invoice_series: string | null
          invoice_xml_url: string | null
          is_from_live: boolean
          notes: string | null
          picking_list_id: string | null
          shipping_address: Json | null
          shopify_created_at: string | null
          shopify_order_id: string
          shopify_order_name: string | null
          shopify_order_number: string | null
          source_event_date: string | null
          source_event_name: string | null
          subtotal_price: number | null
          tiny_forma_envio_id: string | null
          tiny_forma_frete_id: string | null
          tiny_invoice_id: string | null
          tiny_order_id: string | null
          tiny_service_code: string | null
          total_discount: number | null
          total_price: number | null
          total_shipping: number | null
          total_weight_grams: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          dispatch_verified?: boolean | null
          dispatch_verified_at?: string | null
          expedition_status?: string
          financial_status?: string
          freight_carrier?: string | null
          freight_delivery_days?: number | null
          freight_label_url?: string | null
          freight_price?: number | null
          freight_service?: string | null
          freight_tracking_code?: string | null
          fulfillment_status?: string | null
          group_id?: string | null
          has_gift?: boolean
          id?: string
          internal_barcode?: string | null
          invoice_key?: string | null
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          invoice_series?: string | null
          invoice_xml_url?: string | null
          is_from_live?: boolean
          notes?: string | null
          picking_list_id?: string | null
          shipping_address?: Json | null
          shopify_created_at?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
          shopify_order_number?: string | null
          source_event_date?: string | null
          source_event_name?: string | null
          subtotal_price?: number | null
          tiny_forma_envio_id?: string | null
          tiny_forma_frete_id?: string | null
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
          tiny_service_code?: string | null
          total_discount?: number | null
          total_price?: number | null
          total_shipping?: number | null
          total_weight_grams?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          dispatch_verified?: boolean | null
          dispatch_verified_at?: string | null
          expedition_status?: string
          financial_status?: string
          freight_carrier?: string | null
          freight_delivery_days?: number | null
          freight_label_url?: string | null
          freight_price?: number | null
          freight_service?: string | null
          freight_tracking_code?: string | null
          fulfillment_status?: string | null
          group_id?: string | null
          has_gift?: boolean
          id?: string
          internal_barcode?: string | null
          invoice_key?: string | null
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          invoice_series?: string | null
          invoice_xml_url?: string | null
          is_from_live?: boolean
          notes?: string | null
          picking_list_id?: string | null
          shipping_address?: Json | null
          shopify_created_at?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          shopify_order_number?: string | null
          source_event_date?: string | null
          source_event_name?: string | null
          subtotal_price?: number | null
          tiny_forma_envio_id?: string | null
          tiny_forma_frete_id?: string | null
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
          tiny_service_code?: string | null
          total_discount?: number | null
          total_price?: number | null
          total_shipping?: number | null
          total_weight_grams?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedition_orders_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "expedition_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedition_orders_picking_list_id_fkey"
            columns: ["picking_list_id"]
            isOneToOne: false
            referencedRelation: "expedition_picking_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_picking_lists: {
        Row: {
          created_at: string
          id: string
          name: string
          picked_items: number | null
          status: string
          total_items: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          picked_items?: number | null
          status?: string
          total_items?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          picked_items?: number | null
          status?: string
          total_items?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      expedition_returns: {
        Row: {
          created_at: string
          customer_email: string | null
          customer_name: string | null
          exchange_order_id: string | null
          expedition_order_id: string | null
          id: string
          inspected_at: string | null
          inspection_notes: string | null
          items: Json | null
          notes: string | null
          reason: string | null
          received_at: string | null
          refund_amount: number | null
          return_type: string
          shopify_order_name: string | null
          status: string
          tracking_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          exchange_order_id?: string | null
          expedition_order_id?: string | null
          id?: string
          inspected_at?: string | null
          inspection_notes?: string | null
          items?: Json | null
          notes?: string | null
          reason?: string | null
          received_at?: string | null
          refund_amount?: number | null
          return_type?: string
          shopify_order_name?: string | null
          status?: string
          tracking_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          exchange_order_id?: string | null
          expedition_order_id?: string | null
          id?: string
          inspected_at?: string | null
          inspection_notes?: string | null
          items?: Json | null
          notes?: string | null
          reason?: string | null
          received_at?: string | null
          refund_amount?: number | null
          return_type?: string
          shopify_order_name?: string | null
          status?: string
          tracking_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedition_returns_expedition_order_id_fkey"
            columns: ["expedition_order_id"]
            isOneToOne: false
            referencedRelation: "expedition_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_stock_requests: {
        Row: {
          courier_name: string | null
          courier_phone: string | null
          courier_requested: boolean | null
          created_at: string
          expedition_order_ids: string[] | null
          has_stock: boolean | null
          id: string
          notes: string | null
          order_names: string[] | null
          product_name: string
          quantity_needed: number
          requested_by: string | null
          responded_at: string | null
          responded_by: string | null
          response_notes: string | null
          sku: string
          status: string
          to_store_id: string
          to_store_name: string | null
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          courier_name?: string | null
          courier_phone?: string | null
          courier_requested?: boolean | null
          created_at?: string
          expedition_order_ids?: string[] | null
          has_stock?: boolean | null
          id?: string
          notes?: string | null
          order_names?: string[] | null
          product_name: string
          quantity_needed?: number
          requested_by?: string | null
          responded_at?: string | null
          responded_by?: string | null
          response_notes?: string | null
          sku: string
          status?: string
          to_store_id: string
          to_store_name?: string | null
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          courier_name?: string | null
          courier_phone?: string | null
          courier_requested?: boolean | null
          created_at?: string
          expedition_order_ids?: string[] | null
          has_stock?: boolean | null
          id?: string
          notes?: string | null
          order_names?: string[] | null
          product_name?: string
          quantity_needed?: number
          requested_by?: string | null
          responded_at?: string | null
          responded_by?: string | null
          response_notes?: string | null
          sku?: string
          status?: string
          to_store_id?: string
          to_store_name?: string | null
          updated_at?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expedition_stock_requests_to_store_id_fkey"
            columns: ["to_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      expedition_sync_log: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          orders_synced: number | null
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          orders_synced?: number | null
          started_at?: string
          status?: string
          sync_type?: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          orders_synced?: number | null
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: []
      }
      expedition_unscannable_items: {
        Row: {
          barcode: string | null
          created_at: string
          created_by: string | null
          expedition_order_id: string
          expedition_order_item_id: string
          id: string
          product_name: string
          reason: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_notes: string | null
          scanned_value: string | null
          sku: string | null
          variant_name: string | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          expedition_order_id: string
          expedition_order_item_id: string
          id?: string
          product_name: string
          reason?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_notes?: string | null
          scanned_value?: string | null
          sku?: string | null
          variant_name?: string | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          expedition_order_id?: string
          expedition_order_item_id?: string
          id?: string
          product_name?: string
          reason?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_notes?: string | null
          scanned_value?: string | null
          sku?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expedition_unscannable_items_expedition_order_id_fkey"
            columns: ["expedition_order_id"]
            isOneToOne: false
            referencedRelation: "expedition_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedition_unscannable_items_expedition_order_item_id_fkey"
            columns: ["expedition_order_item_id"]
            isOneToOne: false
            referencedRelation: "expedition_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_agent_audit: {
        Row: {
          action: string | null
          attachment_hash: string | null
          chat_id: number | null
          created_at: string
          direction: string
          id: string
          message: string | null
          metadata: Json
        }
        Insert: {
          action?: string | null
          attachment_hash?: string | null
          chat_id?: number | null
          created_at?: string
          direction: string
          id?: string
          message?: string | null
          metadata?: Json
        }
        Update: {
          action?: string | null
          attachment_hash?: string | null
          chat_id?: number | null
          created_at?: string
          direction?: string
          id?: string
          message?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      financial_agent_authorized_users: {
        Row: {
          active: boolean
          chat_id: number
          created_at: string
          display_name: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          chat_id: number
          created_at?: string
          display_name?: string | null
          role?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          chat_id?: number
          created_at?: string
          display_name?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: []
      }
      financial_agent_invite_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          token: string
          used_at: string | null
          used_by_chat_id: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          token: string
          used_at?: string | null
          used_by_chat_id?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          token?: string
          used_at?: string | null
          used_by_chat_id?: number | null
        }
        Relationships: []
      }
      financial_agent_receipts: {
        Row: {
          ai_model: string | null
          ai_raw: string | null
          cash_flow_entry_id: string | null
          chat_id: string
          created_at: string
          duplicate_of: string | null
          error: string | null
          extracted: Json
          id: string
          mime_type: string | null
          status: string
          storage_path: string | null
          telegram_file_id: string | null
          telegram_message_id: number | null
          updated_at: string
        }
        Insert: {
          ai_model?: string | null
          ai_raw?: string | null
          cash_flow_entry_id?: string | null
          chat_id: string
          created_at?: string
          duplicate_of?: string | null
          error?: string | null
          extracted?: Json
          id?: string
          mime_type?: string | null
          status?: string
          storage_path?: string | null
          telegram_file_id?: string | null
          telegram_message_id?: number | null
          updated_at?: string
        }
        Update: {
          ai_model?: string | null
          ai_raw?: string | null
          cash_flow_entry_id?: string | null
          chat_id?: string
          created_at?: string
          duplicate_of?: string | null
          error?: string | null
          extracted?: Json
          id?: string
          mime_type?: string | null
          status?: string
          storage_path?: string | null
          telegram_file_id?: string | null
          telegram_message_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_agent_receipts_cash_flow_entry_id_fkey"
            columns: ["cash_flow_entry_id"]
            isOneToOne: false
            referencedRelation: "cash_flow_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_agent_receipts_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "cash_flow_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_agent_sessions: {
        Row: {
          chat_id: number
          expected_action: string | null
          expires_at: string
          pending_attachment: Json | null
          state: Json
          updated_at: string
        }
        Insert: {
          chat_id: number
          expected_action?: string | null
          expires_at?: string
          pending_attachment?: Json | null
          state?: Json
          updated_at?: string
        }
        Update: {
          chat_id?: number
          expected_action?: string | null
          expires_at?: string
          pending_attachment?: Json | null
          state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      financial_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          is_custom: boolean | null
          name: string
          parent_id: string | null
          tiny_category_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_custom?: boolean | null
          name: string
          parent_id?: string | null
          tiny_category_id?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_custom?: boolean | null
          name?: string
          parent_id?: string | null
          tiny_category_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          ambiente: string
          brasilnfe_request: Json | null
          brasilnfe_response: Json | null
          cancellation_protocol: string | null
          cancellation_reason: string | null
          cancellation_xml: string | null
          cancelled_at: string | null
          chave_acesso: string | null
          company_id: string
          contingencia_motivo: string | null
          cpf_destinatario: string | null
          created_at: string
          danfe_url: string | null
          data_autorizacao: string | null
          events: Json | null
          finalidade: number
          id: string
          last_retry_at: string | null
          modelo: number
          next_retry_at: string | null
          nome_destinatario: string | null
          numero: number | null
          order_id: string | null
          pos_sale_id: string | null
          protocolo: string | null
          qrcode_url: string | null
          ref_chave_acesso: string | null
          rejection_code: string | null
          rejection_message: string | null
          retry_count: number
          serie: number
          status: string
          tipo_operacao: string
          troca_devolucao_id: string | null
          updated_at: string
          valor_total: number | null
          xml_content: string | null
          xml_url: string | null
        }
        Insert: {
          ambiente: string
          brasilnfe_request?: Json | null
          brasilnfe_response?: Json | null
          cancellation_protocol?: string | null
          cancellation_reason?: string | null
          cancellation_xml?: string | null
          cancelled_at?: string | null
          chave_acesso?: string | null
          company_id: string
          contingencia_motivo?: string | null
          cpf_destinatario?: string | null
          created_at?: string
          danfe_url?: string | null
          data_autorizacao?: string | null
          events?: Json | null
          finalidade?: number
          id?: string
          last_retry_at?: string | null
          modelo: number
          next_retry_at?: string | null
          nome_destinatario?: string | null
          numero?: number | null
          order_id?: string | null
          pos_sale_id?: string | null
          protocolo?: string | null
          qrcode_url?: string | null
          ref_chave_acesso?: string | null
          rejection_code?: string | null
          rejection_message?: string | null
          retry_count?: number
          serie: number
          status?: string
          tipo_operacao?: string
          troca_devolucao_id?: string | null
          updated_at?: string
          valor_total?: number | null
          xml_content?: string | null
          xml_url?: string | null
        }
        Update: {
          ambiente?: string
          brasilnfe_request?: Json | null
          brasilnfe_response?: Json | null
          cancellation_protocol?: string | null
          cancellation_reason?: string | null
          cancellation_xml?: string | null
          cancelled_at?: string | null
          chave_acesso?: string | null
          company_id?: string
          contingencia_motivo?: string | null
          cpf_destinatario?: string | null
          created_at?: string
          danfe_url?: string | null
          data_autorizacao?: string | null
          events?: Json | null
          finalidade?: number
          id?: string
          last_retry_at?: string | null
          modelo?: number
          next_retry_at?: string | null
          nome_destinatario?: string | null
          numero?: number | null
          order_id?: string | null
          pos_sale_id?: string | null
          protocolo?: string | null
          qrcode_url?: string | null
          ref_chave_acesso?: string | null
          rejection_code?: string | null
          rejection_message?: string | null
          retry_count?: number
          serie?: number
          status?: string
          tipo_operacao?: string
          troca_devolucao_id?: string | null
          updated_at?: string
          valor_total?: number | null
          xml_content?: string | null
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_troca_devolucao_id_fkey"
            columns: ["troca_devolucao_id"]
            isOneToOne: false
            referencedRelation: "trocas_devolucoes"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_inutilizations: {
        Row: {
          ambiente: string
          ano: number
          brasilnfe_request: Json | null
          brasilnfe_response: Json | null
          company_id: string
          created_at: string
          id: string
          justificativa: string
          modelo: number
          numero_final: number
          numero_inicial: number
          protocolo: string | null
          rejection_message: string | null
          serie: number
          status: string
          updated_at: string
          xml_content: string | null
        }
        Insert: {
          ambiente: string
          ano: number
          brasilnfe_request?: Json | null
          brasilnfe_response?: Json | null
          company_id: string
          created_at?: string
          id?: string
          justificativa: string
          modelo: number
          numero_final: number
          numero_inicial: number
          protocolo?: string | null
          rejection_message?: string | null
          serie: number
          status?: string
          updated_at?: string
          xml_content?: string | null
        }
        Update: {
          ambiente?: string
          ano?: number
          brasilnfe_request?: Json | null
          brasilnfe_response?: Json | null
          company_id?: string
          created_at?: string
          id?: string
          justificativa?: string
          modelo?: number
          numero_final?: number
          numero_inicial?: number
          protocolo?: string | null
          rejection_message?: string | null
          serie?: number
          status?: string
          updated_at?: string
          xml_content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_inutilizations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_operations: {
        Row: {
          aliq_cofins: number | null
          aliq_icms: number | null
          aliq_pis: number | null
          cfop: string
          created_at: string
          csosn_icms: string | null
          cst_cofins: string
          cst_icms: string | null
          cst_pis: string
          description: string | null
          id: string
          is_active: boolean
          ncm: string | null
          origem_mercadoria: number
          priority: number
          tipo_operacao: string
          uf_destino: string | null
          uf_origem: string
          updated_at: string
        }
        Insert: {
          aliq_cofins?: number | null
          aliq_icms?: number | null
          aliq_pis?: number | null
          cfop: string
          created_at?: string
          csosn_icms?: string | null
          cst_cofins?: string
          cst_icms?: string | null
          cst_pis?: string
          description?: string | null
          id?: string
          is_active?: boolean
          ncm?: string | null
          origem_mercadoria?: number
          priority?: number
          tipo_operacao?: string
          uf_destino?: string | null
          uf_origem: string
          updated_at?: string
        }
        Update: {
          aliq_cofins?: number | null
          aliq_icms?: number | null
          aliq_pis?: number | null
          cfop?: string
          created_at?: string
          csosn_icms?: string | null
          cst_cofins?: string
          cst_icms?: string | null
          cst_pis?: string
          description?: string | null
          id?: string
          is_active?: boolean
          ncm?: string | null
          origem_mercadoria?: number
          priority?: number
          tipo_operacao?: string
          uf_destino?: string | null
          uf_origem?: string
          updated_at?: string
        }
        Relationships: []
      }
      fiscal_sequences: {
        Row: {
          ambiente: string
          company_id: string
          created_at: string
          id: string
          last_number: number
          modelo: number
          notes: string | null
          serie: number
          updated_at: string
        }
        Insert: {
          ambiente?: string
          company_id: string
          created_at?: string
          id?: string
          last_number?: number
          modelo: number
          notes?: string | null
          serie?: number
          updated_at?: string
        }
        Update: {
          ambiente?: string
          company_id?: string
          created_at?: string
          id?: string
          last_number?: number
          modelo?: number
          notes?: string | null
          serie?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_sequences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_webhook_events: {
        Row: {
          chave_acesso: string | null
          error_message: string | null
          event_type: string | null
          fiscal_document_id: string | null
          id: string
          identificador_interno: string | null
          payload: Json
          processed: boolean
          processed_at: string | null
          provider: string
          received_at: string
        }
        Insert: {
          chave_acesso?: string | null
          error_message?: string | null
          event_type?: string | null
          fiscal_document_id?: string | null
          id?: string
          identificador_interno?: string | null
          payload: Json
          processed?: boolean
          processed_at?: string | null
          provider?: string
          received_at?: string
        }
        Update: {
          chave_acesso?: string | null
          error_message?: string | null
          event_type?: string | null
          fiscal_document_id?: string | null
          id?: string
          identificador_interno?: string | null
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          provider?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_webhook_events_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      group_campaign_block_dispatches: {
        Row: {
          attempts: number
          block_order: number
          block_type: string | null
          campaign_id: string | null
          created_at: string
          delay_after_ms: number
          error_message: string | null
          group_db_id: string
          group_name: string | null
          group_zapi_id: string
          id: string
          locked_until: string | null
          message_group_id: string | null
          scheduled_message_id: string
          send_after: string | null
          sent_at: string | null
          seq: number | null
          status: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          attempts?: number
          block_order?: number
          block_type?: string | null
          campaign_id?: string | null
          created_at?: string
          delay_after_ms?: number
          error_message?: string | null
          group_db_id: string
          group_name?: string | null
          group_zapi_id: string
          id?: string
          locked_until?: string | null
          message_group_id?: string | null
          scheduled_message_id: string
          send_after?: string | null
          sent_at?: string | null
          seq?: number | null
          status?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          attempts?: number
          block_order?: number
          block_type?: string | null
          campaign_id?: string | null
          created_at?: string
          delay_after_ms?: number
          error_message?: string | null
          group_db_id?: string
          group_name?: string | null
          group_zapi_id?: string
          id?: string
          locked_until?: string | null
          message_group_id?: string | null
          scheduled_message_id?: string
          send_after?: string | null
          sent_at?: string | null
          seq?: number | null
          status?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      group_campaign_messages: {
        Row: {
          campaign_id: string
          created_at: string
          error_message: string | null
          group_id: string
          id: string
          message_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_message?: string | null
          group_id: string
          id?: string
          message_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_message?: string | null
          group_id?: string
          id?: string
          message_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_campaign_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "group_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_campaign_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vip_group_membership_stats"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "group_campaign_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_campaign_scheduled_messages: {
        Row: {
          block_order: number | null
          campaign_id: string
          created_at: string
          execution_count: number
          failed_count: number
          id: string
          last_execution_at: string | null
          locked_until: string | null
          media_url: string | null
          mention_all: boolean
          message_content: string | null
          message_group_id: string | null
          message_type: string
          poll_max_options: number | null
          poll_options: Json | null
          scheduled_at: string
          send_speed: string
          sent_at: string | null
          sent_count: number
          sent_group_ids: string[] | null
          status: string
          whatsapp_number_id: string | null
        }
        Insert: {
          block_order?: number | null
          campaign_id: string
          created_at?: string
          execution_count?: number
          failed_count?: number
          id?: string
          last_execution_at?: string | null
          locked_until?: string | null
          media_url?: string | null
          mention_all?: boolean
          message_content?: string | null
          message_group_id?: string | null
          message_type?: string
          poll_max_options?: number | null
          poll_options?: Json | null
          scheduled_at: string
          send_speed?: string
          sent_at?: string | null
          sent_count?: number
          sent_group_ids?: string[] | null
          status?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          block_order?: number | null
          campaign_id?: string
          created_at?: string
          execution_count?: number
          failed_count?: number
          id?: string
          last_execution_at?: string | null
          locked_until?: string | null
          media_url?: string | null
          mention_all?: boolean
          message_content?: string | null
          message_group_id?: string | null
          message_type?: string
          poll_max_options?: number | null
          poll_options?: Json | null
          scheduled_at?: string
          send_speed?: string
          sent_at?: string | null
          sent_count?: number
          sent_group_ids?: string[] | null
          status?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_campaign_scheduled_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "group_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_campaign_scheduled_messages_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_campaign_scheduled_messages_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      group_campaigns: {
        Row: {
          ai_generated_content: string | null
          ai_prompt: string | null
          campaign_link_slug: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_log: Json | null
          failed_count: number | null
          group_admin_phones: string[] | null
          group_description: string | null
          group_name_template: string | null
          group_only_admins_add: boolean
          group_only_admins_send: boolean
          group_photo_url: string | null
          group_pin_duration: string | null
          group_pin_message_text: string | null
          id: string
          is_deep_link: boolean
          media_url: string | null
          message_content: string | null
          message_type: string
          name: string
          poll_options: Json | null
          scheduled_at: string | null
          send_speed: string
          sent_count: number | null
          started_at: string | null
          status: string
          strategy_content: string | null
          strategy_prompt: string | null
          target_groups: string[] | null
          total_groups: number | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          ai_generated_content?: string | null
          ai_prompt?: string | null
          campaign_link_slug?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_log?: Json | null
          failed_count?: number | null
          group_admin_phones?: string[] | null
          group_description?: string | null
          group_name_template?: string | null
          group_only_admins_add?: boolean
          group_only_admins_send?: boolean
          group_photo_url?: string | null
          group_pin_duration?: string | null
          group_pin_message_text?: string | null
          id?: string
          is_deep_link?: boolean
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name: string
          poll_options?: Json | null
          scheduled_at?: string | null
          send_speed?: string
          sent_count?: number | null
          started_at?: string | null
          status?: string
          strategy_content?: string | null
          strategy_prompt?: string | null
          target_groups?: string[] | null
          total_groups?: number | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          ai_generated_content?: string | null
          ai_prompt?: string | null
          campaign_link_slug?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_log?: Json | null
          failed_count?: number | null
          group_admin_phones?: string[] | null
          group_description?: string | null
          group_name_template?: string | null
          group_only_admins_add?: boolean
          group_only_admins_send?: boolean
          group_photo_url?: string | null
          group_pin_duration?: string | null
          group_pin_message_text?: string | null
          id?: string
          is_deep_link?: boolean
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name?: string
          poll_options?: Json | null
          scheduled_at?: string | null
          send_speed?: string
          sent_count?: number | null
          started_at?: string | null
          status?: string
          strategy_content?: string | null
          strategy_prompt?: string | null
          target_groups?: string[] | null
          total_groups?: number | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_campaigns_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_campaigns_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      group_message_exposures: {
        Row: {
          created_at: string
          group_campaign_id: string | null
          group_campaign_message_id: string | null
          group_jid: string
          group_name: string | null
          id: string
          member_jid: string | null
          phone_e164: string | null
          phone_suffix8: string | null
          snapshotted_at: string
          source: string
          unified_id: string | null
        }
        Insert: {
          created_at?: string
          group_campaign_id?: string | null
          group_campaign_message_id?: string | null
          group_jid: string
          group_name?: string | null
          id?: string
          member_jid?: string | null
          phone_e164?: string | null
          phone_suffix8?: string | null
          snapshotted_at?: string
          source?: string
          unified_id?: string | null
        }
        Update: {
          created_at?: string
          group_campaign_id?: string | null
          group_campaign_message_id?: string | null
          group_jid?: string
          group_name?: string | null
          id?: string
          member_jid?: string | null
          phone_e164?: string | null
          phone_suffix8?: string | null
          snapshotted_at?: string
          source?: string
          unified_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_message_exposures_group_campaign_id_fkey"
            columns: ["group_campaign_id"]
            isOneToOne: false
            referencedRelation: "group_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_message_exposures_group_campaign_message_id_fkey"
            columns: ["group_campaign_message_id"]
            isOneToOne: false
            referencedRelation: "group_campaign_scheduled_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_message_exposures_unified_id_fkey"
            columns: ["unified_id"]
            isOneToOne: false
            referencedRelation: "crm_customers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_message_exposures_unified_id_fkey"
            columns: ["unified_id"]
            isOneToOne: false
            referencedRelation: "customers_unified"
            referencedColumns: ["id"]
          },
        ]
      }
      group_message_templates: {
        Row: {
          created_at: string
          id: string
          media_url: string | null
          message_content: string | null
          message_type: string
          name: string
          poll_options: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name: string
          poll_options?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name?: string
          poll_options?: Json | null
        }
        Relationships: []
      }
      group_redirect_links: {
        Row: {
          cached_at: string | null
          cached_invite_url: string | null
          campaign_id: string
          click_count: number
          created_at: string
          forced_group_id: string | null
          forced_strict: boolean
          id: string
          is_active: boolean
          is_deep_link: boolean
          label: string | null
          redirect_count: number
          slug: string
        }
        Insert: {
          cached_at?: string | null
          cached_invite_url?: string | null
          campaign_id: string
          click_count?: number
          created_at?: string
          forced_group_id?: string | null
          forced_strict?: boolean
          id?: string
          is_active?: boolean
          is_deep_link?: boolean
          label?: string | null
          redirect_count?: number
          slug: string
        }
        Update: {
          cached_at?: string | null
          cached_invite_url?: string | null
          campaign_id?: string
          click_count?: number
          created_at?: string
          forced_group_id?: string | null
          forced_strict?: boolean
          id?: string
          is_active?: boolean
          is_deep_link?: boolean
          label?: string | null
          redirect_count?: number
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_redirect_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "group_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_blacklist: {
        Row: {
          created_at: string
          distinct_cpfs: number | null
          distinct_names: number | null
          distinct_phones: number | null
          id: string
          kind: string
          reason: string
          value: string
        }
        Insert: {
          created_at?: string
          distinct_cpfs?: number | null
          distinct_names?: number | null
          distinct_phones?: number | null
          id?: string
          kind: string
          reason: string
          value: string
        }
        Update: {
          created_at?: string
          distinct_cpfs?: number | null
          distinct_names?: number | null
          distinct_phones?: number | null
          id?: string
          kind?: string
          reason?: string
          value?: string
        }
        Relationships: []
      }
      instagram_comment_actions: {
        Row: {
          action_type: string
          comment_id: string
          created_at: string
          error_message: string | null
          id: string
          rule_id: string | null
          status: string | null
        }
        Insert: {
          action_type: string
          comment_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          rule_id?: string | null
          status?: string | null
        }
        Update: {
          action_type?: string
          comment_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          rule_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_comment_actions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "instagram_comment_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_comment_rules: {
        Row: {
          action_capture_lead: boolean
          action_reply_comment: boolean | null
          action_send_dm: boolean | null
          action_trigger_automation: boolean | null
          ai_generate_reply: boolean | null
          ai_prompt: string | null
          automation_flow_id: string | null
          capture_event_id: string | null
          capture_fallback_dm_text: string | null
          capture_mode: string
          cooldown_minutes: number | null
          created_at: string
          dm_buttons: Json
          dm_message_text: string | null
          id: string
          is_active: boolean
          media_types: string[] | null
          name: string
          reply_comment_text: string | null
          reply_comment_variations: string[]
          target_media_caption: string | null
          target_media_id: string | null
          trigger_keywords: string[] | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          action_capture_lead?: boolean
          action_reply_comment?: boolean | null
          action_send_dm?: boolean | null
          action_trigger_automation?: boolean | null
          ai_generate_reply?: boolean | null
          ai_prompt?: string | null
          automation_flow_id?: string | null
          capture_event_id?: string | null
          capture_fallback_dm_text?: string | null
          capture_mode?: string
          cooldown_minutes?: number | null
          created_at?: string
          dm_buttons?: Json
          dm_message_text?: string | null
          id?: string
          is_active?: boolean
          media_types?: string[] | null
          name: string
          reply_comment_text?: string | null
          reply_comment_variations?: string[]
          target_media_caption?: string | null
          target_media_id?: string | null
          trigger_keywords?: string[] | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          action_capture_lead?: boolean
          action_reply_comment?: boolean | null
          action_send_dm?: boolean | null
          action_trigger_automation?: boolean | null
          ai_generate_reply?: boolean | null
          ai_prompt?: string | null
          automation_flow_id?: string | null
          capture_event_id?: string | null
          capture_fallback_dm_text?: string | null
          capture_mode?: string
          cooldown_minutes?: number | null
          created_at?: string
          dm_buttons?: Json
          dm_message_text?: string | null
          id?: string
          is_active?: boolean
          media_types?: string[] | null
          name?: string
          reply_comment_text?: string | null
          reply_comment_variations?: string[]
          target_media_caption?: string | null
          target_media_id?: string | null
          trigger_keywords?: string[] | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_comment_rules_automation_flow_id_fkey"
            columns: ["automation_flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_comment_rules_capture_event_id_fkey"
            columns: ["capture_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_dm_reads: {
        Row: {
          id: string
          last_read_at: string
          user_id: string
          username: string
        }
        Insert: {
          id?: string
          last_read_at?: string
          user_id: string
          username: string
        }
        Update: {
          id?: string
          last_read_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      instagram_user_links: {
        Row: {
          created_at: string
          id: string
          ig_user_id: string
          last_seen_at: string
          source: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          ig_user_id: string
          last_seen_at?: string
          source?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          ig_user_id?: string
          last_seen_at?: string
          source?: string
          username?: string
        }
        Relationships: []
      }
      internal_cashback: {
        Row: {
          cashback_amount: number
          coupon_code: string
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string
          expires_at: string
          id: string
          is_used: boolean
          min_purchase: number
          origin_type: string
          updated_at: string
          used_at: string | null
          used_channel: string | null
          used_external_ref: string | null
          used_sale_id: string | null
        }
        Insert: {
          cashback_amount: number
          coupon_code: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone: string
          expires_at: string
          id?: string
          is_used?: boolean
          min_purchase: number
          origin_type?: string
          updated_at?: string
          used_at?: string | null
          used_channel?: string | null
          used_external_ref?: string | null
          used_sale_id?: string | null
        }
        Update: {
          cashback_amount?: number
          coupon_code?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string
          expires_at?: string
          id?: string
          is_used?: boolean
          min_purchase?: number
          origin_type?: string
          updated_at?: string
          used_at?: string | null
          used_channel?: string | null
          used_external_ref?: string | null
          used_sale_id?: string | null
        }
        Relationships: []
      }
      internal_function_secrets: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      inventory_audit_runs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          per_store: Json | null
          started_at: string
          status: string
          totals: Json | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          per_store?: Json | null
          started_at?: string
          status?: string
          totals?: Json | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          per_store?: Json | null
          started_at?: string
          status?: string
          totals?: Json | null
        }
        Relationships: []
      }
      inventory_barcode_aliases: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          original_barcode: string
          product_name: string
          product_sku: string | null
          product_tiny_id: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          original_barcode: string
          product_name: string
          product_sku?: string | null
          product_tiny_id: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          original_barcode?: string
          product_name?: string
          product_sku?: string | null
          product_tiny_id?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_barcode_aliases_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_correction_queue: {
        Row: {
          attempts: number | null
          count_id: string
          count_item_id: string
          created_at: string
          error_message: string | null
          id: string
          max_attempts: number | null
          new_quantity: number
          old_quantity: number | null
          processed_at: string | null
          product_id: string
          product_name: string
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number | null
          count_id: string
          count_item_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          max_attempts?: number | null
          new_quantity: number
          old_quantity?: number | null
          processed_at?: string | null
          product_id: string
          product_name: string
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number | null
          count_id?: string
          count_item_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          max_attempts?: number | null
          new_quantity?: number
          old_quantity?: number | null
          processed_at?: string | null
          product_id?: string
          product_name?: string
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_correction_queue_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_correction_queue_count_item_id_fkey"
            columns: ["count_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_correction_queue_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_items: {
        Row: {
          barcode: string | null
          corrected_at: string | null
          correction_error: string | null
          correction_status: string | null
          count_id: string
          counted_quantity: number
          created_at: string
          current_stock: number | null
          divergence: number | null
          id: string
          last_corrected_quantity: number | null
          product_id: string
          product_name: string
          sku: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          corrected_at?: string | null
          correction_error?: string | null
          correction_status?: string | null
          count_id: string
          counted_quantity?: number
          created_at?: string
          current_stock?: number | null
          divergence?: number | null
          id?: string
          last_corrected_quantity?: number | null
          product_id: string
          product_name: string
          sku?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          corrected_at?: string | null
          correction_error?: string | null
          correction_status?: string | null
          count_id?: string
          counted_quantity?: number
          created_at?: string
          current_stock?: number | null
          divergence?: number | null
          id?: string
          last_corrected_quantity?: number | null
          product_id?: string
          product_name?: string
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_items_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          categories: string[] | null
          completed_at: string | null
          corrected_products: number | null
          correction_errors: number | null
          counted_products: number | null
          created_at: string
          divergent_products: number | null
          id: string
          last_batch_at: string | null
          scope: string
          started_at: string
          status: string
          store_id: string
          total_products: number | null
          updated_at: string
        }
        Insert: {
          categories?: string[] | null
          completed_at?: string | null
          corrected_products?: number | null
          correction_errors?: number | null
          counted_products?: number | null
          created_at?: string
          divergent_products?: number | null
          id?: string
          last_batch_at?: string | null
          scope?: string
          started_at?: string
          status?: string
          store_id: string
          total_products?: number | null
          updated_at?: string
        }
        Update: {
          categories?: string[] | null
          completed_at?: string | null
          corrected_products?: number | null
          correction_errors?: number | null
          counted_products?: number | null
          created_at?: string
          divergent_products?: number | null
          id?: string
          last_batch_at?: string | null
          scope?: string
          started_at?: string
          status?: string
          store_id?: string
          total_products?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_health_cache: {
        Row: {
          computed_at: string
          created_at: string
          horizon_days: number
          id: string
          payload: Json
          store_id: string | null
        }
        Insert: {
          computed_at?: string
          created_at?: string
          horizon_days: number
          id?: string
          payload: Json
          store_id?: string | null
        }
        Update: {
          computed_at?: string
          created_at?: string
          horizon_days?: number
          id?: string
          payload?: Json
          store_id?: string | null
        }
        Relationships: []
      }
      inventory_incremental_runs: {
        Row: {
          created_at: string
          days_window: number
          error_message: string | null
          finished_at: string | null
          id: string
          per_store: Json
          progress: Json
          since_date: string | null
          status: string
          totals: Json
        }
        Insert: {
          created_at?: string
          days_window?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          per_store?: Json
          progress?: Json
          since_date?: string | null
          status?: string
          totals?: Json
        }
        Update: {
          created_at?: string
          days_window?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          per_store?: Json
          progress?: Json
          since_date?: string | null
          status?: string
          totals?: Json
        }
        Relationships: []
      }
      inventory_sale_unmatched_items: {
        Row: {
          created_at: string
          external_source: string | null
          id: string
          item_code: string
          product_name: string
          quantity: number
          resolved_at: string | null
          resolved_product_id: string | null
          sale_id: string
          status: string
          store_id: string | null
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          created_at?: string
          external_source?: string | null
          id?: string
          item_code?: string
          product_name?: string
          quantity?: number
          resolved_at?: string | null
          resolved_product_id?: string | null
          sale_id: string
          status?: string
          store_id?: string | null
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          created_at?: string
          external_source?: string | null
          id?: string
          item_code?: string
          product_name?: string
          quantity?: number
          resolved_at?: string | null
          resolved_product_id?: string | null
          sale_id?: string
          status?: string
          store_id?: string | null
          updated_at?: string
          variant_name?: string | null
        }
        Relationships: []
      }
      inventory_unresolved_barcodes: {
        Row: {
          barcode: string
          count_id: string
          created_at: string
          id: string
          notes: string | null
          photo_url: string | null
          resolved_at: string | null
          resolved_product_name: string | null
          resolved_product_tiny_id: number | null
          scanned_quantity: number
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          barcode: string
          count_id: string
          created_at?: string
          id?: string
          notes?: string | null
          photo_url?: string | null
          resolved_at?: string | null
          resolved_product_name?: string | null
          resolved_product_tiny_id?: number | null
          scanned_quantity?: number
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          barcode?: string
          count_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          photo_url?: string | null
          resolved_at?: string | null
          resolved_product_name?: string | null
          resolved_product_tiny_id?: number | null
          scanned_quantity?: number
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_unresolved_barcodes_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_unresolved_barcodes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      link_page_catalog_products: {
        Row: {
          compare_at_price: number | null
          created_at: string
          grade_available: number
          grade_pct: number
          grade_total: number
          handle: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_bestseller: boolean
          is_new_arrival: boolean
          last_synced_at: string
          page_id: string
          price: number | null
          product_type: string | null
          shopify_product_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          compare_at_price?: number | null
          created_at?: string
          grade_available?: number
          grade_pct?: number
          grade_total?: number
          handle?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bestseller?: boolean
          is_new_arrival?: boolean
          last_synced_at?: string
          page_id: string
          price?: number | null
          product_type?: string | null
          shopify_product_id: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          compare_at_price?: number | null
          created_at?: string
          grade_available?: number
          grade_pct?: number
          grade_total?: number
          handle?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bestseller?: boolean
          is_new_arrival?: boolean
          last_synced_at?: string
          page_id?: string
          price?: number | null
          product_type?: string | null
          shopify_product_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_page_catalog_products_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "link_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      link_page_items: {
        Row: {
          card_style: string
          clicks: number
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          item_type: string
          label: string
          page_id: string
          prefill_message: string | null
          social_network: string | null
          sort_order: number
          style_config: Json
          thumbnail_url: string | null
          updated_at: string
          url: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          card_style?: string
          clicks?: number
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          item_type?: string
          label: string
          page_id: string
          prefill_message?: string | null
          social_network?: string | null
          sort_order?: number
          style_config?: Json
          thumbnail_url?: string | null
          updated_at?: string
          url?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          card_style?: string
          clicks?: number
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          item_type?: string
          label?: string
          page_id?: string
          prefill_message?: string | null
          social_network?: string | null
          sort_order?: number
          style_config?: Json
          thumbnail_url?: string | null
          updated_at?: string
          url?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "link_page_items_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "link_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_page_items_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_page_items_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      link_page_leads: {
        Row: {
          ad_lead_id: string | null
          created_at: string
          customer_id: string | null
          id: string
          is_existing_customer: boolean
          name: string
          page_id: string
          phone: string
          seller_id: string | null
        }
        Insert: {
          ad_lead_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          is_existing_customer?: boolean
          name: string
          page_id: string
          phone: string
          seller_id?: string | null
        }
        Update: {
          ad_lead_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          is_existing_customer?: boolean
          name?: string
          page_id?: string
          phone?: string
          seller_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "link_page_leads_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "link_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_page_leads_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      link_page_visits: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_hash: string | null
          item_id: string | null
          lead_id: string | null
          lead_phone: string | null
          page_id: string
          referrer: string | null
          seller_id: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
          item_id?: string | null
          lead_id?: string | null
          lead_phone?: string | null
          page_id: string
          referrer?: string | null
          seller_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
          item_id?: string | null
          lead_id?: string | null
          lead_phone?: string | null
          page_id?: string
          referrer?: string | null
          seller_id?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "link_page_visits_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "link_page_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_page_visits_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "link_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      link_pages: {
        Row: {
          avatar_url: string | null
          background_type: string
          background_value: string
          catalog_auto_sync: boolean
          catalog_mode: string
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          meta_pixel_id: string | null
          require_lead_capture: boolean
          seller_id: string | null
          slug: string
          store_id: string | null
          subtitle: string | null
          theme_config: Json
          title: string
          total_clicks: number
          total_views: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          background_type?: string
          background_value?: string
          catalog_auto_sync?: boolean
          catalog_mode?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          meta_pixel_id?: string | null
          require_lead_capture?: boolean
          seller_id?: string | null
          slug: string
          store_id?: string | null
          subtitle?: string | null
          theme_config?: Json
          title: string
          total_clicks?: number
          total_views?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          background_type?: string
          background_value?: string
          catalog_auto_sync?: boolean
          catalog_mode?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          meta_pixel_id?: string | null
          require_lead_capture?: boolean
          seller_id?: string | null
          slug?: string
          store_id?: string | null
          subtitle?: string | null
          theme_config?: Json
          title?: string
          total_clicks?: number
          total_views?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_pages_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_pages_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      live_campaign_dispatches: {
        Row: {
          attempts: number
          campaign_id: string
          channel: string
          created_at: string
          error_message: string | null
          id: string
          ig_comment_id: string | null
          ig_user_id: string | null
          lead_id: string | null
          locked_until: string | null
          message_id: string
          phone: string
          provider_at_send: string | null
          scheduled_at: string
          sent_at: string | null
          shadow_mode: boolean
          status: string
          template_category_at_send: string | null
          unit_cost_at_send: number | null
          whatsapp_number_id: string | null
        }
        Insert: {
          attempts?: number
          campaign_id: string
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          ig_comment_id?: string | null
          ig_user_id?: string | null
          lead_id?: string | null
          locked_until?: string | null
          message_id: string
          phone: string
          provider_at_send?: string | null
          scheduled_at?: string
          sent_at?: string | null
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          unit_cost_at_send?: number | null
          whatsapp_number_id?: string | null
        }
        Update: {
          attempts?: number
          campaign_id?: string
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          ig_comment_id?: string | null
          ig_user_id?: string | null
          lead_id?: string | null
          locked_until?: string | null
          message_id?: string
          phone?: string
          provider_at_send?: string | null
          scheduled_at?: string
          sent_at?: string | null
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          unit_cost_at_send?: number | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_campaign_dispatches_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "live_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_campaign_dispatches_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "live_campaign_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_campaign_dispatches_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_campaign_dispatches_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      live_campaign_messages: {
        Row: {
          campaign_id: string
          caption: string | null
          content: string | null
          created_at: string
          delay_seconds: number
          id: string
          is_active: boolean
          media_url: string | null
          message_type: string
          meta_template_language: string | null
          meta_template_name: string | null
          meta_template_variables: Json | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          caption?: string | null
          content?: string | null
          created_at?: string
          delay_seconds?: number
          id?: string
          is_active?: boolean
          media_url?: string | null
          message_type?: string
          meta_template_language?: string | null
          meta_template_name?: string | null
          meta_template_variables?: Json | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          caption?: string | null
          content?: string | null
          created_at?: string
          delay_seconds?: number
          id?: string
          is_active?: boolean
          media_url?: string | null
          message_type?: string
          meta_template_language?: string | null
          meta_template_name?: string | null
          meta_template_variables?: Json | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_campaign_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "live_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      live_campaigns: {
        Row: {
          ask_shoe_size: boolean
          channel_preference: string
          created_at: string
          default_delay_seconds: number
          id: string
          is_active: boolean
          jess_enabled: boolean
          jess_prompt: string | null
          name: string
          shadow_mode: boolean
          slug: string
          tipo_comunicacao: string
          total_leads: number
          trigger_phrase: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          ask_shoe_size?: boolean
          channel_preference?: string
          created_at?: string
          default_delay_seconds?: number
          id?: string
          is_active?: boolean
          jess_enabled?: boolean
          jess_prompt?: string | null
          name: string
          shadow_mode?: boolean
          slug: string
          tipo_comunicacao: string
          total_leads?: number
          trigger_phrase: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          ask_shoe_size?: boolean
          channel_preference?: string
          created_at?: string
          default_delay_seconds?: number
          id?: string
          is_active?: boolean
          jess_enabled?: boolean
          jess_prompt?: string | null
          name?: string
          shadow_mode?: boolean
          slug?: string
          tipo_comunicacao?: string
          total_leads?: number
          trigger_phrase?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      live_chat_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          message_type: string
          session_id: string
          viewer_name: string
          viewer_phone: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          message_type?: string
          session_id: string
          viewer_name: string
          viewer_phone: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          message_type?: string
          session_id?: string
          viewer_name?: string
          viewer_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_comment_dms: {
        Row: {
          comment_id: string
          created_at: string
          error_details: string | null
          event_id: string | null
          id: string
          message: string
          meta_message_id: string | null
          sent_by: string | null
          status: string
          username: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          error_details?: string | null
          event_id?: string | null
          id?: string
          message: string
          meta_message_id?: string | null
          sent_by?: string | null
          status?: string
          username: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          error_details?: string | null
          event_id?: string | null
          id?: string
          message?: string
          meta_message_id?: string | null
          sent_by?: string | null
          status?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_comment_dms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_comments: {
        Row: {
          ai_classification: string | null
          ai_confidence: number | null
          comment_id: string
          comment_text: string
          created_at: string
          event_id: string
          extracted_products: Json | null
          id: string
          is_order: boolean | null
          order_id: string | null
          profile_pic_url: string | null
          raw_timestamp: string | null
          source_pc: string | null
          username: string
        }
        Insert: {
          ai_classification?: string | null
          ai_confidence?: number | null
          comment_id: string
          comment_text: string
          created_at?: string
          event_id: string
          extracted_products?: Json | null
          id?: string
          is_order?: boolean | null
          order_id?: string | null
          profile_pic_url?: string | null
          raw_timestamp?: string | null
          source_pc?: string | null
          username: string
        }
        Update: {
          ai_classification?: string | null
          ai_confidence?: number | null
          comment_id?: string
          comment_text?: string
          created_at?: string
          event_id?: string
          extracted_products?: Json | null
          id?: string
          is_order?: boolean | null
          order_id?: string | null
          profile_pic_url?: string | null
          raw_timestamp?: string | null
          source_pc?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_comments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_comments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      live_phone_verifications: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          phone: string
          verified: boolean
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          phone: string
          verified?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          verified?: boolean
        }
        Relationships: []
      }
      live_redirect_clicks: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          phone: string | null
          redirect_id: string
          target_url: string | null
          user_agent: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          phone?: string | null
          redirect_id: string
          target_url?: string | null
          user_agent?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          phone?: string | null
          redirect_id?: string
          target_url?: string | null
          user_agent?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_redirect_clicks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_redirect_clicks_redirect_id_fkey"
            columns: ["redirect_id"]
            isOneToOne: false
            referencedRelation: "live_redirect_links"
            referencedColumns: ["id"]
          },
        ]
      }
      live_redirect_links: {
        Row: {
          click_count: number
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          click_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          click_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      live_sessions: {
        Row: {
          created_at: string
          freight_config: Json | null
          id: string
          is_active: boolean
          overlay_config: Json | null
          selected_products: Json
          spotlight_products: Json | null
          title: string
          updated_at: string
          whatsapp_link: string | null
          youtube_video_id: string | null
        }
        Insert: {
          created_at?: string
          freight_config?: Json | null
          id?: string
          is_active?: boolean
          overlay_config?: Json | null
          selected_products?: Json
          spotlight_products?: Json | null
          title: string
          updated_at?: string
          whatsapp_link?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          created_at?: string
          freight_config?: Json | null
          id?: string
          is_active?: boolean
          overlay_config?: Json | null
          selected_products?: Json
          spotlight_products?: Json | null
          title?: string
          updated_at?: string
          whatsapp_link?: string | null
          youtube_video_id?: string | null
        }
        Relationships: []
      }
      live_viewers: {
        Row: {
          ban_reason: string | null
          cart_items: Json | null
          cart_value: number | null
          checkout_completed: boolean | null
          checkout_completed_at: string | null
          checkout_url: string | null
          id: string
          is_banned: boolean
          is_online: boolean
          joined_at: string
          last_seen_at: string
          messages_count: number | null
          name: string
          payment_method: string | null
          payment_platform: string | null
          phone: string
          session_id: string
        }
        Insert: {
          ban_reason?: string | null
          cart_items?: Json | null
          cart_value?: number | null
          checkout_completed?: boolean | null
          checkout_completed_at?: string | null
          checkout_url?: string | null
          id?: string
          is_banned?: boolean
          is_online?: boolean
          joined_at?: string
          last_seen_at?: string
          messages_count?: number | null
          name: string
          payment_method?: string | null
          payment_platform?: string | null
          phone: string
          session_id: string
        }
        Update: {
          ban_reason?: string | null
          cart_items?: Json | null
          cart_value?: number | null
          checkout_completed?: boolean | null
          checkout_completed_at?: string | null
          checkout_url?: string | null
          id?: string
          is_banned?: boolean
          is_online?: boolean
          joined_at?: string
          last_seen_at?: string
          messages_count?: number | null
          name?: string
          payment_method?: string | null
          payment_platform?: string | null
          phone?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_viewers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      livete_presenter_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          customer_name: string | null
          event_id: string | null
          id: string
          is_read: boolean | null
          message: string
          order_id: string | null
          phone: string
          product_title: string | null
        }
        Insert: {
          alert_type?: string
          created_at?: string | null
          customer_name?: string | null
          event_id?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          order_id?: string | null
          phone: string
          product_title?: string | null
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          customer_name?: string | null
          event_id?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          order_id?: string | null
          phone?: string
          product_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "livete_presenter_alerts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "livete_presenter_alerts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      livete_processing_locks: {
        Row: {
          locked_at: string
          message_hash: string | null
          phone: string
        }
        Insert: {
          locked_at?: string
          message_hash?: string | null
          phone: string
        }
        Update: {
          locked_at?: string
          message_hash?: string | null
          phone?: string
        }
        Relationships: []
      }
      loyalty_config: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          points_expiry_days: number
          points_per_real: number
          store_id: string
          updated_at: string
          wheel_enabled: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          points_expiry_days?: number
          points_per_real?: number
          store_id: string
          updated_at?: string
          wheel_enabled?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          points_expiry_days?: number
          points_per_real?: number
          store_id?: string
          updated_at?: string
          wheel_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_config_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_points_log: {
        Row: {
          created_at: string
          customer_phone: string
          description: string | null
          id: string
          points: number
          prize_id: string | null
          sale_id: string | null
          store_id: string
          type: string
        }
        Insert: {
          created_at?: string
          customer_phone: string
          description?: string | null
          id?: string
          points: number
          prize_id?: string | null
          sale_id?: string | null
          store_id: string
          type?: string
        }
        Update: {
          created_at?: string
          customer_phone?: string
          description?: string | null
          id?: string
          points?: number
          prize_id?: string | null
          sale_id?: string | null
          store_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_log_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_prize_tiers: {
        Row: {
          color: string
          created_at: string
          id: string
          is_active: boolean
          min_points: number
          name: string
          prize_label: string
          prize_type: string
          prize_value: number
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          min_points?: number
          name: string
          prize_label: string
          prize_type?: string
          prize_value?: number
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          min_points?: number
          name?: string
          prize_label?: string
          prize_type?: string
          prize_value?: number
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_prize_tiers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_leads: {
        Row: {
          campaign_tag: string
          converted: boolean | null
          converted_at: string | null
          created_at: string
          email: string | null
          id: string
          instagram: string | null
          metadata: Json | null
          name: string | null
          phone: string | null
          recovery_disparo: number | null
          recovery_session_id: string | null
          recovery_ultimo_disparo_at: string | null
          source: string | null
        }
        Insert: {
          campaign_tag: string
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          recovery_disparo?: number | null
          recovery_session_id?: string | null
          recovery_ultimo_disparo_at?: string | null
          source?: string | null
        }
        Update: {
          campaign_tag?: string
          converted?: boolean | null
          converted_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          recovery_disparo?: number | null
          recovery_session_id?: string | null
          recovery_ultimo_disparo_at?: string | null
          source?: string | null
        }
        Relationships: []
      }
      marketing_calendar_entries: {
        Row: {
          color: string | null
          content: string | null
          created_at: string
          end_date: string | null
          entry_date: string
          entry_type: string
          id: string
          media_type: string | null
          media_url: string | null
          text_color: string | null
          title: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          content?: string | null
          created_at?: string
          end_date?: string | null
          entry_date: string
          entry_type?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          text_color?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          content?: string | null
          created_at?: string
          end_date?: string | null
          entry_date?: string
          entry_type?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          text_color?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_calendar_goals: {
        Row: {
          actions: string | null
          created_at: string
          goals: Json | null
          id: string
          month: number
          notes: string | null
          updated_at: string
          year: number
        }
        Insert: {
          actions?: string | null
          created_at?: string
          goals?: Json | null
          id?: string
          month: number
          notes?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          actions?: string | null
          created_at?: string
          goals?: Json | null
          id?: string
          month?: number
          notes?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      marketing_campaigns: {
        Row: {
          actual_cost: number | null
          ai_prompt: string | null
          ai_strategy: Json | null
          attributed_orders: number | null
          attributed_revenue: number | null
          budget: number | null
          channels: string[] | null
          completed_at: string | null
          contact_list_id: string | null
          content: Json | null
          created_at: string
          delivered_count: number | null
          description: string | null
          end_date: string | null
          failed_count: number | null
          id: string
          leads_captured: number | null
          name: string
          objective: string | null
          people_reached: number | null
          read_count: number | null
          scheduled_at: string | null
          sent_count: number | null
          start_date: string | null
          started_at: string | null
          status: string
          target_audience: string | null
          total_recipients: number | null
          updated_at: string
          whatsapp_number_id: string | null
          whatsapp_template_name: string | null
          whatsapp_template_params: Json | null
        }
        Insert: {
          actual_cost?: number | null
          ai_prompt?: string | null
          ai_strategy?: Json | null
          attributed_orders?: number | null
          attributed_revenue?: number | null
          budget?: number | null
          channels?: string[] | null
          completed_at?: string | null
          contact_list_id?: string | null
          content?: Json | null
          created_at?: string
          delivered_count?: number | null
          description?: string | null
          end_date?: string | null
          failed_count?: number | null
          id?: string
          leads_captured?: number | null
          name: string
          objective?: string | null
          people_reached?: number | null
          read_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          target_audience?: string | null
          total_recipients?: number | null
          updated_at?: string
          whatsapp_number_id?: string | null
          whatsapp_template_name?: string | null
          whatsapp_template_params?: Json | null
        }
        Update: {
          actual_cost?: number | null
          ai_prompt?: string | null
          ai_strategy?: Json | null
          attributed_orders?: number | null
          attributed_revenue?: number | null
          budget?: number | null
          channels?: string[] | null
          completed_at?: string | null
          contact_list_id?: string | null
          content?: Json | null
          created_at?: string
          delivered_count?: number | null
          description?: string | null
          end_date?: string | null
          failed_count?: number | null
          id?: string
          leads_captured?: number | null
          name?: string
          objective?: string | null
          people_reached?: number | null
          read_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          start_date?: string | null
          started_at?: string | null
          status?: string
          target_audience?: string | null
          total_recipients?: number | null
          updated_at?: string
          whatsapp_number_id?: string | null
          whatsapp_template_name?: string | null
          whatsapp_template_params?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_contact_list_id_fkey"
            columns: ["contact_list_id"]
            isOneToOne: false
            referencedRelation: "marketing_contact_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_contact_lists: {
        Row: {
          contact_count: number
          created_at: string
          description: string | null
          id: string
          name: string
          source: string
          source_event_id: string | null
          updated_at: string
        }
        Insert: {
          contact_count?: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          source?: string
          source_event_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_count?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          source?: string
          source_event_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_contact_lists_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          instagram: string | null
          list_id: string
          metadata: Json | null
          name: string | null
          phone: string | null
          tags: string[] | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          list_id: string
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          tags?: string[] | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          instagram?: string | null
          list_id?: string
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_contacts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "marketing_contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_recurring_actions: {
        Row: {
          color: string | null
          content: string | null
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          recurrence_config: Json | null
          recurrence_type: string
          start_date: string
          title: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          content?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          recurrence_config?: Json | null
          recurrence_type: string
          start_date?: string
          title: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          content?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          recurrence_config?: Json | null
          recurrence_type?: string
          start_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_send_logs: {
        Row: {
          campaign_id: string
          channel: string
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          email: string | null
          error_message: string | null
          id: string
          meta_message_id: string | null
          phone: string | null
          read_at: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          channel?: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          email?: string | null
          error_message?: string | null
          id?: string
          meta_message_id?: string | null
          phone?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          channel?: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          email?: string | null
          error_message?: string | null
          id?: string
          meta_message_id?: string | null
          phone?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_send_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_send_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "marketing_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      mass_dispatch_campaigns: {
        Row: {
          attribution_days: number
          audience_filters: Json
          completed_at: string | null
          created_at: string
          failed_count: number
          id: string
          message: string | null
          name: string
          sent_count: number
          shadow_mode: boolean
          started_at: string | null
          status: string
          total_targets: number
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          attribution_days?: number
          audience_filters?: Json
          completed_at?: string | null
          created_at?: string
          failed_count?: number
          id?: string
          message?: string | null
          name: string
          sent_count?: number
          shadow_mode?: boolean
          started_at?: string | null
          status?: string
          total_targets?: number
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          attribution_days?: number
          audience_filters?: Json
          completed_at?: string | null
          created_at?: string
          failed_count?: number
          id?: string
          message?: string | null
          name?: string
          sent_count?: number
          shadow_mode?: boolean
          started_at?: string | null
          status?: string
          total_targets?: number
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      mass_dispatch_targets: {
        Row: {
          campaign_id: string
          contact_id: string | null
          created_at: string
          display_name: string | null
          error: string | null
          id: string
          message_id: string | null
          phone: string
          phone_suffix8: string
          provider_at_send: string | null
          sent_at: string | null
          shadow_mode: boolean
          status: string
          template_category_at_send: string | null
          unit_cost_at_send: number | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          phone: string
          phone_suffix8: string
          provider_at_send?: string | null
          sent_at?: string | null
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          unit_cost_at_send?: number | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          error?: string | null
          id?: string
          message_id?: string | null
          phone?: string
          phone_suffix8?: string
          provider_at_send?: string | null
          sent_at?: string | null
          shadow_mode?: boolean
          status?: string
          template_category_at_send?: string | null
          unit_cost_at_send?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mass_dispatch_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "mass_dispatch_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mass_dispatch_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "mass_dispatch_roas"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "mass_dispatch_targets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "vip_orphan_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      master_merge_log: {
        Row: {
          action: string
          base_name: string
          canonical_master_id: string | null
          created_at: string
          details: Json | null
          id: string
          loser_master_id: string | null
          run_id: string
        }
        Insert: {
          action: string
          base_name: string
          canonical_master_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          loser_master_id?: string | null
          run_id: string
        }
        Update: {
          action?: string
          base_name?: string
          canonical_master_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          loser_master_id?: string | null
          run_id?: string
        }
        Relationships: []
      }
      mercadopago_accounts: {
        Row: {
          access_token: string
          app_number: string | null
          cnpj: string | null
          created_at: string
          description: string | null
          has_access_token: boolean | null
          id: string
          is_active: boolean
          is_sandbox: boolean
          mp_user_id: string | null
          name: string
          notes: string | null
          public_key: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          access_token: string
          app_number?: string | null
          cnpj?: string | null
          created_at?: string
          description?: string | null
          has_access_token?: boolean | null
          id?: string
          is_active?: boolean
          is_sandbox?: boolean
          mp_user_id?: string | null
          name: string
          notes?: string | null
          public_key?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          access_token?: string
          app_number?: string | null
          cnpj?: string | null
          created_at?: string
          description?: string | null
          has_access_token?: boolean | null
          id?: string
          is_active?: boolean
          is_sandbox?: boolean
          mp_user_id?: string | null
          name?: string
          notes?: string | null
          public_key?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          created_at: string
          id: string
          message: string
          name: string
          stage: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          name: string
          stage?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          name?: string
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      meta_ad_accounts: {
        Row: {
          account_id: string
          account_name: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
        }
        Insert: {
          account_id: string
          account_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
        }
        Update: {
          account_id?: string
          account_name?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
        }
        Relationships: []
      }
      meta_ad_spend_daily: {
        Row: {
          account_id: string
          clicks: number | null
          cpc: number | null
          cpm: number | null
          created_at: string | null
          date: string
          id: string
          impressions: number | null
          spend: number | null
        }
        Insert: {
          account_id: string
          clicks?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          date: string
          id?: string
          impressions?: number | null
          spend?: number | null
        }
        Update: {
          account_id?: string
          clicks?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          date?: string
          id?: string
          impressions?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_ad_spend_daily_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "meta_ad_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      meta_capi_lead_events: {
        Row: {
          campaign_id: string | null
          campaign_slug: string | null
          created_at: string
          error_message: string | null
          event_id: string
          event_name: string
          id: string
          meta_response: Json | null
          phone: string
          pixel_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id?: string | null
          campaign_slug?: string | null
          created_at?: string
          error_message?: string | null
          event_id: string
          event_name: string
          id?: string
          meta_response?: Json | null
          phone: string
          pixel_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string | null
          campaign_slug?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string
          event_name?: string
          id?: string
          meta_response?: Json | null
          phone?: string
          pixel_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      meta_capi_offline_log: {
        Row: {
          created_at: string
          dataset_id: string
          error_message: string | null
          event_id: string
          event_name: string
          http_status: number | null
          id: string
          meta_response: Json | null
          payload_summary: Json | null
          sale_id: string
          sent_at: string | null
          status: string
          test_event_code: string | null
        }
        Insert: {
          created_at?: string
          dataset_id: string
          error_message?: string | null
          event_id: string
          event_name?: string
          http_status?: number | null
          id?: string
          meta_response?: Json | null
          payload_summary?: Json | null
          sale_id: string
          sent_at?: string | null
          status?: string
          test_event_code?: string | null
        }
        Update: {
          created_at?: string
          dataset_id?: string
          error_message?: string | null
          event_id?: string
          event_name?: string
          http_status?: number | null
          id?: string
          meta_response?: Json | null
          payload_summary?: Json | null
          sale_id?: string
          sent_at?: string | null
          status?: string
          test_event_code?: string | null
        }
        Relationships: []
      }
      meta_capi_purchase_log: {
        Row: {
          created_at: string
          error_message: string | null
          event_id: string
          event_name: string
          http_status: number | null
          id: string
          meta_response: Json | null
          order_id: string
          payload_summary: Json | null
          pixel_id: string | null
          sent_at: string | null
          status: string
          test_event_code: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_id: string
          event_name?: string
          http_status?: number | null
          id?: string
          meta_response?: Json | null
          order_id: string
          payload_summary?: Json | null
          pixel_id?: string | null
          sent_at?: string | null
          status?: string
          test_event_code?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_id?: string
          event_name?: string
          http_status?: number | null
          id?: string
          meta_response?: Json | null
          order_id?: string
          payload_summary?: Json | null
          pixel_id?: string | null
          sent_at?: string | null
          status?: string
          test_event_code?: string | null
        }
        Relationships: []
      }
      meta_message_queue: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          id: string
          max_attempts: number
          phone: string
          scheduled_at: string | null
          sent_at: string | null
          status: string
          template_language: string
          template_name: string
          template_params: Json | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          max_attempts?: number
          phone: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          template_language?: string
          template_name: string
          template_params?: Json | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          max_attempts?: number
          phone?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          template_language?: string
          template_name?: string
          template_params?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      meta_template_category_alerts: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          cost_delta_pct: number | null
          cost_new_brl: number | null
          cost_previous_brl: number | null
          created_at: string
          detected_at: string
          id: string
          new_category: string
          previous_category: string | null
          template_language: string
          template_name: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          cost_delta_pct?: number | null
          cost_new_brl?: number | null
          cost_previous_brl?: number | null
          created_at?: string
          detected_at?: string
          id?: string
          new_category: string
          previous_category?: string | null
          template_language?: string
          template_name: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          cost_delta_pct?: number | null
          cost_new_brl?: number | null
          cost_previous_brl?: number | null
          created_at?: string
          detected_at?: string
          id?: string
          new_category?: string
          previous_category?: string | null
          template_language?: string
          template_name?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_template_category_alerts_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_template_category_alerts_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_template_status_log: {
        Row: {
          created_at: string
          event: string | null
          id: string
          language: string | null
          raw_payload: Json | null
          rejected_reason: string | null
          template_id: string
          template_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event?: string | null
          id?: string
          language?: string | null
          raw_payload?: Json | null
          rejected_reason?: string | null
          template_id: string
          template_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event?: string | null
          id?: string
          language?: string | null
          raw_payload?: Json | null
          rejected_reason?: string | null
          template_id?: string
          template_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      monthly_goals: {
        Row: {
          created_at: string
          id: string
          loja: string
          mes_ref: string
          meta_faturamento_brl: number
          observacao: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          loja: string
          mes_ref: string
          meta_faturamento_brl: number
          observacao?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          loja?: string
          mes_ref?: string
          meta_faturamento_brl?: number
          observacao?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nfe_distribuicao_state: {
        Row: {
          company_id: string
          created_at: string
          last_error: string | null
          last_sync_at: string | null
          max_nsu: string | null
          ultimo_nsu: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          last_error?: string | null
          last_sync_at?: string | null
          max_nsu?: string | null
          ultimo_nsu?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          last_error?: string | null
          last_sync_at?: string | null
          max_nsu?: string | null
          ultimo_nsu?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_distribuicao_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_received: {
        Row: {
          brasilnfe_response: Json | null
          chave_acesso: string
          company_id: string
          created_at: string
          danfe_url: string | null
          data_emissao: string | null
          destinatario_cnpj: string | null
          emitente_cnpj: string | null
          emitente_nome: string | null
          emitente_uf: string | null
          estoque_lancado_em: string | null
          estoque_lancado_por: string | null
          estoque_status: string
          id: string
          manifestacao_data: string | null
          manifestacao_justificativa: string | null
          manifestacao_protocolo: string | null
          manifestacao_status: string
          modelo: number | null
          natureza_operacao: string | null
          nsu: string | null
          numero: number | null
          serie: number | null
          tipo_operacao: number | null
          updated_at: string
          valor_total: number | null
          xml_completo_content: string | null
          xml_resumo_content: string | null
          xml_url: string | null
        }
        Insert: {
          brasilnfe_response?: Json | null
          chave_acesso: string
          company_id: string
          created_at?: string
          danfe_url?: string | null
          data_emissao?: string | null
          destinatario_cnpj?: string | null
          emitente_cnpj?: string | null
          emitente_nome?: string | null
          emitente_uf?: string | null
          estoque_lancado_em?: string | null
          estoque_lancado_por?: string | null
          estoque_status?: string
          id?: string
          manifestacao_data?: string | null
          manifestacao_justificativa?: string | null
          manifestacao_protocolo?: string | null
          manifestacao_status?: string
          modelo?: number | null
          natureza_operacao?: string | null
          nsu?: string | null
          numero?: number | null
          serie?: number | null
          tipo_operacao?: number | null
          updated_at?: string
          valor_total?: number | null
          xml_completo_content?: string | null
          xml_resumo_content?: string | null
          xml_url?: string | null
        }
        Update: {
          brasilnfe_response?: Json | null
          chave_acesso?: string
          company_id?: string
          created_at?: string
          danfe_url?: string | null
          data_emissao?: string | null
          destinatario_cnpj?: string | null
          emitente_cnpj?: string | null
          emitente_nome?: string | null
          emitente_uf?: string | null
          estoque_lancado_em?: string | null
          estoque_lancado_por?: string | null
          estoque_status?: string
          id?: string
          manifestacao_data?: string | null
          manifestacao_justificativa?: string | null
          manifestacao_protocolo?: string | null
          manifestacao_status?: string
          modelo?: number | null
          natureza_operacao?: string | null
          nsu?: string | null
          numero?: number | null
          serie?: number | null
          tipo_operacao?: number | null
          updated_at?: string
          valor_total?: number | null
          xml_completo_content?: string | null
          xml_resumo_content?: string | null
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_received_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_received_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          justificativa: string | null
          nfe_received_id: string
          performed_by: string | null
          protocolo: string | null
          request_payload: Json | null
          response_payload: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          justificativa?: string | null
          nfe_received_id: string
          performed_by?: string | null
          protocolo?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          justificativa?: string | null
          nfe_received_id?: string
          performed_by?: string | null
          protocolo?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_received_events_nfe_received_id_fkey"
            columns: ["nfe_received_id"]
            isOneToOne: false
            referencedRelation: "nfe_received"
            referencedColumns: ["id"]
          },
        ]
      }
      online_exchanges: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_cpf: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          inspected_at: string | null
          notes: string | null
          product_name: string | null
          product_sku: string | null
          product_variant: string | null
          quantity: number
          reason_category: string
          reason_detail: string | null
          received_at: string | null
          shopify_order_id: string | null
          shopify_order_name: string
          shopify_order_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          inspected_at?: string | null
          notes?: string | null
          product_name?: string | null
          product_sku?: string | null
          product_variant?: string | null
          quantity?: number
          reason_category: string
          reason_detail?: string | null
          received_at?: string | null
          shopify_order_id?: string | null
          shopify_order_name: string
          shopify_order_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          inspected_at?: string | null
          notes?: string | null
          product_name?: string | null
          product_sku?: string | null
          product_variant?: string | null
          quantity?: number
          reason_category?: string
          reason_detail?: string | null
          received_at?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string
          shopify_order_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_crossell_items: {
        Row: {
          added_at: string
          color: string | null
          discount_price: number
          event_id: string | null
          id: string
          image: string | null
          offer_id: string | null
          order_id: string
          original_price: number
          qty: number
          shopify_product_id: string | null
          shopify_variant_id: string | null
          size: string | null
          title: string | null
        }
        Insert: {
          added_at?: string
          color?: string | null
          discount_price?: number
          event_id?: string | null
          id?: string
          image?: string | null
          offer_id?: string | null
          order_id: string
          original_price?: number
          qty?: number
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          size?: string | null
          title?: string | null
        }
        Update: {
          added_at?: string
          color?: string | null
          discount_price?: number
          event_id?: string | null
          id?: string
          image?: string | null
          offer_id?: string | null
          order_id?: string
          original_price?: number
          qty?: number
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          size?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_crossell_items_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "event_crossell_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_crossell_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_shopify_history: {
        Row: {
          action: string
          created_at: string
          id: string
          new_shopify_order_id: string | null
          new_shopify_order_name: string | null
          order_id: string
          performed_by: string | null
          previous_shopify_order_id: string | null
          previous_shopify_order_name: string | null
          reason: string | null
        }
        Insert: {
          action?: string
          created_at?: string
          id?: string
          new_shopify_order_id?: string | null
          new_shopify_order_name?: string | null
          order_id: string
          performed_by?: string | null
          previous_shopify_order_id?: string | null
          previous_shopify_order_name?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_shopify_order_id?: string | null
          new_shopify_order_name?: string | null
          order_id?: string
          performed_by?: string | null
          previous_shopify_order_id?: string | null
          previous_shopify_order_name?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_shopify_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          ai_paused: boolean | null
          ai_paused_at: string | null
          appmax_order_id: string | null
          cart_link: string | null
          checkout_started_at: string | null
          checkout_token: string | null
          coupon_code: string | null
          created_at: string
          custom_shipping_cost: number | null
          customer_id: string
          customer_unified_id: string | null
          delivery_method: string | null
          discount_type: string | null
          discount_value: number | null
          eligible_for_prize: boolean | null
          event_id: string | null
          free_shipping: boolean | null
          has_gift: boolean | null
          has_unread_messages: boolean
          id: string
          installments: number | null
          is_delivery: boolean | null
          is_paid: boolean
          is_pickup: boolean | null
          last_customer_message_at: string | null
          last_sent_message_at: string | null
          max_installments_override: number | null
          mercadopago_payment_id: string | null
          merged_at: string | null
          merged_by: string | null
          merged_into_order_id: string | null
          meta_capi_purchase_sent_at: string | null
          mp_account_id: string | null
          notes: string | null
          pagarme_order_id: string | null
          paid_at: string | null
          paid_externally: boolean | null
          payment_method_label: string | null
          pickup_store_id: string | null
          pos_sale_id: string | null
          products: Json
          shipping_cost: number | null
          shipping_info: Json | null
          shopify_order_id: string | null
          shopify_order_name: string | null
          stage: string
          stage_atendimento: string | null
          updated_at: string
          vindi_transaction_id: string | null
        }
        Insert: {
          ai_paused?: boolean | null
          ai_paused_at?: string | null
          appmax_order_id?: string | null
          cart_link?: string | null
          checkout_started_at?: string | null
          checkout_token?: string | null
          coupon_code?: string | null
          created_at?: string
          custom_shipping_cost?: number | null
          customer_id: string
          customer_unified_id?: string | null
          delivery_method?: string | null
          discount_type?: string | null
          discount_value?: number | null
          eligible_for_prize?: boolean | null
          event_id?: string | null
          free_shipping?: boolean | null
          has_gift?: boolean | null
          has_unread_messages?: boolean
          id?: string
          installments?: number | null
          is_delivery?: boolean | null
          is_paid?: boolean
          is_pickup?: boolean | null
          last_customer_message_at?: string | null
          last_sent_message_at?: string | null
          max_installments_override?: number | null
          mercadopago_payment_id?: string | null
          merged_at?: string | null
          merged_by?: string | null
          merged_into_order_id?: string | null
          meta_capi_purchase_sent_at?: string | null
          mp_account_id?: string | null
          notes?: string | null
          pagarme_order_id?: string | null
          paid_at?: string | null
          paid_externally?: boolean | null
          payment_method_label?: string | null
          pickup_store_id?: string | null
          pos_sale_id?: string | null
          products?: Json
          shipping_cost?: number | null
          shipping_info?: Json | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          stage?: string
          stage_atendimento?: string | null
          updated_at?: string
          vindi_transaction_id?: string | null
        }
        Update: {
          ai_paused?: boolean | null
          ai_paused_at?: string | null
          appmax_order_id?: string | null
          cart_link?: string | null
          checkout_started_at?: string | null
          checkout_token?: string | null
          coupon_code?: string | null
          created_at?: string
          custom_shipping_cost?: number | null
          customer_id?: string
          customer_unified_id?: string | null
          delivery_method?: string | null
          discount_type?: string | null
          discount_value?: number | null
          eligible_for_prize?: boolean | null
          event_id?: string | null
          free_shipping?: boolean | null
          has_gift?: boolean | null
          has_unread_messages?: boolean
          id?: string
          installments?: number | null
          is_delivery?: boolean | null
          is_paid?: boolean
          is_pickup?: boolean | null
          last_customer_message_at?: string | null
          last_sent_message_at?: string | null
          max_installments_override?: number | null
          mercadopago_payment_id?: string | null
          merged_at?: string | null
          merged_by?: string | null
          merged_into_order_id?: string | null
          meta_capi_purchase_sent_at?: string | null
          mp_account_id?: string | null
          notes?: string | null
          pagarme_order_id?: string | null
          paid_at?: string | null
          paid_externally?: boolean | null
          payment_method_label?: string | null
          pickup_store_id?: string | null
          pos_sale_id?: string | null
          products?: Json
          shipping_cost?: number | null
          shipping_info?: Json | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          stage?: string
          stage_atendimento?: string | null
          updated_at?: string
          vindi_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_unified_id_fkey"
            columns: ["customer_unified_id"]
            isOneToOne: false
            referencedRelation: "crm_customers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_unified_id_fkey"
            columns: ["customer_unified_id"]
            isOneToOne: false
            referencedRelation: "customers_unified"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_merged_into_order_id_fkey"
            columns: ["merged_into_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_mp_account_id_fkey"
            columns: ["mp_account_id"]
            isOneToOne: false
            referencedRelation: "mercadopago_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pickup_store_id_fkey"
            columns: ["pickup_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_method_fees: {
        Row: {
          acquirer: string
          active: boolean
          brand: string | null
          created_at: string
          days_to_receive: number
          fee_pct: number
          fixed_fee: number
          id: string
          installments: number
          method: string
          notes: string | null
          product: string
          receipt_schedule: string
          updated_at: string
        }
        Insert: {
          acquirer?: string
          active?: boolean
          brand?: string | null
          created_at?: string
          days_to_receive?: number
          fee_pct?: number
          fixed_fee?: number
          id?: string
          installments?: number
          method: string
          notes?: string | null
          product?: string
          receipt_schedule?: string
          updated_at?: string
        }
        Update: {
          acquirer?: string
          active?: boolean
          brand?: string | null
          created_at?: string
          days_to_receive?: number
          fee_pct?: number
          fixed_fee?: number
          id?: string
          installments?: number
          method?: string
          notes?: string | null
          product?: string
          receipt_schedule?: string
          updated_at?: string
        }
        Relationships: []
      }
      paypal_payments: {
        Row: {
          amount: number
          capture_id: string | null
          created_at: string
          currency: string
          id: string
          order_id: string
          payer_email: string | null
          payer_name: string | null
          paypal_order_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          capture_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          order_id: string
          payer_email?: string | null
          payer_name?: string | null
          paypal_order_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          capture_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          order_id?: string
          payer_email?: string | null
          payer_name?: string | null
          paypal_order_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paypal_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      point_payment_intents: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          error_message: string | null
          external_reference: string
          id: string
          is_sandbox: boolean
          mp_account_id: string | null
          mp_order_id: string | null
          mp_payment_id: string | null
          mp_status: string | null
          paid_at: string | null
          raw_response: Json | null
          sale_id: string | null
          status: string
          store_id: string | null
          terminal_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          error_message?: string | null
          external_reference: string
          id?: string
          is_sandbox?: boolean
          mp_account_id?: string | null
          mp_order_id?: string | null
          mp_payment_id?: string | null
          mp_status?: string | null
          paid_at?: string | null
          raw_response?: Json | null
          sale_id?: string | null
          status?: string
          store_id?: string | null
          terminal_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          error_message?: string | null
          external_reference?: string
          id?: string
          is_sandbox?: boolean
          mp_account_id?: string | null
          mp_order_id?: string | null
          mp_payment_id?: string | null
          mp_status?: string | null
          paid_at?: string | null
          raw_response?: Json | null
          sale_id?: string | null
          status?: string
          store_id?: string | null
          terminal_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pos_boletos: {
        Row: {
          address_city: string
          address_complement: string | null
          address_neighborhood: string
          address_number: string
          address_state: string
          address_street: string
          address_zip: string
          amount: number
          created_at: string
          created_by: string | null
          customer_cpf: string
          customer_email: string
          customer_name: string
          customer_phone: string | null
          description: string | null
          due_date: string
          error_message: string | null
          id: string
          mp_account_id: string | null
          mp_barcode: string | null
          mp_boleto_url: string | null
          mp_payment_id: string | null
          mp_pix_payment_id: string | null
          mp_pix_qr_base64: string | null
          mp_pix_qr_code: string | null
          paid_at: string | null
          pdf_path: string | null
          seller_id: string | null
          status: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          address_city: string
          address_complement?: string | null
          address_neighborhood: string
          address_number: string
          address_state: string
          address_street: string
          address_zip: string
          amount: number
          created_at?: string
          created_by?: string | null
          customer_cpf: string
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          description?: string | null
          due_date: string
          error_message?: string | null
          id?: string
          mp_account_id?: string | null
          mp_barcode?: string | null
          mp_boleto_url?: string | null
          mp_payment_id?: string | null
          mp_pix_payment_id?: string | null
          mp_pix_qr_base64?: string | null
          mp_pix_qr_code?: string | null
          paid_at?: string | null
          pdf_path?: string | null
          seller_id?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          address_city?: string
          address_complement?: string | null
          address_neighborhood?: string
          address_number?: string
          address_state?: string
          address_street?: string
          address_zip?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_cpf?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          description?: string | null
          due_date?: string
          error_message?: string | null
          id?: string
          mp_account_id?: string | null
          mp_barcode?: string | null
          mp_boleto_url?: string | null
          mp_payment_id?: string | null
          mp_pix_payment_id?: string | null
          mp_pix_qr_base64?: string | null
          mp_pix_qr_code?: string | null
          paid_at?: string | null
          pdf_path?: string | null
          seller_id?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pos_cash_movements: {
        Row: {
          amount: number
          cash_register_id: string
          counterpart_bank_account_id: string | null
          created_at: string
          description: string | null
          id: string
          seller_id: string | null
          store_id: string
          transfer_pair_id: string | null
          type: string
        }
        Insert: {
          amount: number
          cash_register_id: string
          counterpart_bank_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          seller_id?: string | null
          store_id: string
          transfer_pair_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          cash_register_id?: string
          counterpart_bank_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          seller_id?: string | null
          store_id?: string
          transfer_pair_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_cash_movements_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "pos_cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_movements_counterpart_bank_account_id_fkey"
            columns: ["counterpart_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_cash_registers: {
        Row: {
          card_sales: number | null
          cash_sales: number | null
          closed_at: string | null
          closing_balance: number | null
          created_at: string
          deposits: number | null
          difference: number | null
          expected_balance: number | null
          id: string
          notes: string | null
          opened_at: string
          opening_balance: number
          other_sales: number | null
          pix_sales: number | null
          seller_id: string | null
          status: string
          store_id: string
          updated_at: string
          withdrawals: number | null
        }
        Insert: {
          card_sales?: number | null
          cash_sales?: number | null
          closed_at?: string | null
          closing_balance?: number | null
          created_at?: string
          deposits?: number | null
          difference?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_balance?: number
          other_sales?: number | null
          pix_sales?: number | null
          seller_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
          withdrawals?: number | null
        }
        Update: {
          card_sales?: number | null
          cash_sales?: number | null
          closed_at?: string | null
          closing_balance?: number | null
          created_at?: string
          deposits?: number | null
          difference?: number | null
          expected_balance?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_balance?: number
          other_sales?: number | null
          pix_sales?: number | null
          seller_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
          withdrawals?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_cash_registers_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_registers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_cashback_config: {
        Row: {
          code_prefix: string
          cooldown_days: number
          created_at: string
          id: string
          is_enabled: boolean
          max_cashback: number | null
          min_purchase_multiplier: number
          min_sale_value: number
          percentage: number
          store_id: string | null
          updated_at: string
          validity_days: number
        }
        Insert: {
          code_prefix?: string
          cooldown_days?: number
          created_at?: string
          id?: string
          is_enabled?: boolean
          max_cashback?: number | null
          min_purchase_multiplier?: number
          min_sale_value?: number
          percentage?: number
          store_id?: string | null
          updated_at?: string
          validity_days?: number
        }
        Update: {
          code_prefix?: string
          cooldown_days?: number
          created_at?: string
          id?: string
          is_enabled?: boolean
          max_cashback?: number | null
          min_purchase_multiplier?: number
          min_sale_value?: number
          percentage?: number
          store_id?: string | null
          updated_at?: string
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_cashback_config_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_checkout_attempts: {
        Row: {
          amount: number | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          error_message: string | null
          gateway: string | null
          id: string
          metadata: Json | null
          payment_method: string
          sale_id: string
          status: string
          store_id: string | null
          transaction_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          error_message?: string | null
          gateway?: string | null
          id?: string
          metadata?: Json | null
          payment_method: string
          sale_id: string
          status?: string
          store_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          error_message?: string | null
          gateway?: string | null
          id?: string
          metadata?: Json | null
          payment_method?: string
          sale_id?: string
          status?: string
          store_id?: string | null
          transaction_id?: string | null
        }
        Relationships: []
      }
      pos_commission_live_participants: {
        Row: {
          created_at: string
          id: string
          period_end: string
          period_start: string
          person_id: string
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          person_id: string
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          person_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_commission_live_participants_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "pos_commission_people"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_commission_people: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          manual_goal_value: number | null
          name: string
          receives_all_lives: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          manual_goal_value?: number | null
          name: string
          receives_all_lives?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          manual_goal_value?: number | null
          name?: string
          receives_all_lives?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      pos_commission_people_sellers: {
        Row: {
          created_at: string
          id: string
          person_id: string
          seller_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          person_id: string
          seller_id: string
        }
        Update: {
          created_at?: string
          id?: string
          person_id?: string
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_commission_people_sellers_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "pos_commission_people"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_commission_scale: {
        Row: {
          achievement_percent: number
          commission_percent: number
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          achievement_percent: number
          commission_percent: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          achievement_percent?: number
          commission_percent?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pos_conditionals: {
        Row: {
          conditional_type: string
          created_at: string
          customer_id: string | null
          due_date: string | null
          id: string
          items: Json
          notes: string | null
          returned_at: string | null
          seller_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          conditional_type?: string
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          items?: Json
          notes?: string | null
          returned_at?: string | null
          seller_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          conditional_type?: string
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          items?: Json
          notes?: string | null
          returned_at?: string | null
          seller_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_conditionals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_conditionals_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_conditionals_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_crediario_gateways: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      pos_customers: {
        Row: {
          address: string | null
          address_number: string | null
          age_range: string | null
          cep: string | null
          children_age_range: string | null
          city: string | null
          complement: string | null
          cpf: string | null
          created_at: string
          email: string | null
          gender: string | null
          has_children: boolean | null
          id: string
          name: string | null
          neighborhood: string | null
          notes: string | null
          preferred_style: string | null
          previous_whatsapp_numbers: string[] | null
          shoe_size: string | null
          state: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          address_number?: string | null
          age_range?: string | null
          cep?: string | null
          children_age_range?: string | null
          city?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          gender?: string | null
          has_children?: boolean | null
          id?: string
          name?: string | null
          neighborhood?: string | null
          notes?: string | null
          preferred_style?: string | null
          previous_whatsapp_numbers?: string[] | null
          shoe_size?: string | null
          state?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          address_number?: string | null
          age_range?: string | null
          cep?: string | null
          children_age_range?: string | null
          city?: string | null
          complement?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          gender?: string | null
          has_children?: boolean | null
          id?: string
          name?: string | null
          neighborhood?: string | null
          notes?: string | null
          preferred_style?: string | null
          previous_whatsapp_numbers?: string[] | null
          shoe_size?: string | null
          state?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      pos_exchanges: {
        Row: {
          created_at: string
          credit_amount: number | null
          credit_code: string | null
          credit_expires_at: string | null
          credit_used_at: string | null
          customer_id: string | null
          difference_amount: number | null
          difference_payment_method: string | null
          exchange_type: string
          id: string
          new_items: Json | null
          new_total: number | null
          notes: string | null
          original_sale_id: string | null
          original_sale_source: string | null
          original_seller_id: string | null
          original_seller_name: string | null
          return_reason: string | null
          returned_items: Json
          returned_total: number
          seller_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_amount?: number | null
          credit_code?: string | null
          credit_expires_at?: string | null
          credit_used_at?: string | null
          customer_id?: string | null
          difference_amount?: number | null
          difference_payment_method?: string | null
          exchange_type?: string
          id?: string
          new_items?: Json | null
          new_total?: number | null
          notes?: string | null
          original_sale_id?: string | null
          original_sale_source?: string | null
          original_seller_id?: string | null
          original_seller_name?: string | null
          return_reason?: string | null
          returned_items?: Json
          returned_total?: number
          seller_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_amount?: number | null
          credit_code?: string | null
          credit_expires_at?: string | null
          credit_used_at?: string | null
          customer_id?: string | null
          difference_amount?: number | null
          difference_payment_method?: string | null
          exchange_type?: string
          id?: string
          new_items?: Json | null
          new_total?: number | null
          notes?: string | null
          original_sale_id?: string | null
          original_sale_source?: string | null
          original_seller_id?: string | null
          original_seller_name?: string | null
          return_reason?: string | null
          returned_items?: Json
          returned_total?: number
          seller_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_exchanges_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_exchanges_original_sale_id_fkey"
            columns: ["original_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_exchanges_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_exchanges_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_gamification: {
        Row: {
          badges: Json
          complete_registrations: number
          created_at: string
          fast_requests_answered: number
          id: string
          partial_registrations: number
          returns_count: number
          seller_id: string
          store_id: string
          total_points: number
          total_sales: number
          updated_at: string
          weekly_points: number
        }
        Insert: {
          badges?: Json
          complete_registrations?: number
          created_at?: string
          fast_requests_answered?: number
          id?: string
          partial_registrations?: number
          returns_count?: number
          seller_id: string
          store_id: string
          total_points?: number
          total_sales?: number
          updated_at?: string
          weekly_points?: number
        }
        Update: {
          badges?: Json
          complete_registrations?: number
          created_at?: string
          fast_requests_answered?: number
          id?: string
          partial_registrations?: number
          returns_count?: number
          seller_id?: string
          store_id?: string
          total_points?: number
          total_sales?: number
          updated_at?: string
          weekly_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_gamification_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_gamification_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_goal_progress: {
        Row: {
          current_value: number
          goal_id: string
          id: string
          last_sale_id: string | null
          seller_id: string | null
          updated_at: string
        }
        Insert: {
          current_value?: number
          goal_id: string
          id?: string
          last_sale_id?: string | null
          seller_id?: string | null
          updated_at?: string
        }
        Update: {
          current_value?: number
          goal_id?: string
          id?: string
          last_sale_id?: string | null
          seller_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_goal_progress_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "pos_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_goal_progress_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_goals: {
        Row: {
          created_at: string
          goal_brand: string | null
          goal_category: string | null
          goal_type: string
          goal_value: number
          id: string
          is_active: boolean
          period: string
          period_end: string | null
          period_start: string | null
          prize_label: string | null
          prize_type: string | null
          prize_value: number | null
          seller_id: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          goal_brand?: string | null
          goal_category?: string | null
          goal_type: string
          goal_value: number
          id?: string
          is_active?: boolean
          period: string
          period_end?: string | null
          period_start?: string | null
          prize_label?: string | null
          prize_type?: string | null
          prize_value?: number | null
          seller_id?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          goal_brand?: string | null
          goal_category?: string | null
          goal_type?: string
          goal_value?: number
          id?: string
          is_active?: boolean
          period?: string
          period_end?: string | null
          period_start?: string | null
          prize_label?: string | null
          prize_type?: string | null
          prize_value?: number | null
          seller_id?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_goals_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_goals_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_inter_store_requests: {
        Row: {
          courier_name: string | null
          courier_phone: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          estimated_arrival: string | null
          from_store_id: string
          id: string
          items: Json
          notes: string | null
          priority: string | null
          requested_by: string | null
          responded_by: string | null
          status: string
          to_store_id: string
          updated_at: string
        }
        Insert: {
          courier_name?: string | null
          courier_phone?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          estimated_arrival?: string | null
          from_store_id: string
          id?: string
          items?: Json
          notes?: string | null
          priority?: string | null
          requested_by?: string | null
          responded_by?: string | null
          status?: string
          to_store_id: string
          updated_at?: string
        }
        Update: {
          courier_name?: string | null
          courier_phone?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          estimated_arrival?: string | null
          from_store_id?: string
          id?: string
          items?: Json
          notes?: string | null
          priority?: string | null
          requested_by?: string | null
          responded_by?: string | null
          status?: string
          to_store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_inter_store_requests_from_store_id_fkey"
            columns: ["from_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_inter_store_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_inter_store_requests_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_inter_store_requests_to_store_id_fkey"
            columns: ["to_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_invoice_config: {
        Row: {
          auto_emit_min_value: number | null
          auto_emit_on_sale: boolean
          auto_emit_payment_methods: string[] | null
          created_at: string
          id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          auto_emit_min_value?: number | null
          auto_emit_on_sale?: boolean
          auto_emit_payment_methods?: string[] | null
          created_at?: string
          id?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          auto_emit_min_value?: number | null
          auto_emit_on_sale?: boolean
          auto_emit_payment_methods?: string[] | null
          created_at?: string
          id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_invoice_config_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_payment_methods: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          settlement_bank_account_id: string | null
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          name: string
          settlement_bank_account_id?: string | null
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          settlement_bank_account_id?: string | null
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_payment_methods_settlement_bank_account_id_fkey"
            columns: ["settlement_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payment_methods_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_payment_receipts: {
        Row: {
          amount: number
          cash_register_id: string | null
          created_at: string
          id: string
          notes: string | null
          payment_method: string
          receipt_image_url: string
          sale_id: string | null
          store_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          amount?: number
          cash_register_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payment_method: string
          receipt_image_url: string
          sale_id?: string | null
          store_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          amount?: number
          cash_register_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payment_method?: string
          receipt_image_url?: string
          sale_id?: string | null
          store_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_payment_receipts_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "pos_cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payment_receipts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payment_receipts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_prizes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          min_points: number
          name: string
          prize_type: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          min_points?: number
          name: string
          prize_type?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          min_points?: number
          name?: string
          prize_type?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_prizes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_product_pricing_rules: {
        Row: {
          created_at: string
          delivery_fee: number
          id: string
          is_active: boolean
          physical_store_markup_percent: number
          physical_store_price_source: string
          pickup_discount_percent: number
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_fee?: number
          id?: string
          is_active?: boolean
          physical_store_markup_percent?: number
          physical_store_price_source?: string
          pickup_discount_percent?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_fee?: number
          id?: string
          is_active?: boolean
          physical_store_markup_percent?: number
          physical_store_price_source?: string
          pickup_discount_percent?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_product_pricing_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_product_requests: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          created_at: string
          id: string
          items: Json
          notes: string | null
          points_awarded: boolean | null
          priority: string
          requested_at: string
          requested_by: string | null
          requesting_store_id: string
          status: string
          target_store_id: string
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string
          id?: string
          items?: Json
          notes?: string | null
          points_awarded?: boolean | null
          priority?: string
          requested_at?: string
          requested_by?: string | null
          requesting_store_id: string
          status?: string
          target_store_id: string
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string
          id?: string
          items?: Json
          notes?: string | null
          points_awarded?: boolean | null
          priority?: string
          requested_at?: string
          requested_by?: string | null
          requesting_store_id?: string
          status?: string
          target_store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_product_requests_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_product_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_product_requests_requesting_store_id_fkey"
            columns: ["requesting_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_product_requests_target_store_id_fkey"
            columns: ["target_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_product_searches: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          notes: string | null
          product_description: string
          searched_at: string
          size: string | null
          store_id: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          product_description: string
          searched_at?: string
          size?: string | null
          store_id: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          product_description?: string
          searched_at?: string
          size?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_product_searches_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_product_sync_log: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          products_synced: number | null
          started_at: string
          status: string
          store_id: string
          total_products: number | null
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          products_synced?: number | null
          started_at?: string
          status?: string
          store_id: string
          total_products?: number | null
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          products_synced?: number | null
          started_at?: string
          status?: string
          store_id?: string
          total_products?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_product_sync_log_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_products: {
        Row: {
          age_group: string | null
          auto_classified: boolean
          barcode: string
          brand: string | null
          category: string | null
          category_id: string | null
          classification_confidence: number | null
          color: string | null
          cost_price: number | null
          created_at: string
          gender: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          parent_sku: string | null
          price: number
          price_tier_id: string | null
          size: string | null
          sku: string
          stock: number
          store_id: string
          synced_at: string
          tiny_id: number | null
          updated_at: string
          variant: string
        }
        Insert: {
          age_group?: string | null
          auto_classified?: boolean
          barcode?: string
          brand?: string | null
          category?: string | null
          category_id?: string | null
          classification_confidence?: number | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          gender?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          parent_sku?: string | null
          price?: number
          price_tier_id?: string | null
          size?: string | null
          sku?: string
          stock?: number
          store_id: string
          synced_at?: string
          tiny_id?: number | null
          updated_at?: string
          variant?: string
        }
        Update: {
          age_group?: string | null
          auto_classified?: boolean
          barcode?: string
          brand?: string | null
          category?: string | null
          category_id?: string | null
          classification_confidence?: number | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          gender?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          parent_sku?: string | null
          price?: number
          price_tier_id?: string | null
          size?: string | null
          sku?: string
          stock?: number
          store_id?: string
          synced_at?: string
          tiny_id?: number | null
          updated_at?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_products_price_tier_id_fkey"
            columns: ["price_tier_id"]
            isOneToOne: false
            referencedRelation: "price_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_products_dedup_backup: {
        Row: {
          age_group: string | null
          auto_classified: boolean
          backed_up_at: string
          backup_id: string
          barcode: string
          brand: string | null
          category: string | null
          category_id: string | null
          classification_confidence: number | null
          color: string | null
          cost_price: number | null
          created_at: string
          dedup_wave: string | null
          gender: string | null
          group_role: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          parent_sku: string | null
          price: number
          price_tier_id: string | null
          size: string | null
          sku: string
          stock: number
          store_id: string
          synced_at: string
          tiny_id: number | null
          updated_at: string
          variant: string
        }
        Insert: {
          age_group?: string | null
          auto_classified?: boolean
          backed_up_at?: string
          backup_id?: string
          barcode?: string
          brand?: string | null
          category?: string | null
          category_id?: string | null
          classification_confidence?: number | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          dedup_wave?: string | null
          gender?: string | null
          group_role?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          parent_sku?: string | null
          price?: number
          price_tier_id?: string | null
          size?: string | null
          sku?: string
          stock?: number
          store_id: string
          synced_at?: string
          tiny_id?: number | null
          updated_at?: string
          variant?: string
        }
        Update: {
          age_group?: string | null
          auto_classified?: boolean
          backed_up_at?: string
          backup_id?: string
          barcode?: string
          brand?: string | null
          category?: string | null
          category_id?: string | null
          classification_confidence?: number | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          dedup_wave?: string | null
          gender?: string | null
          group_role?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          parent_sku?: string | null
          price?: number
          price_tier_id?: string | null
          size?: string | null
          sku?: string
          stock?: number
          store_id?: string
          synced_at?: string
          tiny_id?: number | null
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      pos_products_phantom_backup_20260513: {
        Row: {
          barcode: string | null
          category: string | null
          color: string | null
          cost_price: number | null
          created_at: string | null
          id: string | null
          image_url: string | null
          is_active: boolean | null
          name: string | null
          parent_sku: string | null
          price: number | null
          size: string | null
          sku: string | null
          stock: number | null
          store_id: string | null
          synced_at: string | null
          tiny_id: number | null
          updated_at: string | null
          variant: string | null
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          name?: string | null
          parent_sku?: string | null
          price?: number | null
          size?: string | null
          sku?: string | null
          stock?: number | null
          store_id?: string | null
          synced_at?: string | null
          tiny_id?: number | null
          updated_at?: string | null
          variant?: string | null
        }
        Update: {
          barcode?: string | null
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string | null
          id?: string | null
          image_url?: string | null
          is_active?: boolean | null
          name?: string | null
          parent_sku?: string | null
          price?: number | null
          size?: string | null
          sku?: string | null
          stock?: number | null
          store_id?: string | null
          synced_at?: string | null
          tiny_id?: number | null
          updated_at?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      pos_returns: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          items: Json
          notes: string | null
          reason: string
          reason_detail: string | null
          refund_amount: number | null
          return_type: string
          sale_id: string | null
          seller_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          items?: Json
          notes?: string | null
          reason?: string
          reason_detail?: string | null
          refund_amount?: number | null
          return_type?: string
          sale_id?: string | null
          seller_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          items?: Json
          notes?: string | null
          reason?: string
          reason_detail?: string | null
          refund_amount?: number | null
          return_type?: string
          sale_id?: string | null
          seller_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_returns_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_returns_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_returns_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sale_items: {
        Row: {
          aliq_cofins: number | null
          aliq_icms: number | null
          aliq_pis: number | null
          barcode: string | null
          category: string | null
          cest_snapshot: string | null
          cfop_snapshot: string | null
          created_at: string
          csosn_icms: string | null
          cst_cofins: string | null
          cst_icms: string | null
          cst_pis: string | null
          id: string
          ncm_snapshot: string | null
          origem_mercadoria: number | null
          product_name: string
          quantity: number
          sale_id: string
          size: string | null
          sku: string | null
          tiny_product_id: string | null
          total_price: number
          unidade_comercial: string | null
          unit_price: number
          variant_name: string | null
        }
        Insert: {
          aliq_cofins?: number | null
          aliq_icms?: number | null
          aliq_pis?: number | null
          barcode?: string | null
          category?: string | null
          cest_snapshot?: string | null
          cfop_snapshot?: string | null
          created_at?: string
          csosn_icms?: string | null
          cst_cofins?: string | null
          cst_icms?: string | null
          cst_pis?: string | null
          id?: string
          ncm_snapshot?: string | null
          origem_mercadoria?: number | null
          product_name: string
          quantity?: number
          sale_id: string
          size?: string | null
          sku?: string | null
          tiny_product_id?: string | null
          total_price?: number
          unidade_comercial?: string | null
          unit_price?: number
          variant_name?: string | null
        }
        Update: {
          aliq_cofins?: number | null
          aliq_icms?: number | null
          aliq_pis?: number | null
          barcode?: string | null
          category?: string | null
          cest_snapshot?: string | null
          cfop_snapshot?: string | null
          created_at?: string
          csosn_icms?: string | null
          cst_cofins?: string | null
          cst_icms?: string | null
          cst_pis?: string | null
          id?: string
          ncm_snapshot?: string | null
          origem_mercadoria?: number | null
          product_name?: string
          quantity?: number
          sale_id?: string
          size?: string | null
          sku?: string | null
          tiny_product_id?: string | null
          total_price?: number
          unidade_comercial?: string | null
          unit_price?: number
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          appmax_order_id: string | null
          cash_register_id: string | null
          checkout_step: number | null
          conditional_signed_at: string | null
          conditional_status: string | null
          created_at: string
          crediario_due_date: string | null
          crediario_gateway: string | null
          crediario_paid_amount: number | null
          crediario_paid_at: string | null
          crediario_paid_method: string | null
          crediario_status: string | null
          customer_cep: string | null
          customer_city: string | null
          customer_cpf: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_state: string | null
          customer_unified_id: string | null
          discount: number
          event_id: string | null
          expedition_status: string
          external_order_id: string | null
          external_source: string | null
          id: string
          invoice_number: string | null
          invoice_pdf_url: string | null
          is_conditional: boolean
          mercadopago_payment_id: string | null
          motivo_cancelamento:
            | Database["public"]["Enums"]["pedido_motivo_cancelamento"]
            | null
          mp_account_id: string | null
          nfce_key: string | null
          nfce_number: string | null
          nfce_pdf_url: string | null
          notes: string | null
          pagarme_order_id: string | null
          paid_at: string | null
          payment_details: Json | null
          payment_gateway: string | null
          payment_link: string | null
          payment_method: string | null
          payment_method_detail: string | null
          revenue_attribution: Database["public"]["Enums"]["pos_revenue_attribution"]
          sale_type: string
          seller_id: string | null
          shipped_at: string | null
          shipping_address: Json | null
          shipping_cost: number
          shipping_notes: string | null
          source_order_id: string | null
          status: string
          status_cancelamento: Database["public"]["Enums"]["pedido_status_cancelamento"]
          stock_source_store_id: string | null
          store_id: string
          subtotal: number
          tiny_invoice_id: string | null
          tiny_order_id: string | null
          tiny_order_number: string | null
          total: number
          tracking_carrier: string | null
          tracking_code: string | null
          updated_at: string
          vindi_transaction_id: string | null
        }
        Insert: {
          appmax_order_id?: string | null
          cash_register_id?: string | null
          checkout_step?: number | null
          conditional_signed_at?: string | null
          conditional_status?: string | null
          created_at?: string
          crediario_due_date?: string | null
          crediario_gateway?: string | null
          crediario_paid_amount?: number | null
          crediario_paid_at?: string | null
          crediario_paid_method?: string | null
          crediario_status?: string | null
          customer_cep?: string | null
          customer_city?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_unified_id?: string | null
          discount?: number
          event_id?: string | null
          expedition_status?: string
          external_order_id?: string | null
          external_source?: string | null
          id?: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          is_conditional?: boolean
          mercadopago_payment_id?: string | null
          motivo_cancelamento?:
            | Database["public"]["Enums"]["pedido_motivo_cancelamento"]
            | null
          mp_account_id?: string | null
          nfce_key?: string | null
          nfce_number?: string | null
          nfce_pdf_url?: string | null
          notes?: string | null
          pagarme_order_id?: string | null
          paid_at?: string | null
          payment_details?: Json | null
          payment_gateway?: string | null
          payment_link?: string | null
          payment_method?: string | null
          payment_method_detail?: string | null
          revenue_attribution?: Database["public"]["Enums"]["pos_revenue_attribution"]
          sale_type?: string
          seller_id?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          shipping_cost?: number
          shipping_notes?: string | null
          source_order_id?: string | null
          status?: string
          status_cancelamento?: Database["public"]["Enums"]["pedido_status_cancelamento"]
          stock_source_store_id?: string | null
          store_id: string
          subtotal?: number
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
          tiny_order_number?: string | null
          total?: number
          tracking_carrier?: string | null
          tracking_code?: string | null
          updated_at?: string
          vindi_transaction_id?: string | null
        }
        Update: {
          appmax_order_id?: string | null
          cash_register_id?: string | null
          checkout_step?: number | null
          conditional_signed_at?: string | null
          conditional_status?: string | null
          created_at?: string
          crediario_due_date?: string | null
          crediario_gateway?: string | null
          crediario_paid_amount?: number | null
          crediario_paid_at?: string | null
          crediario_paid_method?: string | null
          crediario_status?: string | null
          customer_cep?: string | null
          customer_city?: string | null
          customer_cpf?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_unified_id?: string | null
          discount?: number
          event_id?: string | null
          expedition_status?: string
          external_order_id?: string | null
          external_source?: string | null
          id?: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          is_conditional?: boolean
          mercadopago_payment_id?: string | null
          motivo_cancelamento?:
            | Database["public"]["Enums"]["pedido_motivo_cancelamento"]
            | null
          mp_account_id?: string | null
          nfce_key?: string | null
          nfce_number?: string | null
          nfce_pdf_url?: string | null
          notes?: string | null
          pagarme_order_id?: string | null
          paid_at?: string | null
          payment_details?: Json | null
          payment_gateway?: string | null
          payment_link?: string | null
          payment_method?: string | null
          payment_method_detail?: string | null
          revenue_attribution?: Database["public"]["Enums"]["pos_revenue_attribution"]
          sale_type?: string
          seller_id?: string | null
          shipped_at?: string | null
          shipping_address?: Json | null
          shipping_cost?: number
          shipping_notes?: string | null
          source_order_id?: string | null
          status?: string
          status_cancelamento?: Database["public"]["Enums"]["pedido_status_cancelamento"]
          stock_source_store_id?: string | null
          store_id?: string
          subtotal?: number
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
          tiny_order_number?: string | null
          total?: number
          tracking_carrier?: string | null
          tracking_code?: string | null
          updated_at?: string
          vindi_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_sales_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "pos_cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_customer_unified_id_fkey"
            columns: ["customer_unified_id"]
            isOneToOne: false
            referencedRelation: "crm_customers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_customer_unified_id_fkey"
            columns: ["customer_unified_id"]
            isOneToOne: false
            referencedRelation: "customers_unified"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_mp_account_id_fkey"
            columns: ["mp_account_id"]
            isOneToOne: false
            referencedRelation: "mercadopago_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_stock_source_store_id_fkey"
            columns: ["stock_source_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_seller_commission_tiers: {
        Row: {
          achievement_percent: number | null
          commission_percent: number
          created_at: string
          goal_value: number | null
          id: string
          is_active: boolean
          max_revenue: number | null
          min_revenue: number
          period: string
          period_end: string | null
          period_start: string | null
          store_id: string
          tier_order: number
          updated_at: string
        }
        Insert: {
          achievement_percent?: number | null
          commission_percent?: number
          created_at?: string
          goal_value?: number | null
          id?: string
          is_active?: boolean
          max_revenue?: number | null
          min_revenue?: number
          period?: string
          period_end?: string | null
          period_start?: string | null
          store_id: string
          tier_order?: number
          updated_at?: string
        }
        Update: {
          achievement_percent?: number | null
          commission_percent?: number
          created_at?: string
          goal_value?: number | null
          id?: string
          is_active?: boolean
          max_revenue?: number | null
          min_revenue?: number
          period?: string
          period_end?: string | null
          period_start?: string | null
          store_id?: string
          tier_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_seller_commission_tiers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_seller_commissions: {
        Row: {
          bonus_value: number
          commission_percent: number
          commission_value: number
          created_at: string
          id: string
          period_end: string
          period_start: string
          seller_id: string
          status: string
          store_id: string
          tier_id: string | null
          total_revenue: number
        }
        Insert: {
          bonus_value?: number
          commission_percent?: number
          commission_value?: number
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          seller_id: string
          status?: string
          store_id: string
          tier_id?: string | null
          total_revenue?: number
        }
        Update: {
          bonus_value?: number
          commission_percent?: number
          commission_value?: number
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          seller_id?: string
          status?: string
          store_id?: string
          tier_id?: string | null
          total_revenue?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_seller_commissions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_seller_commissions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_seller_commissions_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "pos_seller_commission_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_seller_task_instances: {
        Row: {
          completed_at: string | null
          completion_mode: string | null
          created_at: string
          definition_id: string
          due_date: string
          id: string
          payload: Json
          progress_current: number
          progress_target: number
          seller_id: string
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completion_mode?: string | null
          created_at?: string
          definition_id: string
          due_date?: string
          id?: string
          payload?: Json
          progress_current?: number
          progress_target?: number
          seller_id: string
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completion_mode?: string | null
          created_at?: string
          definition_id?: string
          due_date?: string
          id?: string
          payload?: Json
          progress_current?: number
          progress_target?: number
          seller_id?: string
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_seller_task_instances_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "pos_task_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_seller_tasks: {
        Row: {
          avg_ticket: number | null
          completed_at: string | null
          completed_by_seller_id: string | null
          completion_notes: string | null
          contact_strategy: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          description: string | null
          due_date: string | null
          id: string
          offer_description: string | null
          points_reward: number
          rfm_segment: string | null
          seller_id: string
          source: string
          status: string
          store_id: string
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          avg_ticket?: number | null
          completed_at?: string | null
          completed_by_seller_id?: string | null
          completion_notes?: string | null
          contact_strategy?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          offer_description?: string | null
          points_reward?: number
          rfm_segment?: string | null
          seller_id: string
          source?: string
          status?: string
          store_id: string
          task_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          avg_ticket?: number | null
          completed_at?: string | null
          completed_by_seller_id?: string | null
          completion_notes?: string | null
          contact_strategy?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          offer_description?: string | null
          points_reward?: number
          rfm_segment?: string | null
          seller_id?: string
          source?: string
          status?: string
          store_id?: string
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_seller_tasks_completed_by_seller_id_fkey"
            columns: ["completed_by_seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_seller_tasks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sellers: {
        Row: {
          created_at: string
          excluded_from_tasks: boolean
          id: string
          is_active: boolean
          is_manager: boolean
          linked_user_id: string | null
          name: string
          pin_code: string | null
          store_id: string | null
          tiny_seller_id: string | null
          updated_at: string
          whatsapp_phone: string | null
        }
        Insert: {
          created_at?: string
          excluded_from_tasks?: boolean
          id?: string
          is_active?: boolean
          is_manager?: boolean
          linked_user_id?: string | null
          name: string
          pin_code?: string | null
          store_id?: string | null
          tiny_seller_id?: string | null
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Update: {
          created_at?: string
          excluded_from_tasks?: boolean
          id?: string
          is_active?: boolean
          is_manager?: boolean
          linked_user_id?: string | null
          name?: string
          pin_code?: string | null
          store_id?: string | null
          tiny_seller_id?: string | null
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_sellers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_site_exchanges: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          exchange_reason: string | null
          id: string
          new_pos_sale_id: string | null
          original_items: Json
          original_pos_sale_id: string | null
          seller_id: string | null
          shopify_order_id: string
          shopify_order_name: string | null
          status: string
          step_status: Json
          store_id: string | null
          updated_at: string
          zeroed_barcodes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          exchange_reason?: string | null
          id?: string
          new_pos_sale_id?: string | null
          original_items?: Json
          original_pos_sale_id?: string | null
          seller_id?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
          status?: string
          step_status?: Json
          store_id?: string | null
          updated_at?: string
          zeroed_barcodes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          exchange_reason?: string | null
          id?: string
          new_pos_sale_id?: string | null
          original_items?: Json
          original_pos_sale_id?: string | null
          seller_id?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          status?: string
          step_status?: Json
          store_id?: string | null
          updated_at?: string
          zeroed_barcodes?: string[]
        }
        Relationships: []
      }
      pos_stock_adjustments: {
        Row: {
          barcode: string | null
          count_id: string | null
          created_at: string | null
          direction: string
          exchange_id: string | null
          exchange_number: string | null
          id: string
          movement_type: string | null
          new_stock: number | null
          previous_stock: number | null
          product_id: string | null
          product_name: string
          quantity: number
          reason: string | null
          sale_event: string | null
          sale_id: string | null
          seller_id: string | null
          seller_name: string | null
          sku: string | null
          store_id: string
          tiny_id: number | null
          tiny_mirror_status: string | null
          tiny_mirrored_at: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          barcode?: string | null
          count_id?: string | null
          created_at?: string | null
          direction: string
          exchange_id?: string | null
          exchange_number?: string | null
          id?: string
          movement_type?: string | null
          new_stock?: number | null
          previous_stock?: number | null
          product_id?: string | null
          product_name: string
          quantity: number
          reason?: string | null
          sale_event?: string | null
          sale_id?: string | null
          seller_id?: string | null
          seller_name?: string | null
          sku?: string | null
          store_id: string
          tiny_id?: number | null
          tiny_mirror_status?: string | null
          tiny_mirrored_at?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          barcode?: string | null
          count_id?: string | null
          created_at?: string | null
          direction?: string
          exchange_id?: string | null
          exchange_number?: string | null
          id?: string
          movement_type?: string | null
          new_stock?: number | null
          previous_stock?: number | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          reason?: string | null
          sale_event?: string | null
          sale_id?: string | null
          seller_id?: string | null
          seller_name?: string | null
          sku?: string | null
          store_id?: string
          tiny_id?: number | null
          tiny_mirror_status?: string | null
          tiny_mirrored_at?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_stock_adjustments_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_stock_adjustments_exchange_id_fkey"
            columns: ["exchange_id"]
            isOneToOne: false
            referencedRelation: "trocas_devolucoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "pos_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_a1_orphan_pos_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_stock_adjustments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_stock_adjustments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_stock_adjustments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_store_sellers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          seller_id: string
          seller_name: string
          store_id: string
          tiny_seller_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          seller_id: string
          seller_name: string
          store_id: string
          tiny_seller_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          seller_id?: string
          seller_name?: string
          store_id?: string
          tiny_seller_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_store_sellers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_store_whatsapp_numbers: {
        Row: {
          created_at: string
          id: string
          store_id: string
          whatsapp_number_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          store_id: string
          whatsapp_number_id: string
        }
        Update: {
          created_at?: string
          id?: string
          store_id?: string
          whatsapp_number_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_store_whatsapp_numbers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_store_whatsapp_numbers_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_store_whatsapp_numbers_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_stores: {
        Row: {
          address: string | null
          company_id: string | null
          created_at: string
          disable_tiny_orders: boolean
          has_tiny_token: boolean | null
          id: string
          is_active: boolean
          is_simulation: boolean
          name: string
          revenue_target: number | null
          tiny_deposit_name: string | null
          tiny_token: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          disable_tiny_orders?: boolean
          has_tiny_token?: boolean | null
          id?: string
          is_active?: boolean
          is_simulation?: boolean
          name: string
          revenue_target?: number | null
          tiny_deposit_name?: string | null
          tiny_token?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string | null
          created_at?: string
          disable_tiny_orders?: boolean
          has_tiny_token?: boolean | null
          id?: string
          is_active?: boolean
          is_simulation?: boolean
          name?: string
          revenue_target?: number | null
          tiny_deposit_name?: string | null
          tiny_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_stores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_task_contacts: {
        Row: {
          contacted: boolean
          contacted_at: string | null
          created_at: string
          customer_meta: Json
          customer_name: string | null
          customer_phone: string | null
          id: string
          instance_id: string
        }
        Insert: {
          contacted?: boolean
          contacted_at?: string | null
          created_at?: string
          customer_meta?: Json
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          instance_id: string
        }
        Update: {
          contacted?: boolean
          contacted_at?: string | null
          created_at?: string
          customer_meta?: Json
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_task_contacts_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "pos_seller_task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_task_definitions: {
        Row: {
          assigned_seller_ids: string[]
          assignment: string
          auto_config: Json
          category: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          points_reward: number
          recurrence: string
          recurrence_config: Json
          store_id: string
          target_count: number
          title: string
          updated_at: string
          verification_mode: string
        }
        Insert: {
          assigned_seller_ids?: string[]
          assignment?: string
          auto_config?: Json
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          points_reward?: number
          recurrence?: string
          recurrence_config?: Json
          store_id: string
          target_count?: number
          title: string
          updated_at?: string
          verification_mode?: string
        }
        Update: {
          assigned_seller_ids?: string[]
          assignment?: string
          auto_config?: Json
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          points_reward?: number
          recurrence?: string
          recurrence_config?: Json
          store_id?: string
          target_count?: number
          title?: string
          updated_at?: string
          verification_mode?: string
        }
        Relationships: []
      }
      pos_task_dispatch_schedules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_run_at: string | null
          name: string | null
          send_times: string[]
          store_id: string
          target: string
          template_language: string
          template_name: string
          template_variables: Json
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string | null
          send_times?: string[]
          store_id: string
          target?: string
          template_language?: string
          template_name: string
          template_variables?: Json
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string | null
          send_times?: string[]
          store_id?: string
          target?: string
          template_language?: string
          template_name?: string
          template_variables?: Json
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      price_tiers: {
        Row: {
          color: string
          created_at: string
          id: string
          label: string
          max_price: number | null
          min_price: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          label: string
          max_price?: number | null
          min_price?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          label?: string
          max_price?: number | null
          min_price?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      prize_wheel_segments: {
        Row: {
          color: string
          created_at: string
          expiry_days: number
          id: string
          is_active: boolean
          label: string
          prize_type: string
          prize_value: number
          probability: number
          sort_order: number
          store_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          expiry_days?: number
          id?: string
          is_active?: boolean
          label: string
          prize_type?: string
          prize_value?: number
          probability?: number
          sort_order?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          expiry_days?: number
          id?: string
          is_active?: boolean
          label?: string
          prize_type?: string
          prize_value?: number
          probability?: number
          sort_order?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prize_wheel_segments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_capture_items: {
        Row: {
          barcode: string
          color: string | null
          cost_price: number | null
          created_at: string
          id: string
          parent_code: string
          price: number
          product_name: string
          quantity: number
          reference_code: string | null
          session_id: string
          size: string | null
          tiny_product_id: number | null
        }
        Insert: {
          barcode: string
          color?: string | null
          cost_price?: number | null
          created_at?: string
          id?: string
          parent_code: string
          price?: number
          product_name: string
          quantity?: number
          reference_code?: string | null
          session_id: string
          size?: string | null
          tiny_product_id?: number | null
        }
        Update: {
          barcode?: string
          color?: string | null
          cost_price?: number | null
          created_at?: string
          id?: string
          parent_code?: string
          price?: number
          product_name?: string
          quantity?: number
          reference_code?: string | null
          session_id?: string
          size?: string | null
          tiny_product_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_capture_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "product_capture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      product_capture_sessions: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_capture_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          default_gender: string | null
          default_height_cm: number | null
          default_length_cm: number | null
          default_weight_kg: number | null
          default_width_cm: number | null
          id: string
          is_active: boolean
          keywords: string[]
          name: string
          priority: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_gender?: string | null
          default_height_cm?: number | null
          default_length_cm?: number | null
          default_weight_kg?: number | null
          default_width_cm?: number | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          name: string
          priority?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_gender?: string | null
          default_height_cm?: number | null
          default_length_cm?: number | null
          default_weight_kg?: number | null
          default_width_cm?: number | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          name?: string
          priority?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_colors: {
        Row: {
          created_at: string
          hex: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hex?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hex?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_dedup_index: {
        Row: {
          created_at: string
          dedupe_key: string
          dedupe_method: string
          id: string
          imported_at: string | null
          representative_category: string | null
          representative_name: string | null
          representative_pos_product_id: string | null
          stores_present: string[]
          tiny_ids_per_store: Json
          updated_at: string
          validation_status: string | null
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          dedupe_method: string
          id?: string
          imported_at?: string | null
          representative_category?: string | null
          representative_name?: string | null
          representative_pos_product_id?: string | null
          stores_present?: string[]
          tiny_ids_per_store?: Json
          updated_at?: string
          validation_status?: string | null
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          dedupe_method?: string
          id?: string
          imported_at?: string | null
          representative_category?: string | null
          representative_name?: string | null
          representative_pos_product_id?: string | null
          stores_present?: string[]
          tiny_ids_per_store?: Json
          updated_at?: string
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_dedup_index_representative_pos_product_id_fkey"
            columns: ["representative_pos_product_id"]
            isOneToOne: false
            referencedRelation: "pos_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_dedup_index_representative_pos_product_id_fkey"
            columns: ["representative_pos_product_id"]
            isOneToOne: false
            referencedRelation: "v_a1_orphan_pos_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_master_data: {
        Row: {
          brand: string | null
          brand_id: string | null
          category: string | null
          category_id: string | null
          cest: string | null
          cfop: string | null
          classe_produto: string | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          description: string | null
          height_cm: number | null
          images: string[] | null
          is_active: boolean
          length_cm: number | null
          markup: number | null
          name: string
          ncm: string | null
          needs_review: boolean | null
          origem: string | null
          parent_sku: string
          review_reason: string | null
          sale_price: number | null
          shopify_product_id: string | null
          tiny_product_id: string | null
          unidade: string | null
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          brand?: string | null
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          cest?: string | null
          cfop?: string | null
          classe_produto?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          height_cm?: number | null
          images?: string[] | null
          is_active?: boolean
          length_cm?: number | null
          markup?: number | null
          name: string
          ncm?: string | null
          needs_review?: boolean | null
          origem?: string | null
          parent_sku: string
          review_reason?: string | null
          sale_price?: number | null
          shopify_product_id?: string | null
          tiny_product_id?: string | null
          unidade?: string | null
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          brand?: string | null
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          cest?: string | null
          cfop?: string | null
          classe_produto?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          height_cm?: number | null
          images?: string[] | null
          is_active?: boolean
          length_cm?: number | null
          markup?: number | null
          name?: string
          ncm?: string | null
          needs_review?: boolean | null
          origem?: string | null
          parent_sku?: string
          review_reason?: string | null
          sale_price?: number | null
          shopify_product_id?: string | null
          tiny_product_id?: string | null
          unidade?: string | null
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_master_data_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_master_data_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sizes: {
        Row: {
          created_at: string
          id: string
          label: string
          numeric_value: number | null
          size_group: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          numeric_value?: number | null
          size_group?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          numeric_value?: number | null
          size_group?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          movement_type: string
          notes: string | null
          purchase_invoice_id: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          store_id: string | null
          unit_cost: number | null
          variant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: string
          notes?: string | null
          purchase_invoice_id?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          store_id?: string | null
          unit_cost?: number | null
          variant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: string
          notes?: string | null
          purchase_invoice_id?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          store_id?: string | null
          unit_cost?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_stock_mov_invoice"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_movements_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variant_stock"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "product_stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string | null
          color_id: string | null
          cost_price_override: number | null
          created_at: string
          gtin: string | null
          id: string
          initial_stock: number | null
          is_active: boolean
          last_sync_source: string | null
          master_id: string
          sale_price_override: number | null
          shopify_variant_id: string | null
          size: string | null
          size_id: string | null
          sku: string
          tiny_imported_at: string | null
          tiny_variant_id: string | null
          updated_at: string
          weight_kg_override: number | null
        }
        Insert: {
          color?: string | null
          color_id?: string | null
          cost_price_override?: number | null
          created_at?: string
          gtin?: string | null
          id?: string
          initial_stock?: number | null
          is_active?: boolean
          last_sync_source?: string | null
          master_id: string
          sale_price_override?: number | null
          shopify_variant_id?: string | null
          size?: string | null
          size_id?: string | null
          sku: string
          tiny_imported_at?: string | null
          tiny_variant_id?: string | null
          updated_at?: string
          weight_kg_override?: number | null
        }
        Update: {
          color?: string | null
          color_id?: string | null
          cost_price_override?: number | null
          created_at?: string
          gtin?: string | null
          id?: string
          initial_stock?: number | null
          is_active?: boolean
          last_sync_source?: string | null
          master_id?: string
          sale_price_override?: number | null
          shopify_variant_id?: string | null
          size?: string | null
          size_id?: string | null
          sku?: string
          tiny_imported_at?: string | null
          tiny_variant_id?: string | null
          updated_at?: string
          weight_kg_override?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_color_id_fkey"
            columns: ["color_id"]
            isOneToOne: false
            referencedRelation: "product_colors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "products_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_size_id_fkey"
            columns: ["size_id"]
            isOneToOne: false
            referencedRelation: "product_sizes"
            referencedColumns: ["id"]
          },
        ]
      }
      product_visual_tags: {
        Row: {
          ai_description: string | null
          analyzed_image_urls: string[]
          created_at: string
          id: string
          last_analyzed_at: string
          product_title: string
          shopify_product_id: string
          updated_at: string
          visual_tags: string[]
        }
        Insert: {
          ai_description?: string | null
          analyzed_image_urls?: string[]
          created_at?: string
          id?: string
          last_analyzed_at?: string
          product_title: string
          shopify_product_id: string
          updated_at?: string
          visual_tags?: string[]
        }
        Update: {
          ai_description?: string | null
          analyzed_image_urls?: string[]
          created_at?: string
          id?: string
          last_analyzed_at?: string
          product_title?: string
          shopify_product_id?: string
          updated_at?: string
          visual_tags?: string[]
        }
        Relationships: []
      }
      product_wait_notifications: {
        Row: {
          arrived_at: string | null
          barcode: string | null
          color: string | null
          created_at: string
          customer_name: string | null
          id: string
          image_url: string | null
          matched_pos_product_id: string | null
          notes: string | null
          notified_at: string | null
          parent_sku: string | null
          phone: string
          pos_product_id: string | null
          product_name: string
          requested_by_name: string | null
          requested_by_user_id: string | null
          size: string | null
          status: string
          store_id: string | null
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          arrived_at?: string | null
          barcode?: string | null
          color?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          image_url?: string | null
          matched_pos_product_id?: string | null
          notes?: string | null
          notified_at?: string | null
          parent_sku?: string | null
          phone: string
          pos_product_id?: string | null
          product_name: string
          requested_by_name?: string | null
          requested_by_user_id?: string | null
          size?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          arrived_at?: string | null
          barcode?: string | null
          color?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          image_url?: string | null
          matched_pos_product_id?: string | null
          notes?: string | null
          notified_at?: string | null
          parent_sku?: string | null
          phone?: string
          pos_product_id?: string | null
          product_name?: string
          requested_by_name?: string | null
          requested_by_user_id?: string | null
          size?: string | null
          status?: string
          store_id?: string | null
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      products_master: {
        Row: {
          age_group: string | null
          auto_classified: boolean
          brand: string | null
          brand_id: string | null
          category: string | null
          category_id: string | null
          cest: string | null
          classe_produto: string | null
          classification_confidence: number | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          description: string | null
          gender: string | null
          height_cm: number | null
          id: string
          images: string[] | null
          is_active: boolean
          length_cm: number | null
          name: string
          ncm: string | null
          needs_review: boolean
          origem: string | null
          price_tier_id: string | null
          review_reason: string | null
          sale_price: number | null
          shopify_product_id: string | null
          sku_root: string
          tiny_imported_at: string | null
          tiny_product_id: string | null
          tiny_source_store_id: string | null
          unidade: string | null
          updated_at: string
          weight_kg: number | null
          width_cm: number | null
        }
        Insert: {
          age_group?: string | null
          auto_classified?: boolean
          brand?: string | null
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          cest?: string | null
          classe_produto?: string | null
          classification_confidence?: number | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          gender?: string | null
          height_cm?: number | null
          id?: string
          images?: string[] | null
          is_active?: boolean
          length_cm?: number | null
          name: string
          ncm?: string | null
          needs_review?: boolean
          origem?: string | null
          price_tier_id?: string | null
          review_reason?: string | null
          sale_price?: number | null
          shopify_product_id?: string | null
          sku_root?: string
          tiny_imported_at?: string | null
          tiny_product_id?: string | null
          tiny_source_store_id?: string | null
          unidade?: string | null
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Update: {
          age_group?: string | null
          auto_classified?: boolean
          brand?: string | null
          brand_id?: string | null
          category?: string | null
          category_id?: string | null
          cest?: string | null
          classe_produto?: string | null
          classification_confidence?: number | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          gender?: string | null
          height_cm?: number | null
          id?: string
          images?: string[] | null
          is_active?: boolean
          length_cm?: number | null
          name?: string
          ncm?: string | null
          needs_review?: boolean
          origem?: string | null
          price_tier_id?: string | null
          review_reason?: string | null
          sale_price?: number | null
          shopify_product_id?: string | null
          sku_root?: string
          tiny_imported_at?: string | null
          tiny_product_id?: string | null
          tiny_source_store_id?: string | null
          unidade?: string | null
          updated_at?: string
          weight_kg?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_master_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "product_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_master_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_master_price_tier_id_fkey"
            columns: ["price_tier_id"]
            isOneToOne: false
            referencedRelation: "price_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_master_tiny_source_store_id_fkey"
            columns: ["tiny_source_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_costs: {
        Row: {
          category: string
          cost_per_message_brl: number
          created_at: string
          notes: string | null
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          cost_per_message_brl?: number
          created_at?: string
          notes?: string | null
          provider: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          cost_per_message_brl?: number
          created_at?: string
          notes?: string | null
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      provider_payments: {
        Row: {
          cash_register_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          paid_at: string
          paid_store_id: string | null
          proof_file_url: string | null
          provider_id: string
          receipt_pdf_url: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          cash_register_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          paid_store_id?: string | null
          proof_file_url?: string | null
          provider_id: string
          receipt_pdf_url?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          cash_register_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          paid_store_id?: string | null
          proof_file_url?: string | null
          provider_id?: string
          receipt_pdf_url?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_payments_cash_register_id_fkey"
            columns: ["cash_register_id"]
            isOneToOne: false
            referencedRelation: "pos_cash_registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_payments_paid_store_id_fkey"
            columns: ["paid_store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_payments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "service_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoice_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          installment_number: number
          invoice_id: string
          paid: boolean
          paid_amount: number | null
          paid_at: string | null
          payment_notes: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          installment_number?: number
          invoice_id: string
          paid?: boolean
          paid_amount?: number | null
          paid_at?: string | null
          payment_notes?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          invoice_id?: string
          paid?: boolean
          paid_amount?: number | null
          paid_at?: string | null
          payment_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_installments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoice_items: {
        Row: {
          cfop: string | null
          created_at: string
          description: string
          ean: string | null
          id: string
          invoice_id: string
          line_number: number | null
          linked_at: string | null
          linked_parent_sku: string | null
          linked_store_id: string | null
          master_id: string | null
          ncm: string | null
          parsed_color: string | null
          parsed_size: string | null
          quantity: number
          raw_data: Json | null
          supplier_product_code: string | null
          total_cost: number
          unit: string | null
          unit_cost: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          cfop?: string | null
          created_at?: string
          description: string
          ean?: string | null
          id?: string
          invoice_id: string
          line_number?: number | null
          linked_at?: string | null
          linked_parent_sku?: string | null
          linked_store_id?: string | null
          master_id?: string | null
          ncm?: string | null
          parsed_color?: string | null
          parsed_size?: string | null
          quantity?: number
          raw_data?: Json | null
          supplier_product_code?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          cfop?: string | null
          created_at?: string
          description?: string
          ean?: string | null
          id?: string
          invoice_id?: string
          line_number?: number | null
          linked_at?: string | null
          linked_parent_sku?: string | null
          linked_store_id?: string | null
          master_id?: string | null
          ncm?: string | null
          parsed_color?: string | null
          parsed_size?: string | null
          quantity?: number
          raw_data?: Json | null
          supplier_product_code?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "products_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variant_stock"
            referencedColumns: ["variant_id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          emission_date: string | null
          id: string
          invoice_number: string | null
          invoice_series: string | null
          nfe_key: string | null
          notes: string | null
          parsed_data: Json | null
          payment_method: string | null
          raw_xml: string | null
          status: string
          store_id: string | null
          supplier_address: Json | null
          supplier_cnpj: string | null
          supplier_ie: string | null
          supplier_name: string | null
          total_discount: number | null
          total_freight: number | null
          total_products: number | null
          total_taxes: number | null
          total_value: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          emission_date?: string | null
          id?: string
          invoice_number?: string | null
          invoice_series?: string | null
          nfe_key?: string | null
          notes?: string | null
          parsed_data?: Json | null
          payment_method?: string | null
          raw_xml?: string | null
          status?: string
          store_id?: string | null
          supplier_address?: Json | null
          supplier_cnpj?: string | null
          supplier_ie?: string | null
          supplier_name?: string | null
          total_discount?: number | null
          total_freight?: number | null
          total_products?: number | null
          total_taxes?: number | null
          total_value?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          emission_date?: string | null
          id?: string
          invoice_number?: string | null
          invoice_series?: string | null
          nfe_key?: string | null
          notes?: string | null
          parsed_data?: Json | null
          payment_method?: string | null
          raw_xml?: string | null
          status?: string
          store_id?: string | null
          supplier_address?: Json | null
          supplier_cnpj?: string | null
          supplier_ie?: string | null
          supplier_name?: string | null
          total_discount?: number | null
          total_freight?: number | null
          total_products?: number | null
          total_taxes?: number | null
          total_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notification_log: {
        Row: {
          body: string | null
          click_url: string | null
          created_at: string
          failed_count: number | null
          id: string
          image_url: string | null
          sent_by: string | null
          sent_count: number | null
          title: string
        }
        Insert: {
          body?: string | null
          click_url?: string | null
          created_at?: string
          failed_count?: number | null
          id?: string
          image_url?: string | null
          sent_by?: string | null
          sent_count?: number | null
          title: string
        }
        Update: {
          body?: string | null
          click_url?: string | null
          created_at?: string
          failed_count?: number | null
          id?: string
          image_url?: string | null
          sent_by?: string | null
          sent_count?: number | null
          title?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          campaign_tag: string | null
          created_at: string
          endpoint: string
          id: string
          keys_auth: string
          keys_p256dh: string
          lead_name: string | null
          lead_phone: string | null
          user_agent: string | null
        }
        Insert: {
          campaign_tag?: string | null
          created_at?: string
          endpoint: string
          id?: string
          keys_auth: string
          keys_p256dh: string
          lead_name?: string | null
          lead_phone?: string | null
          user_agent?: string | null
        }
        Update: {
          campaign_tag?: string | null
          created_at?: string
          endpoint?: string
          id?: string
          keys_auth?: string
          keys_p256dh?: string
          lead_name?: string | null
          lead_phone?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          folder_id: string | null
          id: string
          message: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          message: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          message?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "quick_reply_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_reply_folders: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_reply_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "quick_reply_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      ravena_customers: {
        Row: {
          avg_ticket: number | null
          city: string | null
          created_at: string
          ddd: string | null
          email: string | null
          first_purchase_at: string | null
          id: string
          is_active: boolean
          last_purchase_at: string | null
          name: string | null
          phone: string
          region: string | null
          rfm_f: number | null
          rfm_m: number | null
          rfm_r: number | null
          rfm_segment: string | null
          rfm_total: number | null
          seller: string | null
          state: string | null
          store: string | null
          tags: string[] | null
          total_orders: number | null
          total_spent: number | null
          updated_at: string
        }
        Insert: {
          avg_ticket?: number | null
          city?: string | null
          created_at?: string
          ddd?: string | null
          email?: string | null
          first_purchase_at?: string | null
          id?: string
          is_active?: boolean
          last_purchase_at?: string | null
          name?: string | null
          phone: string
          region?: string | null
          rfm_f?: number | null
          rfm_m?: number | null
          rfm_r?: number | null
          rfm_segment?: string | null
          rfm_total?: number | null
          seller?: string | null
          state?: string | null
          store?: string | null
          tags?: string[] | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string
        }
        Update: {
          avg_ticket?: number | null
          city?: string | null
          created_at?: string
          ddd?: string | null
          email?: string | null
          first_purchase_at?: string | null
          id?: string
          is_active?: boolean
          last_purchase_at?: string | null
          name?: string | null
          phone?: string
          region?: string | null
          rfm_f?: number | null
          rfm_m?: number | null
          rfm_r?: number | null
          rfm_segment?: string | null
          rfm_total?: number | null
          seller?: string | null
          state?: string | null
          store?: string | null
          tags?: string[] | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          coupon_code: string
          coupon_expires_at: string
          coupon_redeemed_at: string | null
          coupon_value: number
          created_at: string
          friend_contacted_at: string | null
          friend_name: string
          friend_phone: string
          id: string
          message_sent_at: string | null
          redeemed_in_sale_id: string | null
          review_token_id: string
          status: string
          updated_at: string
        }
        Insert: {
          coupon_code: string
          coupon_expires_at?: string
          coupon_redeemed_at?: string | null
          coupon_value?: number
          created_at?: string
          friend_contacted_at?: string | null
          friend_name: string
          friend_phone: string
          id?: string
          message_sent_at?: string | null
          redeemed_in_sale_id?: string | null
          review_token_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          coupon_code?: string
          coupon_expires_at?: string
          coupon_redeemed_at?: string | null
          coupon_value?: number
          created_at?: string
          friend_contacted_at?: string | null
          friend_name?: string
          friend_phone?: string
          id?: string
          message_sent_at?: string | null
          redeemed_in_sale_id?: string | null
          review_token_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_review_token_id_fkey"
            columns: ["review_token_id"]
            isOneToOne: false
            referencedRelation: "review_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      review_tokens: {
        Row: {
          cashback_doubled: boolean
          cashback_doubled_at: string | null
          cashback_value: number | null
          created_at: string
          customer_name: string | null
          customer_phone: string
          customer_zoppy_id: string | null
          expires_at: string
          id: string
          improvement_suggestion: string | null
          nps_score: number | null
          review_comment: string | null
          review_submitted_at: string | null
          store_id: string | null
          store_phone: string | null
          token: string
          updated_at: string
        }
        Insert: {
          cashback_doubled?: boolean
          cashback_doubled_at?: string | null
          cashback_value?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone: string
          customer_zoppy_id?: string | null
          expires_at?: string
          id?: string
          improvement_suggestion?: string | null
          nps_score?: number | null
          review_comment?: string | null
          review_submitted_at?: string | null
          store_id?: string | null
          store_phone?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          cashback_doubled?: boolean
          cashback_doubled_at?: string | null
          cashback_value?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string
          customer_zoppy_id?: string | null
          expires_at?: string
          id?: string
          improvement_suggestion?: string | null
          nps_score?: number | null
          review_comment?: string | null
          review_submitted_at?: string | null
          store_id?: string | null
          store_phone?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_tokens_customer_zoppy_id_fkey"
            columns: ["customer_zoppy_id"]
            isOneToOne: false
            referencedRelation: "zoppy_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_tokens_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_triggers: {
        Row: {
          ad_campaign_id: string | null
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          keywords: string[]
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          ad_campaign_id?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          ad_campaign_id?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_triggers_ad_campaign_id_fkey"
            columns: ["ad_campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns_ai"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          message: string
          phone: string
          scheduled_at: string
          sent_at: string | null
          status: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          message: string
          phone: string
          scheduled_at: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          message?: string
          phone?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      secretary_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role?: string
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      secretary_reminders: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          is_completed: boolean
          last_reminded_at: string | null
          metadata: Json | null
          phone: string
          remind_at: string | null
          reminder_type: string
          title: string
          updated_at: string
          user_id: string
          whatsapp_number_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_completed?: boolean
          last_reminded_at?: string | null
          metadata?: Json | null
          phone: string
          remind_at?: string | null
          reminder_type?: string
          title: string
          updated_at?: string
          user_id: string
          whatsapp_number_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_completed?: boolean
          last_reminded_at?: string | null
          metadata?: Json | null
          phone?: string
          remind_at?: string | null
          reminder_type?: string
          title?: string
          updated_at?: string
          user_id?: string
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      secretary_settings: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          reminder_phone: string | null
          updated_at: string
          user_id: string
          weekly_reminder_day: number | null
          weekly_reminder_hour: number | null
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          reminder_phone?: string | null
          updated_at?: string
          user_id: string
          weekly_reminder_day?: number | null
          weekly_reminder_hour?: number | null
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          reminder_phone?: string | null
          updated_at?: string
          user_id?: string
          weekly_reminder_day?: number | null
          weekly_reminder_hour?: number | null
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      service_providers: {
        Row: {
          created_at: string
          document: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          provider_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          provider_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          provider_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      shadow_cycle_state: {
        Row: {
          captured_big_live_at: string | null
          captured_criterion: string | null
          captured_live_session_id: string | null
          closed_at: string | null
          created_at: string
          id: string
          min_big_live_viewers: number
          min_convite_live_recipients: number
          min_days: number
          notes: string | null
          started_at: string
          updated_at: string
        }
        Insert: {
          captured_big_live_at?: string | null
          captured_criterion?: string | null
          captured_live_session_id?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          min_big_live_viewers?: number
          min_convite_live_recipients?: number
          min_days?: number
          notes?: string | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          captured_big_live_at?: string | null
          captured_criterion?: string | null
          captured_live_session_id?: string | null
          closed_at?: string | null
          created_at?: string
          id?: string
          min_big_live_viewers?: number
          min_convite_live_recipients?: number
          min_days?: number
          notes?: string | null
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      shipping_rules: {
        Row: {
          carrier_match: string | null
          cep_range_end: string | null
          cep_range_start: string | null
          created_at: string
          discount_fixed: number | null
          discount_percentage: number | null
          event_id: string | null
          fixed_price: number | null
          id: string
          is_active: boolean
          name: string
          priority: number
          region_states: string[] | null
          rule_type: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          carrier_match?: string | null
          cep_range_end?: string | null
          cep_range_start?: string | null
          created_at?: string
          discount_fixed?: number | null
          discount_percentage?: number | null
          event_id?: string | null
          fixed_price?: number | null
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          region_states?: string[] | null
          rule_type?: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          carrier_match?: string | null
          cep_range_end?: string | null
          cep_range_start?: string | null
          created_at?: string
          discount_fixed?: number | null
          discount_percentage?: number | null
          event_id?: string | null
          fixed_price?: number | null
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          region_states?: string[] | null
          rule_type?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_rules_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_live_order_locks: {
        Row: {
          created_at: string
          customer_cpf_normalized: string | null
          customer_email_normalized: string | null
          customer_phone_normalized: string | null
          dedupe_key: string
          error_message: string | null
          id: string
          last_seen_at: string
          line_signature: string
          locked_at: string
          session_id: string | null
          shopify_order_id: string | null
          shopify_order_name: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_cpf_normalized?: string | null
          customer_email_normalized?: string | null
          customer_phone_normalized?: string | null
          dedupe_key: string
          error_message?: string | null
          id?: string
          last_seen_at?: string
          line_signature: string
          locked_at?: string
          session_id?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_cpf_normalized?: string | null
          customer_email_normalized?: string | null
          customer_phone_normalized?: string | null
          dedupe_key?: string
          error_message?: string | null
          id?: string
          last_seen_at?: string
          line_signature?: string
          locked_at?: string
          session_id?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_live_order_syncs: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          customer_cpf_normalized: string | null
          customer_email_normalized: string | null
          customer_name: string | null
          customer_phone_normalized: string | null
          dedupe_key: string
          duplicate_group_key: string | null
          duplicate_rank: number | null
          duplicate_reason: string | null
          id: string
          is_duplicate_candidate: boolean
          line_items: Json
          line_signature: string
          live_viewer_id: string | null
          order_id: string | null
          resolution_action: string | null
          resolution_notes: string | null
          review_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: string | null
          shopify_order_created_at: string | null
          shopify_order_id: string | null
          shopify_order_name: string | null
          source: string
          sync_status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          customer_cpf_normalized?: string | null
          customer_email_normalized?: string | null
          customer_name?: string | null
          customer_phone_normalized?: string | null
          dedupe_key: string
          duplicate_group_key?: string | null
          duplicate_rank?: number | null
          duplicate_reason?: string | null
          id?: string
          is_duplicate_candidate?: boolean
          line_items?: Json
          line_signature: string
          live_viewer_id?: string | null
          order_id?: string | null
          resolution_action?: string | null
          resolution_notes?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string | null
          shopify_order_created_at?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          source?: string
          sync_status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          customer_cpf_normalized?: string | null
          customer_email_normalized?: string | null
          customer_name?: string | null
          customer_phone_normalized?: string | null
          dedupe_key?: string
          duplicate_group_key?: string | null
          duplicate_rank?: number | null
          duplicate_reason?: string | null
          id?: string
          is_duplicate_candidate?: boolean
          line_items?: Json
          line_signature?: string
          live_viewer_id?: string | null
          order_id?: string | null
          resolution_action?: string | null
          resolution_notes?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string | null
          shopify_order_created_at?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          source?: string
          sync_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_yampi_mapping: {
        Row: {
          created_at: string
          id: string
          shopify_sku: string | null
          shopify_variant_id: string
          updated_at: string
          yampi_sku_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          shopify_sku?: string | null
          shopify_variant_id: string
          updated_at?: string
          yampi_sku_id: number
        }
        Update: {
          created_at?: string
          id?: string
          shopify_sku?: string | null
          shopify_variant_id?: string
          updated_at?: string
          yampi_sku_id?: number
        }
        Relationships: []
      }
      sticky_notes: {
        Row: {
          bg_color: string
          content: Json
          created_at: string
          deadline: string | null
          height: number
          id: string
          is_done: boolean
          is_shared: boolean
          position_x: number
          position_y: number
          text_color: string
          updated_at: string
          user_id: string
          width: number
          z_index: number
        }
        Insert: {
          bg_color?: string
          content?: Json
          created_at?: string
          deadline?: string | null
          height?: number
          id?: string
          is_done?: boolean
          is_shared?: boolean
          position_x?: number
          position_y?: number
          text_color?: string
          updated_at?: string
          user_id: string
          width?: number
          z_index?: number
        }
        Update: {
          bg_color?: string
          content?: Json
          created_at?: string
          deadline?: string | null
          height?: number
          id?: string
          is_done?: boolean
          is_shared?: boolean
          position_x?: number
          position_y?: number
          text_color?: string
          updated_at?: string
          user_id?: string
          width?: number
          z_index?: number
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          barcode: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          movement_type: string
          notes: string | null
          parent_sku: string | null
          pos_product_id: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          sku: string | null
          store_id: string | null
          unit_cost: number | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          movement_type: string
          notes?: string | null
          parent_sku?: string | null
          pos_product_id?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          sku?: string | null
          store_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          movement_type?: string
          notes?: string | null
          parent_sku?: string | null
          pos_product_id?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          sku?: string | null
          store_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_pos_product_id_fkey"
            columns: ["pos_product_id"]
            isOneToOne: false
            referencedRelation: "pos_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_pos_product_id_fkey"
            columns: ["pos_product_id"]
            isOneToOne: false
            referencedRelation: "v_a1_orphan_pos_products"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          is_completed: boolean
          parent_id: string | null
          scope: string
          sort_order: number
          store_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_completed?: boolean
          parent_id?: string | null
          scope?: string
          sort_order?: number
          store_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_completed?: boolean
          parent_id?: string | null
          scope?: string
          sort_order?: number
          store_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "strategy_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_tasks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          deadline_at: string | null
          description: string | null
          expedition_order_id: string | null
          id: string
          points_awarded: number | null
          priority: string
          resolution_notes: string | null
          resolved_at: string | null
          shopify_order_name: string | null
          source: string
          started_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          deadline_at?: string | null
          description?: string | null
          expedition_order_id?: string | null
          id?: string
          points_awarded?: number | null
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          shopify_order_name?: string | null
          source?: string
          started_at?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          deadline_at?: string | null
          description?: string | null
          expedition_order_id?: string | null
          id?: string
          points_awarded?: number | null
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          shopify_order_name?: string | null
          source?: string
          started_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_expedition_order_id_fkey"
            columns: ["expedition_order_id"]
            isOneToOne: false
            referencedRelation: "expedition_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      team_chat_messages: {
        Row: {
          channel: string
          created_at: string
          id: string
          message: string
          message_type: string
          metadata: Json | null
          sender_name: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          message: string
          message_type?: string
          metadata?: Json | null
          sender_name: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          message?: string
          message_type?: string
          metadata?: Json | null
          sender_name?: string
        }
        Relationships: []
      }
      team_chat_reads: {
        Row: {
          id: string
          message_id: string
          read_at: string
          reader_name: string
        }
        Insert: {
          id?: string
          message_id: string
          read_at?: string
          reader_name: string
        }
        Update: {
          id?: string
          message_id?: string
          read_at?: string
          reader_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_chat_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "team_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      team_gamification: {
        Row: {
          badges: Json
          created_at: string
          id: string
          member_name: string
          penalties: number
          tickets_fast: number
          tickets_medium: number
          tickets_resolved: number
          tickets_slow: number
          total_points: number
          updated_at: string
          weekly_goal: number
          weekly_points: number
        }
        Insert: {
          badges?: Json
          created_at?: string
          id?: string
          member_name: string
          penalties?: number
          tickets_fast?: number
          tickets_medium?: number
          tickets_resolved?: number
          tickets_slow?: number
          total_points?: number
          updated_at?: string
          weekly_goal?: number
          weekly_points?: number
        }
        Update: {
          badges?: Json
          created_at?: string
          id?: string
          member_name?: string
          penalties?: number
          tickets_fast?: number
          tickets_medium?: number
          tickets_resolved?: number
          tickets_slow?: number
          total_points?: number
          updated_at?: string
          weekly_goal?: number
          weekly_points?: number
        }
        Relationships: []
      }
      templates_carrossel: {
        Row: {
          aprovado: boolean
          category_last_synced_at: string | null
          created_at: string
          event_id: string | null
          id: string
          meta_status: string
          nome: string
          observacao: string | null
          qtd_cards: number
          scope: string
          template_category: string | null
          template_id: string
          template_language: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        Insert: {
          aprovado?: boolean
          category_last_synced_at?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          meta_status?: string
          nome?: string
          observacao?: string | null
          qtd_cards: number
          scope?: string
          template_category?: string | null
          template_id: string
          template_language?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          aprovado?: boolean
          category_last_synced_at?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          meta_status?: string
          nome?: string
          observacao?: string | null
          qtd_cards?: number
          scope?: string
          template_category?: string | null
          template_id?: string
          template_language?: string
          updated_at?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "templates_carrossel_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_carrossel_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_carrossel_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_accounts_payable: {
        Row: {
          categoria: string | null
          competencia: string | null
          created_at: string
          data_emissao: string | null
          data_pagamento: string | null
          data_vencimento: string | null
          historico: string | null
          id: string
          nome_fornecedor: string | null
          nro_banco: string | null
          numero_doc: string | null
          observacoes: string | null
          raw_data: Json | null
          saldo: number | null
          situacao: string | null
          store_id: string
          synced_at: string | null
          tiny_conta_id: string
          updated_at: string
          valor: number | null
          valor_pago: number | null
        }
        Insert: {
          categoria?: string | null
          competencia?: string | null
          created_at?: string
          data_emissao?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          historico?: string | null
          id?: string
          nome_fornecedor?: string | null
          nro_banco?: string | null
          numero_doc?: string | null
          observacoes?: string | null
          raw_data?: Json | null
          saldo?: number | null
          situacao?: string | null
          store_id: string
          synced_at?: string | null
          tiny_conta_id: string
          updated_at?: string
          valor?: number | null
          valor_pago?: number | null
        }
        Update: {
          categoria?: string | null
          competencia?: string | null
          created_at?: string
          data_emissao?: string | null
          data_pagamento?: string | null
          data_vencimento?: string | null
          historico?: string | null
          id?: string
          nome_fornecedor?: string | null
          nro_banco?: string | null
          numero_doc?: string | null
          observacoes?: string | null
          raw_data?: Json | null
          saldo?: number | null
          situacao?: string | null
          store_id?: string
          synced_at?: string | null
          tiny_conta_id?: string
          updated_at?: string
          valor?: number | null
          valor_pago?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_accounts_payable_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_accounts_payable_sync_log: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          started_at: string
          status: string
          store_id: string | null
          total_synced: number | null
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          started_at?: string
          status?: string
          store_id?: string | null
          total_synced?: number | null
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          started_at?: string
          status?: string
          store_id?: string | null
          total_synced?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_accounts_payable_sync_log_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_fiscal_divergences: {
        Row: {
          created_at: string
          dedup_index_id: string | null
          field_name: string
          id: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          resolved_value: string | null
          store_a_id: string | null
          store_b_id: string | null
          value_a: string | null
          value_b: string | null
        }
        Insert: {
          created_at?: string
          dedup_index_id?: string | null
          field_name: string
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_value?: string | null
          store_a_id?: string | null
          store_b_id?: string | null
          value_a?: string | null
          value_b?: string | null
        }
        Update: {
          created_at?: string
          dedup_index_id?: string | null
          field_name?: string
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_value?: string | null
          store_a_id?: string | null
          store_b_id?: string | null
          value_a?: string | null
          value_b?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_fiscal_divergences_dedup_index_id_fkey"
            columns: ["dedup_index_id"]
            isOneToOne: false
            referencedRelation: "product_dedup_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiny_fiscal_divergences_store_a_id_fkey"
            columns: ["store_a_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiny_fiscal_divergences_store_b_id_fkey"
            columns: ["store_b_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_import_errors: {
        Row: {
          created_at: string
          dedup_index_id: string | null
          error_code: string | null
          error_message: string | null
          id: string
          raw_response: Json | null
          run_id: string | null
        }
        Insert: {
          created_at?: string
          dedup_index_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          raw_response?: Json | null
          run_id?: string | null
        }
        Update: {
          created_at?: string
          dedup_index_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          raw_response?: Json | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_import_errors_dedup_index_id_fkey"
            columns: ["dedup_index_id"]
            isOneToOne: false
            referencedRelation: "product_dedup_index"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiny_import_errors_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "tiny_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_import_runs: {
        Row: {
          created_by: string | null
          dry_run: boolean
          error_message: string | null
          failure_count: number
          finished_at: string | null
          id: string
          run_type: string
          started_at: string
          stats: Json
          status: string
          success_count: number
          total_processed: number
        }
        Insert: {
          created_by?: string | null
          dry_run?: boolean
          error_message?: string | null
          failure_count?: number
          finished_at?: string | null
          id?: string
          run_type: string
          started_at?: string
          stats?: Json
          status?: string
          success_count?: number
          total_processed?: number
        }
        Update: {
          created_by?: string | null
          dry_run?: boolean
          error_message?: string | null
          failure_count?: number
          finished_at?: string | null
          id?: string
          run_type?: string
          started_at?: string
          stats?: Json
          status?: string
          success_count?: number
          total_processed?: number
        }
        Relationships: []
      }
      tiny_management_sync_log: {
        Row: {
          completed_at: string | null
          current_date_syncing: string | null
          date_from: string | null
          date_to: string | null
          error_message: string | null
          id: string
          orders_synced: number | null
          phase: string | null
          started_at: string
          status: string
          store_id: string | null
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          current_date_syncing?: string | null
          date_from?: string | null
          date_to?: string | null
          error_message?: string | null
          id?: string
          orders_synced?: number | null
          phase?: string | null
          started_at?: string
          status?: string
          store_id?: string | null
          sync_type?: string
        }
        Update: {
          completed_at?: string | null
          current_date_syncing?: string | null
          date_from?: string | null
          date_to?: string | null
          error_message?: string | null
          id?: string
          orders_synced?: number | null
          phase?: string | null
          started_at?: string
          status?: string
          store_id?: string | null
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiny_management_sync_log_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_sales_history: {
        Row: {
          created_at: string
          id: string
          last_synced_at: string
          period_end: string
          period_start: string
          product_name: string | null
          quantity_sold: number
          sale_count: number
          sku: string
          store_id: string
          total_revenue: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_synced_at?: string
          period_end: string
          period_start: string
          product_name?: string | null
          quantity_sold?: number
          sale_count?: number
          sku: string
          store_id: string
          total_revenue?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_synced_at?: string
          period_end?: string
          period_start?: string
          product_name?: string | null
          quantity_sold?: number
          sale_count?: number
          sku?: string
          store_id?: string
          total_revenue?: number
        }
        Relationships: [
          {
            foreignKeyName: "tiny_sales_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_stock_sync_errors: {
        Row: {
          attempted_stock: number | null
          attempts: number
          created_at: string
          direction: string | null
          error_message: string | null
          id: string
          last_attempt_at: string
          product_id: string | null
          quantity: number | null
          resolved_at: string | null
          sale_event: string | null
          sale_id: string | null
          sku: string | null
          status: string
          store_id: string | null
          tiny_id: number | null
        }
        Insert: {
          attempted_stock?: number | null
          attempts?: number
          created_at?: string
          direction?: string | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string
          product_id?: string | null
          quantity?: number | null
          resolved_at?: string | null
          sale_event?: string | null
          sale_id?: string | null
          sku?: string | null
          status?: string
          store_id?: string | null
          tiny_id?: number | null
        }
        Update: {
          attempted_stock?: number | null
          attempts?: number
          created_at?: string
          direction?: string | null
          error_message?: string | null
          id?: string
          last_attempt_at?: string
          product_id?: string | null
          quantity?: number | null
          resolved_at?: string | null
          sale_event?: string | null
          sale_id?: string | null
          sku?: string | null
          status?: string
          store_id?: string | null
          tiny_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_stock_sync_errors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "pos_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiny_stock_sync_errors_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_a1_orphan_pos_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiny_stock_sync_errors_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiny_stock_sync_errors_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      tiny_synced_orders: {
        Row: {
          created_at: string
          customer_name: string | null
          discount: number | null
          id: string
          items: Json | null
          order_date: string
          payment_method: string | null
          raw_data: Json | null
          shipping: number | null
          status: string | null
          store_id: string
          subtotal: number | null
          synced_at: string
          tiny_order_id: string
          tiny_order_number: string | null
          total: number | null
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          discount?: number | null
          id?: string
          items?: Json | null
          order_date: string
          payment_method?: string | null
          raw_data?: Json | null
          shipping?: number | null
          status?: string | null
          store_id: string
          subtotal?: number | null
          synced_at?: string
          tiny_order_id: string
          tiny_order_number?: string | null
          total?: number | null
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          discount?: number | null
          id?: string
          items?: Json | null
          order_date?: string
          payment_method?: string | null
          raw_data?: Json | null
          shipping?: number | null
          status?: string | null
          store_id?: string
          subtotal?: number | null
          synced_at?: string
          tiny_order_id?: string
          tiny_order_number?: string | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tiny_synced_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_conversions: {
        Row: {
          created_at: string
          created_by: string | null
          finish_reason: string | null
          id: string
          meta_capi_event_id: string | null
          meta_capi_response: Json | null
          meta_capi_sent_at: string | null
          phone: string
          sale_currency: string
          sale_value: number
          seller_id: string | null
          trigger_id: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          finish_reason?: string | null
          id?: string
          meta_capi_event_id?: string | null
          meta_capi_response?: Json | null
          meta_capi_sent_at?: string | null
          phone: string
          sale_currency?: string
          sale_value?: number
          seller_id?: string | null
          trigger_id?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          finish_reason?: string | null
          id?: string
          meta_capi_event_id?: string | null
          meta_capi_response?: Json | null
          meta_capi_sent_at?: string | null
          phone?: string
          sale_currency?: string
          sale_value?: number
          seller_id?: string | null
          trigger_id?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trigger_conversions_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "sales_triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_messages: {
        Row: {
          content: string
          created_at: string
          delay_seconds: number
          id: string
          is_active: boolean
          media_type: string | null
          media_url: string | null
          sort_order: number
          trigger_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          delay_seconds?: number
          id?: string
          is_active?: boolean
          media_type?: string | null
          media_url?: string | null
          sort_order?: number
          trigger_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          delay_seconds?: number
          id?: string
          is_active?: boolean
          media_type?: string | null
          media_url?: string | null
          sort_order?: number
          trigger_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trigger_messages_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "sales_triggers"
            referencedColumns: ["id"]
          },
        ]
      }
      trocas_devolucoes: {
        Row: {
          chave_acesso_original: string | null
          chave_devolucao: string | null
          cliente_id: string | null
          codigo_devolucao: string | null
          codigo_postagem_reversa: string | null
          created_at: string
          devolucao_doc_id: string | null
          diferenca: number
          estoque_movimentado: boolean
          estorno_forma: string | null
          fase2_erro: string | null
          faturamento_vendedora_troca: number
          id: string
          loja_origem_id: string | null
          modo_expedicao: Database["public"]["Enums"]["td_modo_expedicao"]
          motivo: Database["public"]["Enums"]["td_motivo"]
          nfe_reposicao_id: string | null
          origem_canal: Database["public"]["Enums"]["td_origem_canal"]
          pedido_ajustado: boolean
          pedido_novo_id: string | null
          pedido_original_id: string | null
          resolucao_diferenca: string | null
          status: Database["public"]["Enums"]["td_status"]
          tipo: Database["public"]["Enums"]["td_tipo"]
          tracking_carrier: string | null
          tracking_code: string | null
          updated_at: string
          valor_devolvido: number
          valor_reposicao: number
          venda_nova_doc_id: string | null
          vendedora_troca_id: string | null
          voucher_id: string | null
          whatsapp_notification_sent_at: string | null
        }
        Insert: {
          chave_acesso_original?: string | null
          chave_devolucao?: string | null
          cliente_id?: string | null
          codigo_devolucao?: string | null
          codigo_postagem_reversa?: string | null
          created_at?: string
          devolucao_doc_id?: string | null
          diferenca?: number
          estoque_movimentado?: boolean
          estorno_forma?: string | null
          fase2_erro?: string | null
          faturamento_vendedora_troca?: number
          id?: string
          loja_origem_id?: string | null
          modo_expedicao?: Database["public"]["Enums"]["td_modo_expedicao"]
          motivo: Database["public"]["Enums"]["td_motivo"]
          nfe_reposicao_id?: string | null
          origem_canal: Database["public"]["Enums"]["td_origem_canal"]
          pedido_ajustado?: boolean
          pedido_novo_id?: string | null
          pedido_original_id?: string | null
          resolucao_diferenca?: string | null
          status?: Database["public"]["Enums"]["td_status"]
          tipo: Database["public"]["Enums"]["td_tipo"]
          tracking_carrier?: string | null
          tracking_code?: string | null
          updated_at?: string
          valor_devolvido?: number
          valor_reposicao?: number
          venda_nova_doc_id?: string | null
          vendedora_troca_id?: string | null
          voucher_id?: string | null
          whatsapp_notification_sent_at?: string | null
        }
        Update: {
          chave_acesso_original?: string | null
          chave_devolucao?: string | null
          cliente_id?: string | null
          codigo_devolucao?: string | null
          codigo_postagem_reversa?: string | null
          created_at?: string
          devolucao_doc_id?: string | null
          diferenca?: number
          estoque_movimentado?: boolean
          estorno_forma?: string | null
          fase2_erro?: string | null
          faturamento_vendedora_troca?: number
          id?: string
          loja_origem_id?: string | null
          modo_expedicao?: Database["public"]["Enums"]["td_modo_expedicao"]
          motivo?: Database["public"]["Enums"]["td_motivo"]
          nfe_reposicao_id?: string | null
          origem_canal?: Database["public"]["Enums"]["td_origem_canal"]
          pedido_ajustado?: boolean
          pedido_novo_id?: string | null
          pedido_original_id?: string | null
          resolucao_diferenca?: string | null
          status?: Database["public"]["Enums"]["td_status"]
          tipo?: Database["public"]["Enums"]["td_tipo"]
          tracking_carrier?: string | null
          tracking_code?: string | null
          updated_at?: string
          valor_devolvido?: number
          valor_reposicao?: number
          venda_nova_doc_id?: string | null
          vendedora_troca_id?: string | null
          voucher_id?: string | null
          whatsapp_notification_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trocas_devolucoes_devolucao_doc_id_fkey"
            columns: ["devolucao_doc_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trocas_devolucoes_loja_origem_id_fkey"
            columns: ["loja_origem_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trocas_devolucoes_nfe_reposicao_id_fkey"
            columns: ["nfe_reposicao_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trocas_devolucoes_pedido_novo_id_fkey"
            columns: ["pedido_novo_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trocas_devolucoes_pedido_original_id_fkey"
            columns: ["pedido_original_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trocas_devolucoes_venda_nova_doc_id_fkey"
            columns: ["venda_nova_doc_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trocas_devolucoes_vendedora_troca_id_fkey"
            columns: ["vendedora_troca_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trocas_devolucoes_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      trocas_devolucoes_itens: {
        Row: {
          barcode: string | null
          created_at: string
          direcao: Database["public"]["Enums"]["td_item_direcao"]
          estado_estoque:
            | Database["public"]["Enums"]["td_estado_estoque"]
            | null
          id: string
          produto_id: string | null
          produto_nome: string | null
          quantidade: number
          repoe_estoque: boolean
          sku: string | null
          tamanho: string | null
          troca_devolucao_id: string
          updated_at: string
          valor_unitario: number
          variacao_id: string | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          direcao: Database["public"]["Enums"]["td_item_direcao"]
          estado_estoque?:
            | Database["public"]["Enums"]["td_estado_estoque"]
            | null
          id?: string
          produto_id?: string | null
          produto_nome?: string | null
          quantidade?: number
          repoe_estoque?: boolean
          sku?: string | null
          tamanho?: string | null
          troca_devolucao_id: string
          updated_at?: string
          valor_unitario?: number
          variacao_id?: string | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          direcao?: Database["public"]["Enums"]["td_item_direcao"]
          estado_estoque?:
            | Database["public"]["Enums"]["td_estado_estoque"]
            | null
          id?: string
          produto_id?: string | null
          produto_nome?: string | null
          quantidade?: number
          repoe_estoque?: boolean
          sku?: string | null
          tamanho?: string | null
          troca_devolucao_id?: string
          updated_at?: string
          valor_unitario?: number
          variacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trocas_devolucoes_itens_troca_devolucao_id_fkey"
            columns: ["troca_devolucao_id"]
            isOneToOne: false
            referencedRelation: "trocas_devolucoes"
            referencedColumns: ["id"]
          },
        ]
      }
      uazapi_contact_backfill_state: {
        Row: {
          created_at: string
          done: boolean
          last_failed: number
          last_succeeded: number
          locked_at: string | null
          offset: number
          total_failed: number
          total_succeeded: number
          updated_at: string
          whatsapp_number_id: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          last_failed?: number
          last_succeeded?: number
          locked_at?: string | null
          offset?: number
          total_failed?: number
          total_succeeded?: number
          updated_at?: string
          whatsapp_number_id: string
        }
        Update: {
          created_at?: string
          done?: boolean
          last_failed?: number
          last_succeeded?: number
          locked_at?: string | null
          offset?: number
          total_failed?: number
          total_succeeded?: number
          updated_at?: string
          whatsapp_number_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uazapi_contact_backfill_state_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uazapi_contact_backfill_state_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_dedup_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          rows_count: number | null
          snapshot_table: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          rows_count?: number | null
          snapshot_table: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          rows_count?: number | null
          snapshot_table?: string
        }
        Relationships: []
      }
      unified_merge_log: {
        Row: {
          absorbed_id: string
          absorbed_row: Json
          fks_repointed: Json
          id: string
          merge_batch_id: string
          merged_at: string
          mirror_sales_detected: number
          reverted_at: string | null
          rule: string
          survivor_id: string
        }
        Insert: {
          absorbed_id: string
          absorbed_row: Json
          fks_repointed?: Json
          id?: string
          merge_batch_id: string
          merged_at?: string
          mirror_sales_detected?: number
          reverted_at?: string | null
          rule: string
          survivor_id: string
        }
        Update: {
          absorbed_id?: string
          absorbed_row?: Json
          fks_repointed?: Json
          id?: string
          merge_batch_id?: string
          merged_at?: string
          mirror_sales_detected?: number
          reverted_at?: string | null
          rule?: string
          survivor_id?: string
        }
        Relationships: []
      }
      user_module_permissions: {
        Row: {
          created_at: string
          id: string
          module: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          module: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          module?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          seller_id: string | null
          store_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          seller_id?: string | null
          store_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          seller_id?: string | null
          store_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variant_normalization_log: {
        Row: {
          applied_at: string
          applied_by: string | null
          id: string
          master_id: string | null
          master_name: string | null
          new_color: string | null
          new_size: string | null
          old_color: string | null
          old_size: string | null
          reason: string | null
          variant_id: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          master_id?: string | null
          master_name?: string | null
          new_color?: string | null
          new_size?: string | null
          old_color?: string | null
          old_size?: string | null
          reason?: string | null
          variant_id: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          master_id?: string | null
          master_name?: string | null
          new_color?: string | null
          new_size?: string | null
          old_color?: string | null
          old_size?: string | null
          reason?: string | null
          variant_id?: string
        }
        Relationships: []
      }
      vip_group_strategies: {
        Row: {
          created_at: string
          id: string
          month_year: string
          strategy_content: string | null
          strategy_prompt: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          month_year: string
          strategy_content?: string | null
          strategy_prompt?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          month_year?: string
          strategy_content?: string | null
          strategy_prompt?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vip_orphan_contacts: {
        Row: {
          created_at: string
          display_name: string | null
          first_seen_at: string
          group_ids: string[]
          group_names: string[]
          id: string
          last_seen_at: string
          metadata: Json
          opted_out: boolean
          phone: string
          phone_suffix8: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          first_seen_at?: string
          group_ids?: string[]
          group_names?: string[]
          id?: string
          last_seen_at?: string
          metadata?: Json
          opted_out?: boolean
          phone: string
          phone_suffix8: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          first_seen_at?: string
          group_ids?: string[]
          group_names?: string[]
          id?: string
          last_seen_at?: string
          metadata?: Json
          opted_out?: boolean
          phone?: string
          phone_suffix8?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      vouchers: {
        Row: {
          cliente_id: string | null
          codigo: string | null
          created_at: string
          id: string
          saldo: number
          status: Database["public"]["Enums"]["voucher_status"]
          troca_devolucao_id: string | null
          updated_at: string
          validade: string | null
          valor: number
        }
        Insert: {
          cliente_id?: string | null
          codigo?: string | null
          created_at?: string
          id?: string
          saldo?: number
          status?: Database["public"]["Enums"]["voucher_status"]
          troca_devolucao_id?: string | null
          updated_at?: string
          validade?: string | null
          valor?: number
        }
        Update: {
          cliente_id?: string | null
          codigo?: string | null
          created_at?: string
          id?: string
          saldo?: number
          status?: Database["public"]["Enums"]["voucher_status"]
          troca_devolucao_id?: string | null
          updated_at?: string
          validade?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_troca_devolucao_id_fkey"
            columns: ["troca_devolucao_id"]
            isOneToOne: false
            referencedRelation: "trocas_devolucoes"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events_raw: {
        Row: {
          created_at: string
          event_type: string | null
          id: string
          owner: string | null
          payload: Json
          provider: string
          skip_reason: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          id?: string
          owner?: string | null
          payload: Json
          provider: string
          skip_reason?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string | null
          id?: string
          owner?: string | null
          payload?: Json
          provider?: string
          skip_reason?: string | null
        }
        Relationships: []
      }
      webhook_routing_log: {
        Row: {
          created_at: string
          id: string
          matched: boolean
          provider: string
          raw_identifier: string | null
          raw_payload: Json | null
          resolution_method: string
          resolved_whatsapp_number_id: string | null
          sender_phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          matched?: boolean
          provider: string
          raw_identifier?: string | null
          raw_payload?: Json | null
          resolution_method?: string
          resolved_whatsapp_number_id?: string | null
          sender_phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          matched?: boolean
          provider?: string
          raw_identifier?: string | null
          raw_payload?: Json | null
          resolution_method?: string
          resolved_whatsapp_number_id?: string | null
          sender_phone?: string | null
        }
        Relationships: []
      }
      whatsapp_ad_keywords: {
        Row: {
          campaign_label: string
          created_at: string | null
          id: string
          is_active: boolean | null
          keyword: string
          updated_at: string | null
        }
        Insert: {
          campaign_label: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          keyword: string
          updated_at?: string | null
        }
        Update: {
          campaign_label?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          keyword?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      whatsapp_auto_replies: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          message: string
          schedule_days: number[] | null
          schedule_end: string | null
          schedule_start: string | null
          type: string
          updated_at: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          message: string
          schedule_days?: number[] | null
          schedule_end?: string | null
          schedule_start?: string | null
          type: string
          updated_at?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          message?: string
          schedule_days?: number[] | null
          schedule_end?: string | null
          schedule_start?: string | null
          type?: string
          updated_at?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_auto_replies_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_auto_replies_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_auto_reply_log: {
        Row: {
          id: string
          phone: string
          sent_at: string | null
          type: string
          whatsapp_number_id: string | null
        }
        Insert: {
          id?: string
          phone: string
          sent_at?: string | null
          type: string
          whatsapp_number_id?: string | null
        }
        Update: {
          id?: string
          phone?: string
          sent_at?: string | null
          type?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_auto_reply_log_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_auto_reply_log_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_group_member_activity: {
        Row: {
          activity_type: string
          content: string | null
          created_at: string
          customer_id: string | null
          display_name: string | null
          group_id: string
          id: string
          instance_id: string | null
          is_internal: boolean
          jid: string | null
          message_id: string | null
          phone: string
        }
        Insert: {
          activity_type: string
          content?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          group_id: string
          id?: string
          instance_id?: string | null
          is_internal?: boolean
          jid?: string | null
          message_id?: string | null
          phone: string
        }
        Update: {
          activity_type?: string
          content?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          group_id?: string
          id?: string
          instance_id?: string | null
          is_internal?: boolean
          jid?: string | null
          message_id?: string | null
          phone?: string
        }
        Relationships: []
      }
      whatsapp_group_member_events: {
        Row: {
          actor_phone: string | null
          created_at: string
          customer_id: string | null
          display_name: string | null
          event_type: string
          group_id: string
          id: string
          instance_id: string | null
          is_internal: boolean
          jid: string | null
          phone: string
          source_version_id: string
        }
        Insert: {
          actor_phone?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          event_type: string
          group_id: string
          id?: string
          instance_id?: string | null
          is_internal?: boolean
          jid?: string | null
          phone: string
          source_version_id?: string
        }
        Update: {
          actor_phone?: string | null
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          event_type?: string
          group_id?: string
          id?: string
          instance_id?: string | null
          is_internal?: boolean
          jid?: string | null
          phone?: string
          source_version_id?: string
        }
        Relationships: []
      }
      whatsapp_group_members: {
        Row: {
          created_at: string
          customer_id: string | null
          display_name: string | null
          group_id: string
          id: string
          instance_id: string | null
          internal_kind: string | null
          is_admin: boolean
          is_internal: boolean
          jid: string | null
          joined_at: string | null
          last_event_at: string
          left_at: string | null
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          group_id: string
          id?: string
          instance_id?: string | null
          internal_kind?: string | null
          is_admin?: boolean
          is_internal?: boolean
          jid?: string | null
          joined_at?: string | null
          last_event_at?: string
          left_at?: string | null
          phone: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          display_name?: string | null
          group_id?: string
          id?: string
          instance_id?: string | null
          internal_kind?: string | null
          is_admin?: boolean
          is_internal?: boolean
          jid?: string | null
          joined_at?: string | null
          last_event_at?: string
          left_at?: string | null
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_group_snapshots: {
        Row: {
          group_id: string
          id: string
          participant_count: number
          recorded_at: string
        }
        Insert: {
          group_id: string
          id?: string
          participant_count?: number
          recorded_at?: string
        }
        Update: {
          group_id?: string
          id?: string
          participant_count?: number
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_group_snapshots_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "vip_group_membership_stats"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "whatsapp_group_snapshots_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          created_at: string
          ddd33_count: number | null
          ddd33_synced_at: string | null
          ddd33_total_resolved: number | null
          description: string | null
          group_id: string
          id: string
          instance_id: string | null
          invite_link: string | null
          is_active: boolean | null
          is_admin: boolean | null
          is_full: boolean
          is_vip: boolean | null
          last_synced_at: string | null
          max_participants: number
          name: string
          only_admins_add: boolean
          only_admins_send: boolean
          participant_count: number | null
          photo_url: string | null
          previous_participant_count: number | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ddd33_count?: number | null
          ddd33_synced_at?: string | null
          ddd33_total_resolved?: number | null
          description?: string | null
          group_id: string
          id?: string
          instance_id?: string | null
          invite_link?: string | null
          is_active?: boolean | null
          is_admin?: boolean | null
          is_full?: boolean
          is_vip?: boolean | null
          last_synced_at?: string | null
          max_participants?: number
          name: string
          only_admins_add?: boolean
          only_admins_send?: boolean
          participant_count?: number | null
          photo_url?: string | null
          previous_participant_count?: number | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ddd33_count?: number | null
          ddd33_synced_at?: string | null
          ddd33_total_resolved?: number | null
          description?: string | null
          group_id?: string
          id?: string
          instance_id?: string | null
          invite_link?: string | null
          is_active?: boolean | null
          is_admin?: boolean | null
          is_full?: boolean
          is_vip?: boolean | null
          last_synced_at?: string | null
          max_participants?: number
          name?: string
          only_admins_add?: boolean
          only_admins_send?: boolean
          participant_count?: number | null
          photo_url?: string | null
          previous_participant_count?: number | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          button_payload: string | null
          channel: string
          created_at: string
          direction: string
          error_code: string | null
          error_message: string | null
          id: string
          is_group: boolean | null
          is_mass_dispatch: boolean
          media_type: string | null
          media_url: string | null
          message: string
          message_id: string | null
          phone: string
          quoted_message_id: string | null
          referral: Json | null
          sender_name: string | null
          sender_phone: string | null
          sender_user_id: string | null
          source: string
          status: string | null
          template_payload: Json | null
          whatsapp_number_id: string | null
        }
        Insert: {
          button_payload?: string | null
          channel?: string
          created_at?: string
          direction: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          is_group?: boolean | null
          is_mass_dispatch?: boolean
          media_type?: string | null
          media_url?: string | null
          message: string
          message_id?: string | null
          phone: string
          quoted_message_id?: string | null
          referral?: Json | null
          sender_name?: string | null
          sender_phone?: string | null
          sender_user_id?: string | null
          source?: string
          status?: string | null
          template_payload?: Json | null
          whatsapp_number_id?: string | null
        }
        Update: {
          button_payload?: string | null
          channel?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          is_group?: boolean | null
          is_mass_dispatch?: boolean
          media_type?: string | null
          media_url?: string | null
          message?: string
          message_id?: string | null
          phone?: string
          quoted_message_id?: string | null
          referral?: Json | null
          sender_name?: string | null
          sender_phone?: string | null
          sender_user_id?: string | null
          source?: string
          status?: string | null
          template_payload?: Json | null
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages_archive: {
        Row: {
          archived_at: string
          channel: string
          created_at: string
          direction: string
          error_code: string | null
          error_message: string | null
          id: string
          is_group: boolean | null
          is_mass_dispatch: boolean
          media_type: string | null
          media_url: string | null
          message: string
          message_id: string | null
          phone: string
          quoted_message_id: string | null
          referral: Json | null
          sender_name: string | null
          sender_user_id: string | null
          source: string
          status: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          archived_at?: string
          channel?: string
          created_at: string
          direction: string
          error_code?: string | null
          error_message?: string | null
          id: string
          is_group?: boolean | null
          is_mass_dispatch?: boolean
          media_type?: string | null
          media_url?: string | null
          message: string
          message_id?: string | null
          phone: string
          quoted_message_id?: string | null
          referral?: Json | null
          sender_name?: string | null
          sender_user_id?: string | null
          source?: string
          status?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          archived_at?: string
          channel?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          is_group?: boolean | null
          is_mass_dispatch?: boolean
          media_type?: string | null
          media_url?: string | null
          message?: string
          message_id?: string | null
          phone?: string
          quoted_message_id?: string | null
          referral?: Json | null
          sender_name?: string | null
          sender_user_id?: string | null
          source?: string
          status?: string | null
          whatsapp_number_id?: string | null
        }
        Relationships: []
      }
      whatsapp_numbers: {
        Row: {
          access_token: string | null
          ai_paused: boolean
          business_account_id: string | null
          created_at: string
          has_meta_token: boolean | null
          has_zapi_client_token: boolean | null
          has_zapi_token: boolean | null
          health_check_error: string | null
          id: string
          instagram_account_id: string | null
          instagram_username: string | null
          is_active: boolean
          is_default: boolean
          is_online: boolean | null
          label: string
          last_health_check: string | null
          phone_display: string
          phone_number_id: string | null
          provider: string
          uazapi_instance_name: string | null
          uazapi_last_qr: string | null
          uazapi_owner: string | null
          uazapi_proxy_managed_city: string | null
          uazapi_proxy_managed_country: string | null
          uazapi_proxy_managed_state: string | null
          uazapi_proxy_mode: string | null
          uazapi_qr_updated_at: string | null
          uazapi_token: string | null
          updated_at: string
          wasender_api_key: string | null
          wasender_last_qr: string | null
          wasender_phone_number: string | null
          wasender_qr_updated_at: string | null
          wasender_session_id: number | null
          wasender_webhook_secret: string | null
          zapi_client_token: string | null
          zapi_instance_id: string | null
          zapi_token: string | null
        }
        Insert: {
          access_token?: string | null
          ai_paused?: boolean
          business_account_id?: string | null
          created_at?: string
          has_meta_token?: boolean | null
          has_zapi_client_token?: boolean | null
          has_zapi_token?: boolean | null
          health_check_error?: string | null
          id?: string
          instagram_account_id?: string | null
          instagram_username?: string | null
          is_active?: boolean
          is_default?: boolean
          is_online?: boolean | null
          label: string
          last_health_check?: string | null
          phone_display: string
          phone_number_id?: string | null
          provider?: string
          uazapi_instance_name?: string | null
          uazapi_last_qr?: string | null
          uazapi_owner?: string | null
          uazapi_proxy_managed_city?: string | null
          uazapi_proxy_managed_country?: string | null
          uazapi_proxy_managed_state?: string | null
          uazapi_proxy_mode?: string | null
          uazapi_qr_updated_at?: string | null
          uazapi_token?: string | null
          updated_at?: string
          wasender_api_key?: string | null
          wasender_last_qr?: string | null
          wasender_phone_number?: string | null
          wasender_qr_updated_at?: string | null
          wasender_session_id?: number | null
          wasender_webhook_secret?: string | null
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Update: {
          access_token?: string | null
          ai_paused?: boolean
          business_account_id?: string | null
          created_at?: string
          has_meta_token?: boolean | null
          has_zapi_client_token?: boolean | null
          has_zapi_token?: boolean | null
          health_check_error?: string | null
          id?: string
          instagram_account_id?: string | null
          instagram_username?: string | null
          is_active?: boolean
          is_default?: boolean
          is_online?: boolean | null
          label?: string
          last_health_check?: string | null
          phone_display?: string
          phone_number_id?: string | null
          provider?: string
          uazapi_instance_name?: string | null
          uazapi_last_qr?: string | null
          uazapi_owner?: string | null
          uazapi_proxy_managed_city?: string | null
          uazapi_proxy_managed_country?: string | null
          uazapi_proxy_managed_state?: string | null
          uazapi_proxy_mode?: string | null
          uazapi_qr_updated_at?: string | null
          uazapi_token?: string | null
          updated_at?: string
          wasender_api_key?: string | null
          wasender_last_qr?: string | null
          wasender_phone_number?: string | null
          wasender_qr_updated_at?: string | null
          wasender_session_id?: number | null
          wasender_webhook_secret?: string | null
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Relationships: []
      }
      whatsapp_status_posts: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          media_url: string | null
          message_id: string
          text_content: string | null
          type: string
          whatsapp_number_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          media_url?: string | null
          message_id: string
          text_content?: string | null
          type?: string
          whatsapp_number_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          media_url?: string | null
          message_id?: string
          text_content?: string | null
          type?: string
          whatsapp_number_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_status_posts_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_status_posts_whatsapp_number_id_fkey"
            columns: ["whatsapp_number_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_numbers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      zoppy_customers: {
        Row: {
          address1: string | null
          address2: string | null
          age_range: string | null
          avg_ticket: number | null
          birth_date: string | null
          cashback_balance: number | null
          cashback_expires_at: string | null
          city: string | null
          country: string | null
          coupon_amount: number | null
          coupon_code: string | null
          coupon_expiry_date: string | null
          coupon_min_purchase: number | null
          coupon_start_date: string | null
          coupon_type: string | null
          coupon_used: boolean | null
          cpf: string | null
          created_at: string
          ddd: string | null
          email: string | null
          external_id: string | null
          first_name: string | null
          first_purchase_at: string | null
          gender: string | null
          id: string
          last_name: string | null
          last_purchase_at: string | null
          lead_status: string | null
          opt_out_mass_dispatch: boolean
          phone: string | null
          postcode: string | null
          preferred_style: string | null
          region_type: string | null
          rfm_calculated_at: string | null
          rfm_f_score: number | null
          rfm_frequency_score: number | null
          rfm_m_score: number | null
          rfm_monetary_score: number | null
          rfm_r_score: number | null
          rfm_recency_score: number | null
          rfm_score: number | null
          rfm_segment: string | null
          rfm_total_score: number | null
          rfm_updated_at: string | null
          shoe_size: string | null
          source: string | null
          state: string | null
          store_id: string | null
          tags: string[] | null
          total_orders: number | null
          total_spent: number | null
          updated_at: string
          zoppy_created_at: string | null
          zoppy_id: string
          zoppy_position: string | null
          zoppy_updated_at: string | null
        }
        Insert: {
          address1?: string | null
          address2?: string | null
          age_range?: string | null
          avg_ticket?: number | null
          birth_date?: string | null
          cashback_balance?: number | null
          cashback_expires_at?: string | null
          city?: string | null
          country?: string | null
          coupon_amount?: number | null
          coupon_code?: string | null
          coupon_expiry_date?: string | null
          coupon_min_purchase?: number | null
          coupon_start_date?: string | null
          coupon_type?: string | null
          coupon_used?: boolean | null
          cpf?: string | null
          created_at?: string
          ddd?: string | null
          email?: string | null
          external_id?: string | null
          first_name?: string | null
          first_purchase_at?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          last_purchase_at?: string | null
          lead_status?: string | null
          opt_out_mass_dispatch?: boolean
          phone?: string | null
          postcode?: string | null
          preferred_style?: string | null
          region_type?: string | null
          rfm_calculated_at?: string | null
          rfm_f_score?: number | null
          rfm_frequency_score?: number | null
          rfm_m_score?: number | null
          rfm_monetary_score?: number | null
          rfm_r_score?: number | null
          rfm_recency_score?: number | null
          rfm_score?: number | null
          rfm_segment?: string | null
          rfm_total_score?: number | null
          rfm_updated_at?: string | null
          shoe_size?: string | null
          source?: string | null
          state?: string | null
          store_id?: string | null
          tags?: string[] | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string
          zoppy_created_at?: string | null
          zoppy_id: string
          zoppy_position?: string | null
          zoppy_updated_at?: string | null
        }
        Update: {
          address1?: string | null
          address2?: string | null
          age_range?: string | null
          avg_ticket?: number | null
          birth_date?: string | null
          cashback_balance?: number | null
          cashback_expires_at?: string | null
          city?: string | null
          country?: string | null
          coupon_amount?: number | null
          coupon_code?: string | null
          coupon_expiry_date?: string | null
          coupon_min_purchase?: number | null
          coupon_start_date?: string | null
          coupon_type?: string | null
          coupon_used?: boolean | null
          cpf?: string | null
          created_at?: string
          ddd?: string | null
          email?: string | null
          external_id?: string | null
          first_name?: string | null
          first_purchase_at?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          last_purchase_at?: string | null
          lead_status?: string | null
          opt_out_mass_dispatch?: boolean
          phone?: string | null
          postcode?: string | null
          preferred_style?: string | null
          region_type?: string | null
          rfm_calculated_at?: string | null
          rfm_f_score?: number | null
          rfm_frequency_score?: number | null
          rfm_m_score?: number | null
          rfm_monetary_score?: number | null
          rfm_r_score?: number | null
          rfm_recency_score?: number | null
          rfm_score?: number | null
          rfm_segment?: string | null
          rfm_total_score?: number | null
          rfm_updated_at?: string | null
          shoe_size?: string | null
          source?: string | null
          state?: string | null
          store_id?: string | null
          tags?: string[] | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string
          zoppy_created_at?: string | null
          zoppy_id?: string
          zoppy_position?: string | null
          zoppy_updated_at?: string | null
        }
        Relationships: []
      }
      zoppy_sales: {
        Row: {
          completed_at: string | null
          coupon_code: string | null
          created_at: string
          customer_data: Json | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number | null
          external_id: string | null
          id: string
          line_items: Json | null
          shipping: number | null
          status: string
          subtotal: number | null
          total: number | null
          updated_at: string
          zoppy_created_at: string | null
          zoppy_order_id: string
          zoppy_updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_data?: Json | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number | null
          external_id?: string | null
          id?: string
          line_items?: Json | null
          shipping?: number | null
          status?: string
          subtotal?: number | null
          total?: number | null
          updated_at?: string
          zoppy_created_at?: string | null
          zoppy_order_id: string
          zoppy_updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_data?: Json | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number | null
          external_id?: string | null
          id?: string
          line_items?: Json | null
          shipping?: number | null
          status?: string
          subtotal?: number | null
          total?: number | null
          updated_at?: string
          zoppy_created_at?: string | null
          zoppy_order_id?: string
          zoppy_updated_at?: string | null
        }
        Relationships: []
      }
      zoppy_sync_log: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          records_synced: number | null
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          records_synced?: number | null
          started_at?: string
          status?: string
          sync_type?: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          records_synced?: number | null
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      campaign_shadow_report_v: {
        Row: {
          category: string | null
          cost_total_brl: number | null
          first_at: string | null
          in_enforcement: number | null
          in_shadow: number | null
          last_at: string | null
          provider: string | null
          queue: string | null
          shadow_mode: boolean | null
          total_inserted: number | null
        }
        Relationships: []
      }
      crm_customers_v: {
        Row: {
          avg_ticket: number | null
          city: string | null
          cpf: string | null
          created_at: string | null
          ddd: string | null
          email: string | null
          first_name: string | null
          first_purchase_at: string | null
          gender: string | null
          id: string | null
          is_archived: boolean | null
          last_name: string | null
          last_purchase_at: string | null
          lead_temperature: string | null
          name: string | null
          opt_out_mass_dispatch: boolean | null
          payment_methods: string[] | null
          phone: string | null
          phone_e164: string | null
          phone_suffix8: string | null
          purchased_brands: string[] | null
          purchased_categories: string[] | null
          purchased_sizes: string[] | null
          purchased_stores: string[] | null
          region_type: string | null
          rfm_frequency_score: number | null
          rfm_monetary_score: number | null
          rfm_recency_score: number | null
          rfm_segment: string | null
          rfm_total_score: number | null
          state: string | null
          tags: string[] | null
          total_orders: number | null
          total_spent: number | null
          updated_at: string | null
          zoppy_id: string | null
        }
        Insert: {
          avg_ticket?: number | null
          city?: string | null
          cpf?: string | null
          created_at?: string | null
          ddd?: string | null
          email?: string | null
          first_name?: never
          first_purchase_at?: string | null
          gender?: string | null
          id?: string | null
          is_archived?: boolean | null
          last_name?: never
          last_purchase_at?: string | null
          lead_temperature?: string | null
          name?: string | null
          opt_out_mass_dispatch?: boolean | null
          payment_methods?: string[] | null
          phone?: string | null
          phone_e164?: string | null
          phone_suffix8?: string | null
          purchased_brands?: string[] | null
          purchased_categories?: string[] | null
          purchased_sizes?: string[] | null
          purchased_stores?: string[] | null
          region_type?: never
          rfm_frequency_score?: number | null
          rfm_monetary_score?: number | null
          rfm_recency_score?: number | null
          rfm_segment?: string | null
          rfm_total_score?: number | null
          state?: string | null
          tags?: string[] | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string | null
          zoppy_id?: string | null
        }
        Update: {
          avg_ticket?: number | null
          city?: string | null
          cpf?: string | null
          created_at?: string | null
          ddd?: string | null
          email?: string | null
          first_name?: never
          first_purchase_at?: string | null
          gender?: string | null
          id?: string | null
          is_archived?: boolean | null
          last_name?: never
          last_purchase_at?: string | null
          lead_temperature?: string | null
          name?: string | null
          opt_out_mass_dispatch?: boolean | null
          payment_methods?: string[] | null
          phone?: string | null
          phone_e164?: string | null
          phone_suffix8?: string | null
          purchased_brands?: string[] | null
          purchased_categories?: string[] | null
          purchased_sizes?: string[] | null
          purchased_stores?: string[] | null
          region_type?: never
          rfm_frequency_score?: number | null
          rfm_monetary_score?: number | null
          rfm_recency_score?: number | null
          rfm_segment?: string | null
          rfm_total_score?: number | null
          state?: string | null
          tags?: string[] | null
          total_orders?: number | null
          total_spent?: number | null
          updated_at?: string | null
          zoppy_id?: string | null
        }
        Relationships: []
      }
      marketing_envios_globais: {
        Row: {
          enviado_em: string | null
          origem: string | null
          origem_id: string | null
          phone: string | null
          phone_suffix8: string | null
          status: string | null
        }
        Relationships: []
      }
      mass_dispatch_roas: {
        Row: {
          attributed_revenue: number | null
          avg_ticket: number | null
          buyers: number | null
          campaign_id: string | null
          conversion_rate: number | null
          name: string | null
          sent_count: number | null
        }
        Relationships: []
      }
      product_master_stock: {
        Row: {
          master_id: string | null
          name: string | null
          store_centro: number | null
          store_lojas_live: number | null
          store_perola: number | null
          store_site: number | null
          store_site_centro: number | null
          total_stock: number | null
          total_variants: number | null
          variants_in_stock: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "products_master"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variant_stock: {
        Row: {
          barcode: string | null
          color: string | null
          image_url: string | null
          master_id: string | null
          name: string | null
          size: string | null
          sku: string | null
          store_centro: number | null
          store_lojas_live: number | null
          store_perola: number | null
          store_site: number | null
          store_site_centro: number | null
          total_stock: number | null
          variant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "products_master"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_report_period: {
        Row: {
          enforced_delivered: number | null
          enforced_inserted: number | null
          fila: string | null
          first_send: string | null
          last_send: string | null
          shadow_delivered: number | null
          shadow_inserted: number | null
        }
        Relationships: []
      }
      v_a1_backfill_summary: {
        Row: {
          distinct_parents_in_pos: number | null
          pos_orphans: number | null
          pos_with_parent: number | null
          total_master_data: number | null
          total_pos_products: number | null
        }
        Relationships: []
      }
      v_a1_orphan_pos_products: {
        Row: {
          barcode: string | null
          id: string | null
          name: string | null
          parent_sku: string | null
          sku: string | null
          status: string | null
          store_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "pos_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      v_products_needs_review: {
        Row: {
          brand: string | null
          category: string | null
          cest: string | null
          cfop: string | null
          cost_price: number | null
          name: string | null
          ncm: string | null
          parent_sku: string | null
          review_reason: string | null
          sale_price: number | null
          sku_count: number | null
          total_stock: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      vip_group_membership_stats: {
        Row: {
          customers: number | null
          group_id: string | null
          group_name: string | null
          leads: number | null
          orphans: number | null
          total_members: number | null
        }
        Relationships: []
      }
      whatsapp_messages_unified: {
        Row: {
          channel: string | null
          created_at: string | null
          direction: string | null
          error_code: string | null
          error_message: string | null
          id: string | null
          is_archived: boolean | null
          is_group: boolean | null
          is_mass_dispatch: boolean | null
          media_type: string | null
          media_url: string | null
          message: string | null
          message_id: string | null
          phone: string | null
          quoted_message_id: string | null
          referral: Json | null
          sender_name: string | null
          sender_user_id: string | null
          status: string | null
          whatsapp_number_id: string | null
        }
        Relationships: []
      }
      whatsapp_numbers_safe: {
        Row: {
          ai_paused: boolean | null
          business_account_id: string | null
          created_at: string | null
          id: string | null
          instagram_account_id: string | null
          instagram_username: string | null
          is_active: boolean | null
          is_default: boolean | null
          is_online: boolean | null
          label: string | null
          last_health_check: string | null
          phone_display: string | null
          phone_number_id: string | null
          provider: string | null
          uazapi_instance_name: string | null
          uazapi_owner: string | null
          uazapi_proxy_managed_city: string | null
          uazapi_proxy_managed_country: string | null
          uazapi_proxy_managed_state: string | null
          uazapi_proxy_mode: string | null
          updated_at: string | null
          wasender_phone_number: string | null
          wasender_session_id: number | null
          zapi_instance_id: string | null
        }
        Insert: {
          ai_paused?: boolean | null
          business_account_id?: string | null
          created_at?: string | null
          id?: string | null
          instagram_account_id?: string | null
          instagram_username?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          is_online?: boolean | null
          label?: string | null
          last_health_check?: string | null
          phone_display?: string | null
          phone_number_id?: string | null
          provider?: string | null
          uazapi_instance_name?: string | null
          uazapi_owner?: string | null
          uazapi_proxy_managed_city?: string | null
          uazapi_proxy_managed_country?: string | null
          uazapi_proxy_managed_state?: string | null
          uazapi_proxy_mode?: string | null
          updated_at?: string | null
          wasender_phone_number?: string | null
          wasender_session_id?: number | null
          zapi_instance_id?: string | null
        }
        Update: {
          ai_paused?: boolean | null
          business_account_id?: string | null
          created_at?: string | null
          id?: string | null
          instagram_account_id?: string | null
          instagram_username?: string | null
          is_active?: boolean | null
          is_default?: boolean | null
          is_online?: boolean | null
          label?: string | null
          last_health_check?: string | null
          phone_display?: string | null
          phone_number_id?: string | null
          provider?: string | null
          uazapi_instance_name?: string | null
          uazapi_owner?: string | null
          uazapi_proxy_managed_city?: string | null
          uazapi_proxy_managed_country?: string | null
          uazapi_proxy_managed_state?: string | null
          uazapi_proxy_mode?: string | null
          updated_at?: string | null
          wasender_phone_number?: string | null
          wasender_session_id?: number | null
          zapi_instance_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _pm_pmd_sync_in_progress: { Args: never; Returns: boolean }
      add_business_days: {
        Args: { p_days: number; p_start: string }
        Returns: string
      }
      analyze_catalog_sync_from_pos: { Args: never; Returns: Json }
      analyze_master_duplicates: {
        Args: { p_limit?: number }
        Returns: {
          base_name: string
          canonical_id: string
          canonical_score: number
          canonical_variant_count: number
          loser_ids: string[]
          loser_variants_total: number
          master_count: number
          sample_examples: Json
          total_variants: number
        }[]
      }
      analyze_variant_normalization: {
        Args: never
        Returns: {
          capitalization_only: number
          color_extracted: number
          empty_after: number
          needs_change: number
          no_change: number
          size_extracted: number
          swap_only: number
          total_variants: number
        }[]
      }
      apply_shopify_links: { Args: { _links: Json }; Returns: number }
      apply_variant_normalization: {
        Args: { p_dry_run?: boolean; p_limit?: number }
        Returns: {
          skipped_empty: number
          updated_count: number
        }[]
      }
      archive_inactive_ads_conversations: {
        Args: { p_batch_size?: number; p_days?: number }
        Returns: {
          archived_messages: number
          archived_phones: number
        }[]
      }
      archive_inactive_broadcast_messages: {
        Args: { p_batch_size?: number; p_days?: number }
        Returns: {
          archived_messages: number
          archived_phones: number
        }[]
      }
      archive_inactive_conversations: {
        Args: { p_batch_size?: number; p_days?: number }
        Returns: {
          archived_messages: number
          archived_phones: number
        }[]
      }
      archive_old_messages_individual: {
        Args: { p_batch_size?: number; p_days?: number; p_keep_recent?: number }
        Returns: {
          affected_phones: number
          archived_count: number
        }[]
      }
      archive_old_whatsapp_messages: {
        Args: { p_batch_size?: number }
        Returns: {
          moved_count: number
        }[]
      }
      audience_filter_options: { Args: never; Returns: Json }
      backfill_estoque_from_pos: { Args: { p_commit?: boolean }; Returns: Json }
      backfill_master_costs_from_pos: {
        Args: never
        Returns: {
          masters_updated: number
          variants_updated: number
        }[]
      }
      backfill_phones_from_pos_customers: {
        Args: { p_dry_run?: boolean }
        Returns: Json
      }
      backfill_pos_products_from_sales:
        | { Args: { p_commit?: boolean }; Returns: Json }
        | {
            Args: { p_clean_only?: boolean; p_commit?: boolean }
            Returns: Json
          }
      bc_match_audience: {
        Args: {
          cv: Database["public"]["Views"]["crm_customers_v"]["Row"]
          exc: Json
          inc: Json
        }
        Returns: boolean
      }
      bc_norm_txt: { Args: { t: string }; Returns: string }
      bc_order_total: {
        Args: { discount_type: string; discount_value: number; products: Json }
        Returns: number
      }
      bc_phone_key: { Args: { p: string }; Returns: string }
      calculate_inventory_health: {
        Args: { p_horizon_days?: number; p_store_id?: string }
        Returns: Json
      }
      calculate_rfm_scores: { Args: never; Returns: Json }
      calculate_rfm_scores_unified: { Args: never; Returns: Json }
      campaign_buyer_detail: { Args: { p_envio_id: string }; Returns: Json }
      campaign_daily_deficit: {
        Args: { p_campanha_id: string }
        Returns: number
      }
      campaign_dashboard_stats: {
        Args: { p_campanha_id: string }
        Returns: Json
      }
      campaign_envios_detail: {
        Args: { p_campanha_id: string }
        Returns: {
          comprou_em: string
          converteu: boolean
          enviado_em: string
          envio_id: string
          erro: string
          nome: string
          phone: string
          status: string
          valor: number
        }[]
      }
      campaign_run_periods: {
        Args: never
        Returns: {
          campanha_id: string
          enviados: number
          primeiro: string
          ultimo: string
        }[]
      }
      campaigns_overview_conversions: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      campaigns_overview_stats: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      check_chargeback_risk: {
        Args: {
          p_address_cep?: string
          p_address_number?: string
          p_customer_cpf?: string
          p_customer_email?: string
          p_customer_name: string
          p_customer_phone?: string
        }
        Returns: Json
      }
      check_order_ai_paused: {
        Args: { p_phone: string }
        Returns: {
          ai_paused: boolean
          order_id: string
        }[]
      }
      check_order_paid: { Args: { p_order_id: string }; Returns: boolean }
      check_touch_quota: {
        Args: {
          p_candidates: Json
          p_exclude_dispatch_id?: string
          p_provider?: string
          p_tipo_comunicacao: string
        }
        Returns: {
          classificacao: string
          eligible: boolean
          last_touch_at: string
          name: string
          phone: string
          reason: string
          toques_no_mes: number
          unified_id: string
        }[]
      }
      claim_dispatch_jobs: {
        Args: {
          p_batch_size?: number
          p_dispatch_id: string
          p_lease_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          id: string
          phone: string
          recipient_name: string
        }[]
      }
      claim_group_dispatch_job: {
        Args: { p_number_id: string }
        Returns: {
          attempts: number
          block_order: number
          block_type: string | null
          campaign_id: string | null
          created_at: string
          delay_after_ms: number
          error_message: string | null
          group_db_id: string
          group_name: string | null
          group_zapi_id: string
          id: string
          locked_until: string | null
          message_group_id: string | null
          scheduled_message_id: string
          send_after: string | null
          sent_at: string | null
          seq: number | null
          status: string
          updated_at: string
          whatsapp_number_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "group_campaign_block_dispatches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      classify_group_member: { Args: { _phone: string }; Returns: string }
      cleanup_webhook_routing_log: { Args: never; Returns: undefined }
      clear_event_live_active: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      consolidate_estoque_parents_by_pos: {
        Args: { p_commit?: boolean }
        Returns: Json
      }
      copy_trigger_messages: {
        Args: { p_source_trigger_id: string; p_target_trigger_id: string }
        Returns: number
      }
      count_campaign_audience: { Args: { p_filtro: Json }; Returns: number }
      count_products_by_brand: {
        Args: never
        Returns: {
          brand_id: string
          total: number
        }[]
      }
      count_products_by_category: {
        Args: never
        Returns: {
          category_id: string
          total: number
        }[]
      }
      create_meta_capi_vault_secret: {
        Args: { p_secret: string }
        Returns: string
      }
      create_product_with_variants: {
        Args: { p_master: Json; p_variants: Json }
        Returns: string
      }
      crm_facet_counts: {
        Args: { p_column: string }
        Returns: {
          cnt: number
          value: string
        }[]
      }
      dedup_outgoing_message: {
        Args: {
          p_cutoff_minutes?: number
          p_message: string
          p_phone: string
          p_whatsapp_number_id?: string
        }
        Returns: {
          id: string
          message_id: string
        }[]
      }
      delete_pos_divergent_parent: {
        Args: { p_parent_sku: string }
        Returns: Json
      }
      delete_pos_divergent_variant: {
        Args: { p_barcode: string; p_parent_sku: string }
        Returns: Json
      }
      dispatch_quota_summary: {
        Args: {
          p_candidates: Json
          p_exclude_dispatch_id?: string
          p_provider?: string
          p_sample_size?: number
          p_tipo_comunicacao: string
        }
        Returns: Json
      }
      enqueue_campanha_envios_guarded: {
        Args: {
          p_campanha_id: string
          p_candidates: Json
          p_overrides?: Json
          p_shadow_mode?: boolean
          p_template_category?: string
          p_tipo_comunicacao: string
        }
        Returns: Json
      }
      enqueue_dispatch_recipients_guarded:
        | {
            Args: {
              p_candidates: Json
              p_dispatch_id: string
              p_overrides?: Json
              p_provider?: string
              p_tipo_comunicacao: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_candidates: Json
              p_dispatch_id: string
              p_overrides?: Json
              p_provider?: string
              p_skip_unify?: boolean
              p_tipo_comunicacao: string
            }
            Returns: Json
          }
      enqueue_live_campaign_dispatches_guarded: {
        Args: {
          p_campaign_id: string
          p_candidates: Json
          p_message_id: string
          p_provider?: string
          p_shadow_mode?: boolean
          p_template_category?: string
          p_tipo_comunicacao: string
        }
        Returns: Json
      }
      enqueue_mass_dispatch_targets_guarded: {
        Args: {
          p_campaign_id: string
          p_candidates: Json
          p_provider?: string
          p_shadow_mode?: boolean
          p_template_category?: string
          p_tipo_comunicacao: string
        }
        Returns: Json
      }
      event_buyer_origin_matrix: { Args: { p_event_id: string }; Returns: Json }
      event_inner_dashboard: { Args: { p_event_id: string }; Returns: Json }
      event_lead_cohorts: { Args: { p_event_id: string }; Returns: Json }
      event_phone_key: { Args: { p_phone: string }; Returns: string }
      execute_merge_unified_duplicates: {
        Args: { p_dry_run?: boolean; p_rule?: string }
        Returns: Json
      }
      extract_base_product_name: { Args: { p_name: string }; Returns: string }
      extract_phone_ddd_suffix: { Args: { raw_phone: string }; Returns: string }
      extract_phone_suffix8: { Args: { phone_input: string }; Returns: string }
      finalize_completed_dispatches: { Args: never; Returns: number }
      find_or_create_unified_customer: {
        Args: {
          p_cpf?: string
          p_email?: string
          p_ig_user_id?: string
          p_instagram?: string
          p_name?: string
          p_phone?: string
          p_source?: string
        }
        Returns: string
      }
      format_customer_code: { Args: { seq_val: number }; Returns: string }
      gen_unique_ean13: { Args: never; Returns: string }
      gen_unique_variant_sku: { Args: { p_base: string }; Returns: string }
      generate_ean13_barcode: { Args: never; Returns: string }
      generate_ean13_internal: { Args: never; Returns: string }
      get_abc_curve_products: {
        Args: { p_days?: number; p_store_id?: string }
        Returns: {
          abc_class: string
          brand: string
          category: string
          cum_pct: number
          master_name: string
          parent_sku: string
          qty: number
          rank: number
          revenue: number
          revenue_pct: number
          sales_count: number
        }[]
      }
      get_abc_curve_sizes: {
        Args: { p_days?: number; p_store_id?: string }
        Returns: {
          abc_class: string
          cum_pct: number
          qty: number
          rank: number
          revenue: number
          revenue_pct: number
          size_label: string
        }[]
      }
      get_active_mp_account: {
        Args: never
        Returns: {
          access_token: string
          id: string
          is_sandbox: boolean
          mp_user_id: string
          name: string
          public_key: string
        }[]
      }
      get_agent_memory: { Args: { p_mes_ref?: string }; Returns: Json }
      get_attendant_metrics: {
        Args: { p_end_date?: string; p_start_date?: string; p_user_id?: string }
        Returns: {
          active_conversations: number
          avg_first_response_minutes: number
          conversations_today: number
          display_name: string
          finished_conversations: number
          total_conversations: number
          total_messages_received: number
          total_messages_sent: number
          user_id: string
        }[]
      }
      get_automation_exec_stats: {
        Args: never
        Returns: {
          failed: number
          flow_id: string
          last_at: string
          success: number
          total: number
        }[]
      }
      get_campaign_results: {
        Args: { p_ate: string; p_desde: string }
        Returns: Json
      }
      get_checkout_order: { Args: { p_order_id: string }; Returns: Json }
      get_checkout_registration: { Args: { p_order_id: string }; Returns: Json }
      get_classificacao_summary: { Args: never; Returns: Json }
      get_conversation_counts: {
        Args: never
        Returns: {
          awaiting_count: number
          new_count: number
        }[]
      }
      get_conversation_instance: { Args: { p_phone: string }; Returns: string }
      get_conversations: {
        Args: { p_dispatch_only?: boolean; p_number_id?: string }
        Returns: {
          channel: string
          direction: string
          has_incoming: boolean
          has_outgoing: boolean
          is_dispatch_only: boolean
          is_group: boolean
          last_message: string
          last_message_at: string
          phone: string
          sender_name: string
          status: string
          unread_count: number
          whatsapp_number_id: string
        }[]
      }
      get_customer_chat_history: {
        Args: { p_phone: string }
        Returns: {
          created_at: string
          direction: string
          id: string
          is_group: boolean
          media_type: string
          media_url: string
          message: string
          phone: string
          sender_name: string
          status: string
          whatsapp_number_id: string
        }[]
      }
      get_customer_last_address: {
        Args: { p_customer_id: string }
        Returns: Json
      }
      get_customer_lookup: { Args: { p_query: string }; Returns: Json }
      get_customer_store_seller_map: {
        Args: never
        Returns: {
          customer_phone: string
          seller_id: string
          seller_name: string
          store_id: string
          store_name: string
        }[]
      }
      get_customers_for_opportunities: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          age_range: string
          avg_ticket: number
          cashback_balance: number
          cashback_expires_at: string
          cpf: string
          created_at: string
          email: string
          first_purchase_at: string
          id: string
          last_purchase_at: string
          lead_status: string
          name: string
          preferred_style: string
          shoe_size: string
          source: string
          store_id: string
          total_orders: number
          total_spent: number
          whatsapp: string
        }[]
      }
      get_dispatch_pressure: {
        Args: { p_ate: string; p_desde: string }
        Returns: Json
      }
      get_dispatchable_scheduled_messages: {
        Args: { p_limit?: number }
        Returns: {
          block_order: number
          campaign_id: string
          id: string
          locked_until: string
          message_group_id: string
          scheduled_at: string
          status: string
        }[]
      }
      get_dispatches_with_pending: {
        Args: { p_limit?: number }
        Returns: {
          dispatch_id: string
          pending_count: number
        }[]
      }
      get_event_installment_config: {
        Args: { p_event_id: string }
        Returns: Json
      }
      get_events_performance: { Args: { p_mes_ref: string }; Returns: Json }
      get_group_dispatch_ready_instances: {
        Args: never
        Returns: {
          whatsapp_number_id: string
        }[]
      }
      get_group_member_activity: {
        Args: { p_group_id: string }
        Returns: {
          last_activity_at: string
          messages: number
          phone: string
          poll_votes: number
          reactions: number
          total: number
        }[]
      }
      get_inventory_summary: {
        Args: never
        Returns: {
          store_id: string
          total_cost: number
          total_items: number
          total_skus: number
          total_value: number
          zero_stock: number
        }[]
      }
      get_latest_registration_by_customer: {
        Args: { p_customer_id: string }
        Returns: {
          address: string
          address_number: string
          cep: string
          city: string
          complement: string | null
          cpf: string
          created_at: string
          customer_id: string | null
          email: string
          fbc: string | null
          fbp: string | null
          full_name: string
          id: string
          neighborhood: string
          order_id: string
          shopify_draft_order_id: string | null
          shopify_draft_order_name: string | null
          state: string
          status: string
          updated_at: string
          whatsapp: string
        }[]
        SetofOptions: {
          from: "*"
          to: "customer_registrations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_leads_by_channel: {
        Args: { p_ate: string; p_desde: string }
        Returns: Json
      }
      get_leads_for_recovery: {
        Args: never
        Returns: {
          cart_items: Json
          cart_total: number
          chosen_payment_method: string
          created_at: string
          id: string
          name: string
          phone: string
          pix_code: string
          pix_expires_at: string
          recovery_disparo: number
          recovery_session_id: string
          recovery_ultimo_disparo_at: string
          source_table: string
          status: string
        }[]
      }
      get_leads_lookup: {
        Args: { p_ate?: string; p_desde?: string; p_query?: string }
        Returns: Json
      }
      get_live_events_summary: { Args: { p_mes_ref: string }; Returns: Json }
      get_meta_capi_vault_state: {
        Args: never
        Returns: {
          id: string
          value: string
        }[]
      }
      get_mp_token_by_payment_id: {
        Args: { p_payment_id: string }
        Returns: {
          access_token: string
          account_id: string
          account_name: string
          is_sandbox: boolean
          source_type: string
        }[]
      }
      get_mp_token_for_order: {
        Args: { p_order_id: string }
        Returns: {
          access_token: string
          account_id: string
          account_name: string
          is_sandbox: boolean
        }[]
      }
      get_mp_token_for_sale: {
        Args: { p_sale_id: string }
        Returns: {
          access_token: string
          account_id: string
          account_name: string
          is_sandbox: boolean
        }[]
      }
      get_next_fiscal_number: {
        Args: {
          p_ambiente?: string
          p_company_id: string
          p_modelo: number
          p_serie?: number
        }
        Returns: {
          next_number: number
          out_ambiente: string
          out_modelo: number
          out_serie: number
        }[]
      }
      get_order_status: { Args: { p_order_id: string }; Returns: Json }
      get_orders_by_customer: {
        Args: { p_customer_id: string }
        Returns: {
          appmax_order_id: string
          cart_link: string
          checkout_started_at: string
          checkout_token: string
          computed_total: number
          coupon_code: string
          created_at: string
          customer_id: string
          discount_applied: number
          discount_type: string
          discount_value: number
          eligible_for_prize: boolean
          event_id: string
          free_shipping: boolean
          has_gift: boolean
          has_unread_messages: boolean
          id: string
          is_paid: boolean
          last_customer_message_at: string
          last_sent_message_at: string
          mercadopago_payment_id: string
          notes: string
          pagarme_order_id: string
          paid_at: string
          paid_externally: boolean
          products: Json
          shipping_applied: number
          shipping_cost: number
          stage: string
          subtotal: number
          updated_at: string
          vindi_transaction_id: string
        }[]
      }
      get_pos_whatsapp_dashboard: {
        Args: { p_days?: number; p_store_id: string }
        Returns: Json
      }
      get_provider_cost: {
        Args: { p_category?: string; p_provider: string }
        Returns: number
      }
      get_reactivation_candidates: { Args: { p_limit?: number }; Returns: Json }
      get_registration_by_cpf: { Args: { p_cpf: string }; Returns: Json }
      get_rfm_summary: { Args: never; Returns: Json }
      get_sale_installment_override: {
        Args: { p_sale_id: string }
        Returns: Json
      }
      get_sales_vs_goals: { Args: { p_mes_ref: string }; Returns: Json }
      get_shadow_report: {
        Args: { p_ate: string; p_desde: string }
        Returns: Json
      }
      get_stock_by_size: { Args: { p_filtros?: Json }; Returns: Json }
      get_top_customers: {
        Args: { p_limite?: number; p_segmento?: string }
        Returns: Json
      }
      get_user_allowed_modules: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      guard_automation_dispatch: {
        Args: {
          p_flow_id: string
          p_phone: string
          p_provider?: string
          p_template_category?: string
          p_tipo_comunicacao: string
        }
        Returns: Json
      }
      has_module_access: {
        Args: { _module: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_campaign_leads_captured: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      increment_execution_count: {
        Args: { message_id: string }
        Returns: undefined
      }
      inventory_claim_correction_batch: {
        Args: { p_batch_size: number; p_count_id: string }
        Returns: {
          attempts: number | null
          count_id: string
          count_item_id: string
          created_at: string
          error_message: string | null
          id: string
          max_attempts: number | null
          new_quantity: number
          old_quantity: number | null
          processed_at: string | null
          product_id: string
          product_name: string
          status: string
          store_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "inventory_correction_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_cpf_mergeable: { Args: { p_cpf: string }; Returns: boolean }
      is_email_placeholder: { Args: { p_email: string }; Returns: boolean }
      is_generic_email: { Args: { raw: string }; Returns: boolean }
      is_phone_generic: { Args: { p_suffix8: string }; Returns: boolean }
      is_sync_in_progress: { Args: never; Returns: boolean }
      is_unified_inventory_enabled: { Args: never; Returns: boolean }
      lead_campaign_counts: {
        Args: never
        Returns: {
          cnt: number
          value: string
        }[]
      }
      legacy_master_variants: {
        Args: { p_master_id: string }
        Returns: {
          color: string
          gtin: string
          id: string
          is_active: boolean
          size: string
          sku: string
          stock: number
        }[]
      }
      legacy_masters_summary: {
        Args: { p_master_ids: string[] }
        Returns: {
          master_id: string
          total_stock: number
          variant_count: number
        }[]
      }
      list_campaign_audience: {
        Args: { p_filtro: Json; p_limit?: number; p_offset?: number }
        Returns: {
          avg_ticket: number
          city: string
          cliente_id: string
          last_purchase_at: string
          nome: string
          phone: string
          state: string
          tamanhos: string[]
          total_orders: number
        }[]
      }
      list_nfe_emitters: {
        Args: never
        Returns: {
          ambiente_nfe: string
          cnpj: string
          has_brasilnfe_token: boolean
          id: string
          is_active: boolean
          legal_name: string
          trade_name: string
        }[]
      }
      list_pos_estoque_divergences: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          barcode: string
          category: string
          color: string
          name: string
          parent_sku: string
          sem_gtin: boolean
          size: string
          sku: string
          store_count: number
        }[]
      }
      list_pos_estoque_divergences_grouped: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          has_master: boolean
          parent_name: string
          parent_sku: string
          total_divergent_stock: number
          total_divergent_variants: number
          variants: Json
        }[]
      }
      list_unack_template_alerts: {
        Args: never
        Returns: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          cost_delta_pct: number | null
          cost_new_brl: number | null
          cost_previous_brl: number | null
          created_at: string
          detected_at: string
          id: string
          new_category: string
          previous_category: string | null
          template_language: string
          template_name: string
          updated_at: string
          whatsapp_number_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "meta_template_category_alerts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      lookup_cashback_by_phones: {
        Args: { p_phones: string[] }
        Returns: {
          cashback_amount: number
          cashback_count: number
          coupon_code: string
          expires_at: string
          generated_at: string
          min_purchase: number
          phone: string
          total_available: number
        }[]
      }
      lookup_crm_by_phones: {
        Args: { p_phones: string[] }
        Returns: {
          crm_name: string
          crm_source: string
          crm_source_id: string
          phone: string
        }[]
      }
      lookup_customer_by_whatsapp: {
        Args: { p_whatsapp: string }
        Returns: {
          created_at: string
          id: string
          instagram_handle: string
          is_banned: boolean
          tags: string[]
          whatsapp: string
        }[]
      }
      mark_dispatch_sent: {
        Args: { p_ids: string[]; p_wamids: string[] }
        Returns: undefined
      }
      mark_lead_as_paid: { Args: { p_whatsapp: string }; Returns: undefined }
      match_event_leads: {
        Args: { p_event_id: string; p_phones: string[] }
        Returns: {
          other_event: boolean
          other_event_name: string
          other_source: string
          phone_key: string
          this_event: boolean
        }[]
      }
      merge_duplicate_zoppy_customers: {
        Args: never
        Returns: {
          duplicates_found: number
          records_deleted: number
        }[]
      }
      merge_master_duplicates: { Args: { p_limit?: number }; Returns: Json }
      merge_product_color: {
        Args: { _source_id: string; _target_id: string }
        Returns: undefined
      }
      merge_product_size: {
        Args: { _source_id: string; _target_id: string }
        Returns: undefined
      }
      merge_selected_masters: {
        Args: { p_source_ids: string[]; p_target_id: string }
        Returns: Json
      }
      merge_tiny_online_duplicates: {
        Args: never
        Returns: {
          duplicates_found: number
          records_deleted: number
          records_merged: number
        }[]
      }
      merge_unified_zoppy_duplicates: { Args: never; Returns: Json }
      next_product_sku_root: { Args: never; Returns: string }
      norm_cpf: { Args: { raw: string }; Returns: string }
      norm_email: { Args: { raw: string }; Returns: string }
      norm_instagram: { Args: { raw: string }; Returns: string }
      norm_phone_br: { Args: { raw: string }; Returns: string }
      norm_txt: { Args: { t: string }; Returns: string }
      normalize_address_key: {
        Args: { p_cep: string; p_number: string }
        Returns: string
      }
      normalize_phone_br: { Args: { p_raw: string }; Returns: string }
      normalize_variant_color_size: {
        Args: { p_color: string; p_master_name?: string; p_size: string }
        Returns: {
          new_color: string
          new_size: string
        }[]
      }
      normalize_wa_status: { Args: { raw: string }; Returns: string }
      parse_brand_from_name: { Args: { p_name: string }; Returns: string }
      parse_category_from_name: { Args: { p_name: string }; Returns: string }
      parse_payment_methods: { Args: { p_text: string }; Returns: string[] }
      parse_size_from_name: { Args: { p_name: string }; Returns: string }
      participant_score_ranking: {
        Args: { p_handles?: string[] }
        Returns: {
          avg_ticket: number
          cancelled_orders: number
          category: string
          comment_count: number
          handle: string
          last_participation: string
          live_count: number
          live_dates: string[]
          paid_orders: number
          score: number
          total_spent: number
        }[]
      }
      phone_ddd: { Args: { e164: string }; Returns: string }
      phone_suffix8: { Args: { e164: string }; Returns: string }
      pos_estoque_divergence_summary: { Args: never; Returns: Json }
      pos_sale_to_faturamento: {
        Args: { p_sale_id: string }
        Returns: undefined
      }
      process_pos_sale_sale_event: {
        Args: { p_sale_id: string }
        Returns: undefined
      }
      product_name_key: { Args: { p_name: string }; Returns: string }
      quota_check_with_snapshot: {
        Args: {
          p_candidates: Json
          p_exclude_dispatch_id?: string
          p_provider: string
          p_template_category: string
          p_tipo_comunicacao: string
        }
        Returns: {
          classificacao: string
          eligible: boolean
          name: string
          phone: string
          provider: string
          reason: string
          template_category: string
          toques_no_mes: number
          unified_id: string
          unit_cost_brl: number
        }[]
      }
      recalc_customer_metrics: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      recalc_customer_payment_store_attrs: {
        Args: { p_customer?: string }
        Returns: undefined
      }
      recalc_customer_product_attributes: {
        Args: { p_customer?: string }
        Returns: undefined
      }
      recalculate_lead_temperature: { Args: never; Returns: Json }
      recompute_needs_review: { Args: never; Returns: number }
      redeem_internal_cashback: {
        Args: {
          _channel?: string
          _coupon_code: string
          _external_ref?: string
          _subtotal?: number
        }
        Returns: Json
      }
      refresh_dispatch_counts: {
        Args: { p_dispatch_id: string }
        Returns: undefined
      }
      refresh_vip_orphans: { Args: never; Returns: Json }
      register_template_category_change: {
        Args: {
          p_language: string
          p_new_category: string
          p_template_name: string
          p_whatsapp_number_id: string
        }
        Returns: undefined
      }
      reopen_finished_conversation: {
        Args: { p_phone: string }
        Returns: number
      }
      resolve_campaign_template: {
        Args: { p_campanha_id: string }
        Returns: {
          aprovado: boolean
          category_last_synced_at: string | null
          created_at: string
          event_id: string | null
          id: string
          meta_status: string
          nome: string
          observacao: string | null
          qtd_cards: number
          scope: string
          template_category: string | null
          template_id: string
          template_language: string
          updated_at: string
          whatsapp_number_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "templates_carrossel"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_customer_unified: {
        Args: { p_cpf?: string; p_phone: string }
        Returns: string
      }
      resolve_fiscal_rule: {
        Args: {
          p_ncm: string
          p_tipo_operacao?: string
          p_uf_destino: string
          p_uf_origem: string
        }
        Returns: {
          aliq_cofins: number | null
          aliq_icms: number | null
          aliq_pis: number | null
          cfop: string
          created_at: string
          csosn_icms: string | null
          cst_cofins: string
          cst_icms: string | null
          cst_pis: string
          description: string | null
          id: string
          is_active: boolean
          ncm: string | null
          origem_mercadoria: number
          priority: number
          tipo_operacao: string
          uf_destino: string | null
          uf_origem: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_or_create_unified_customer: {
        Args: { p_name?: string; p_phone: string }
        Returns: string
      }
      resolve_payment_fee: {
        Args: {
          p_acquirer: string
          p_installments: number
          p_method: string
          p_product: string
        }
        Returns: {
          acquirer: string
          active: boolean
          brand: string | null
          created_at: string
          days_to_receive: number
          fee_pct: number
          fixed_fee: number
          id: string
          installments: number
          method: string
          notes: string | null
          product: string
          receipt_schedule: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_method_fees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_pos_sale_item_stock: {
        Args: { p_barcode: string; p_sale_id: string; p_sku: string }
        Returns: undefined
      }
      revert_merge_batch: { Args: { p_batch_id: string }; Returns: Json }
      sample_variant_normalization: {
        Args: { p_limit?: number }
        Returns: {
          change_type: string
          master_name: string
          new_color: string
          new_size: string
          old_color: string
          old_size: string
          variant_id: string
        }[]
      }
      save_customer_registration: {
        Args: {
          p_address: string
          p_address_number: string
          p_cep: string
          p_city?: string
          p_complement?: string
          p_cpf: string
          p_customer_id?: string
          p_email: string
          p_full_name: string
          p_neighborhood?: string
          p_order_id: string
          p_state?: string
          p_whatsapp: string
        }
        Returns: string
      }
      search_all_conversations: {
        Args: { p_query: string }
        Returns: {
          instance_label: string
          is_archived: boolean
          is_finished: boolean
          last_message: string
          last_message_at: string
          message_count: number
          phone: string
          sender_name: string
          whatsapp_number_id: string
        }[]
      }
      search_products_unaccent: {
        Args: { p_store_id: string; search_term: string }
        Returns: {
          age_group: string | null
          auto_classified: boolean
          barcode: string
          brand: string | null
          category: string | null
          category_id: string | null
          classification_confidence: number | null
          color: string | null
          cost_price: number | null
          created_at: string
          gender: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          parent_sku: string | null
          price: number
          price_tier_id: string | null
          size: string | null
          sku: string
          stock: number
          store_id: string
          synced_at: string
          tiny_id: number | null
          updated_at: string
          variant: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pos_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      select_campaign_batch: {
        Args: {
          p_campanha_id: string
          p_global_cap_days?: number
          p_ignore_global_cap?: boolean
          p_limit?: number
        }
        Returns: {
          cliente_id: string
          nome: string
          phone: string
          phone_suffix8: string
          primeiro_nome: string
          tamanhos: string[]
        }[]
      }
      set_active_mp_account: {
        Args: { p_account_id: string }
        Returns: boolean
      }
      set_event_live_active: { Args: { p_event_id: string }; Returns: string }
      set_fiscal_sequence_start: {
        Args: {
          p_ambiente: string
          p_company_id: string
          p_modelo: number
          p_notes?: string
          p_serie: number
          p_starting_number: number
        }
        Returns: number
      }
      shadow_cycle_check_big_live: { Args: never; Returns: Json }
      shadow_cycle_ready_for_report: { Args: never; Returns: Json }
      shadow_report_period: {
        Args: { p_since?: string; p_until?: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      simulate_classificacao_disparo: { Args: never; Returns: Json }
      simulate_merge_unified_duplicates: { Args: never; Returns: Json }
      slugify_dict: { Args: { _input: string }; Returns: string }
      snapshot_group_message_exposure: {
        Args: {
          p_group_campaign_id: string
          p_group_campaign_message_id: string
          p_group_jid: string
        }
        Returns: number
      }
      sync_lead_pix_data: {
        Args: {
          p_chosen_payment_method: string
          p_pix_code: string
          p_pix_expires_at: string
          p_whatsapp: string
        }
        Returns: undefined
      }
      title_case_color: { Args: { p_color: string }; Returns: string }
      transfer_products_brand: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      transfer_products_category: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      try_claim_scheduled_message: {
        Args: { p_lock_duration_seconds?: number; p_message_id: string }
        Returns: {
          claimed_id: string
          message_group_id: string
          was_recovery: boolean
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      unified_inventory_apply_nfe_entry: {
        Args: {
          p_barcode: string
          p_color: string
          p_invoice_id: string
          p_invoice_item_id: string
          p_master: Json
          p_parent_sku: string
          p_quantity: number
          p_size: string
          p_sku: string
          p_store_id: string
          p_unit_cost: number
        }
        Returns: Json
      }
      unify_upsert_customers: { Args: { p_records: Json }; Returns: Json }
      update_lead_recovery: {
        Args: {
          p_disparo: number
          p_lead_id: string
          p_session_id: string
          p_source_table: string
        }
        Returns: undefined
      }
      update_meta_capi_vault_secret: {
        Args: { p_id: string; p_secret: string }
        Returns: boolean
      }
      update_order_stage: {
        Args: { p_order_id: string; p_stage: string }
        Returns: undefined
      }
      upsert_landing_customer: {
        Args: { p_instagram: string; p_phone: string; p_tag: string }
        Returns: undefined
      }
      vip_group_member_phone_suffixes: { Args: never; Returns: string[] }
      vip_groups_interaction_ranking: {
        Args: { p_days?: number }
        Returns: {
          active_members: number
          group_id: string
          member_count: number
          messages: number
          name: string
          photo_url: string
          poll_votes: number
          reactions: number
          total_activities: number
        }[]
      }
      vip_groups_overview: {
        Args: never
        Returns: {
          groups_with_activity: number
          total_activities: number
          total_groups: number
          total_members: number
          total_memberships: number
        }[]
      }
      vip_groups_sales_ranking: {
        Args: { p_days?: number; p_window_days?: number }
        Returns: {
          buyers: number
          group_id: string
          name: string
          photo_url: string
          revenue: number
          sales_count: number
        }[]
      }
      vip_leads_ranking: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          customer_id: string
          customer_name: string
          display_name: string
          groups_count: number
          last_activity_at: string
          messages: number
          phone: string
          poll_votes: number
          reactions: number
          source_origins: Json
          total_activities: number
        }[]
      }
      vip_link_funnel: {
        Args: { p_days?: number }
        Returns: {
          campaign_clicks: number
          campaign_id: string
          campaign_name: string
          clicks: number
          customers_tagged: number
          estimated_entries: number
          group_entries: number
          group_names: string[]
          label: string
          leads_created: number
          link_id: string
          redirect_count: number
          slug: string
        }[]
      }
      wa_status_rank: { Args: { s: string }; Returns: number }
      zoppy_origin_class: { Args: { p_zoppy_id: string }; Returns: string }
    }
    Enums: {
      ambiente_nfe: "homologacao" | "producao"
      app_role: "admin" | "manager" | "user"
      event_channel: "site" | "pos_perola" | "pos_centro"
      exchange_reason_category:
        | "tamanho"
        | "defeito"
        | "nao_gostou"
        | "produto_errado"
        | "outro"
      exchange_status:
        | "solicitado"
        | "aprovado"
        | "aguardando_postagem"
        | "em_transito"
        | "recebido"
        | "concluido"
        | "recusado"
        | "cancelado"
      ledger_book: "faturamento" | "realidade"
      pedido_motivo_cancelamento: "troca" | "devolucao"
      pedido_status_cancelamento: "ativo" | "cancelado"
      pos_revenue_attribution: "store" | "site_pickup_only"
      regime_tributario:
        | "simples_nacional"
        | "lucro_presumido"
        | "lucro_real"
        | "mei"
      td_estado_estoque:
        | "reservado"
        | "despachado"
        | "retornado_vendavel"
        | "retornado_avaria"
      td_item_direcao: "devolvido" | "reposicao"
      td_modo_expedicao: "aguarda_retorno" | "despacho_antecipado"
      td_motivo:
        | "defeito_avaria"
        | "tamanho"
        | "arrependimento"
        | "erro_expedicao"
        | "outro"
      td_origem_canal: "fisica" | "site"
      td_status:
        | "iniciada"
        | "aguardando_retorno"
        | "recebido_conferencia"
        | "aguardando_envio"
        | "concluida"
        | "cancelada"
      td_tipo: "troca" | "devolucao"
      voucher_status: "ativo" | "usado" | "expirado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ambiente_nfe: ["homologacao", "producao"],
      app_role: ["admin", "manager", "user"],
      event_channel: ["site", "pos_perola", "pos_centro"],
      exchange_reason_category: [
        "tamanho",
        "defeito",
        "nao_gostou",
        "produto_errado",
        "outro",
      ],
      exchange_status: [
        "solicitado",
        "aprovado",
        "aguardando_postagem",
        "em_transito",
        "recebido",
        "concluido",
        "recusado",
        "cancelado",
      ],
      ledger_book: ["faturamento", "realidade"],
      pedido_motivo_cancelamento: ["troca", "devolucao"],
      pedido_status_cancelamento: ["ativo", "cancelado"],
      pos_revenue_attribution: ["store", "site_pickup_only"],
      regime_tributario: [
        "simples_nacional",
        "lucro_presumido",
        "lucro_real",
        "mei",
      ],
      td_estado_estoque: [
        "reservado",
        "despachado",
        "retornado_vendavel",
        "retornado_avaria",
      ],
      td_item_direcao: ["devolvido", "reposicao"],
      td_modo_expedicao: ["aguarda_retorno", "despacho_antecipado"],
      td_motivo: [
        "defeito_avaria",
        "tamanho",
        "arrependimento",
        "erro_expedicao",
        "outro",
      ],
      td_origem_canal: ["fisica", "site"],
      td_status: [
        "iniciada",
        "aguardando_retorno",
        "recebido_conferencia",
        "aguardando_envio",
        "concluida",
        "cancelada",
      ],
      td_tipo: ["troca", "devolucao"],
      voucher_status: ["ativo", "usado", "expirado"],
    },
  },
} as const
