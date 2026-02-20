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
        ]
      }
      automation_dispatch_sent: {
        Row: {
          flow_id: string
          id: string
          phone: string
          sent_at: string
        }
        Insert: {
          flow_id: string
          id?: string
          phone: string
          sent_at?: string
        }
        Update: {
          flow_id?: string
          id?: string
          phone?: string
          sent_at?: string
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
          name: string
          trigger_config: Json | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string
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
      bank_transactions: {
        Row: {
          ai_category_id: string | null
          ai_confidence: number | null
          amount: number
          bank_account_id: string
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
          bank_account_id: string
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
          bank_account_id?: string
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
      chat_contacts: {
        Row: {
          created_at: string
          custom_name: string | null
          display_name: string | null
          id: string
          phone: string
          profile_pic_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          display_name?: string | null
          id?: string
          phone: string
          profile_pic_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          display_name?: string | null
          id?: string
          phone?: string
          profile_pic_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_finished_conversations: {
        Row: {
          created_at: string
          finished_at: string
          finished_by: string | null
          id: string
          phone: string
        }
        Insert: {
          created_at?: string
          finished_at?: string
          finished_by?: string | null
          id?: string
          phone: string
        }
        Update: {
          created_at?: string
          finished_at?: string
          finished_by?: string | null
          id?: string
          phone?: string
        }
        Relationships: []
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
          email: string
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
          email: string
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
          email?: string
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
            foreignKeyName: "customer_registrations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
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
          tags?: string[] | null
          updated_at?: string
          whatsapp?: string | null
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
      events: {
        Row: {
          created_at: string
          default_shipping_cost: number | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_shipping_cost?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_shipping_cost?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
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
          tiny_invoice_id: string | null
          tiny_order_id: string | null
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
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
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
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
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
            referencedRelation: "whatsapp_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_campaigns: {
        Row: {
          ai_generated_content: string | null
          ai_prompt: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_log: Json | null
          failed_count: number | null
          id: string
          media_url: string | null
          message_content: string | null
          message_type: string
          name: string
          poll_options: Json | null
          scheduled_at: string | null
          sent_count: number | null
          started_at: string | null
          status: string
          target_groups: string[] | null
          total_groups: number | null
          updated_at: string
        }
        Insert: {
          ai_generated_content?: string | null
          ai_prompt?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_log?: Json | null
          failed_count?: number | null
          id?: string
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name: string
          poll_options?: Json | null
          scheduled_at?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          target_groups?: string[] | null
          total_groups?: number | null
          updated_at?: string
        }
        Update: {
          ai_generated_content?: string | null
          ai_prompt?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_log?: Json | null
          failed_count?: number | null
          id?: string
          media_url?: string | null
          message_content?: string | null
          message_type?: string
          name?: string
          poll_options?: Json | null
          scheduled_at?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          target_groups?: string[] | null
          total_groups?: number | null
          updated_at?: string
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
          used_sale_id?: string | null
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
          source?: string | null
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
      orders: {
        Row: {
          cart_link: string | null
          checkout_started_at: string | null
          checkout_token: string | null
          coupon_code: string | null
          created_at: string
          customer_id: string
          discount_type: string | null
          discount_value: number | null
          eligible_for_prize: boolean | null
          event_id: string
          free_shipping: boolean | null
          has_gift: boolean | null
          has_unread_messages: boolean
          id: string
          is_paid: boolean
          last_customer_message_at: string | null
          last_sent_message_at: string | null
          notes: string | null
          paid_at: string | null
          paid_externally: boolean | null
          products: Json
          stage: string
          updated_at: string
        }
        Insert: {
          cart_link?: string | null
          checkout_started_at?: string | null
          checkout_token?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_id: string
          discount_type?: string | null
          discount_value?: number | null
          eligible_for_prize?: boolean | null
          event_id: string
          free_shipping?: boolean | null
          has_gift?: boolean | null
          has_unread_messages?: boolean
          id?: string
          is_paid?: boolean
          last_customer_message_at?: string | null
          last_sent_message_at?: string | null
          notes?: string | null
          paid_at?: string | null
          paid_externally?: boolean | null
          products?: Json
          stage?: string
          updated_at?: string
        }
        Update: {
          cart_link?: string | null
          checkout_started_at?: string | null
          checkout_token?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_id?: string
          discount_type?: string | null
          discount_value?: number | null
          eligible_for_prize?: boolean | null
          event_id?: string
          free_shipping?: boolean | null
          has_gift?: boolean | null
          has_unread_messages?: boolean
          id?: string
          is_paid?: boolean
          last_customer_message_at?: string | null
          last_sent_message_at?: string | null
          notes?: string | null
          paid_at?: string | null
          paid_externally?: boolean | null
          products?: Json
          stage?: string
          updated_at?: string
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
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
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
          barcode: string
          category: string | null
          color: string | null
          cost_price: number | null
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          price: number
          size: string | null
          sku: string
          stock: number
          store_id: string
          synced_at: string
          tiny_id: number
          updated_at: string
          variant: string
        }
        Insert: {
          barcode?: string
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          price?: number
          size?: string | null
          sku?: string
          stock?: number
          store_id: string
          synced_at?: string
          tiny_id: number
          updated_at?: string
          variant?: string
        }
        Update: {
          barcode?: string
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          price?: number
          size?: string | null
          sku?: string
          stock?: number
          store_id?: string
          synced_at?: string
          tiny_id?: number
          updated_at?: string
          variant?: string
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
          barcode: string | null
          category: string | null
          created_at: string
          id: string
          product_name: string
          quantity: number
          sale_id: string
          size: string | null
          sku: string | null
          tiny_product_id: string | null
          total_price: number
          unit_price: number
          variant_name: string | null
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          id?: string
          product_name: string
          quantity?: number
          sale_id: string
          size?: string | null
          sku?: string | null
          tiny_product_id?: string | null
          total_price?: number
          unit_price?: number
          variant_name?: string | null
        }
        Update: {
          barcode?: string | null
          category?: string | null
          created_at?: string
          id?: string
          product_name?: string
          quantity?: number
          sale_id?: string
          size?: string | null
          sku?: string | null
          tiny_product_id?: string | null
          total_price?: number
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
          cash_register_id: string | null
          created_at: string
          customer_id: string | null
          discount: number
          id: string
          invoice_number: string | null
          invoice_pdf_url: string | null
          nfce_key: string | null
          nfce_number: string | null
          nfce_pdf_url: string | null
          notes: string | null
          payment_details: Json | null
          payment_method: string | null
          seller_id: string | null
          status: string
          store_id: string
          subtotal: number
          tiny_invoice_id: string | null
          tiny_order_id: string | null
          tiny_order_number: string | null
          total: number
          updated_at: string
        }
        Insert: {
          cash_register_id?: string | null
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          nfce_key?: string | null
          nfce_number?: string | null
          nfce_pdf_url?: string | null
          notes?: string | null
          payment_details?: Json | null
          payment_method?: string | null
          seller_id?: string | null
          status?: string
          store_id: string
          subtotal?: number
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
          tiny_order_number?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          cash_register_id?: string | null
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          invoice_number?: string | null
          invoice_pdf_url?: string | null
          nfce_key?: string | null
          nfce_number?: string | null
          nfce_pdf_url?: string | null
          notes?: string | null
          payment_details?: Json | null
          payment_method?: string | null
          seller_id?: string | null
          status?: string
          store_id?: string
          subtotal?: number
          tiny_invoice_id?: string | null
          tiny_order_id?: string | null
          tiny_order_number?: string | null
          total?: number
          updated_at?: string
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
            foreignKeyName: "pos_sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "pos_sellers"
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
      pos_seller_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          description: string | null
          due_date: string | null
          id: string
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
          completed_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
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
          completed_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
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
          id: string
          is_active: boolean
          name: string
          store_id: string | null
          tiny_seller_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          store_id?: string | null
          tiny_seller_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          store_id?: string | null
          tiny_seller_id?: string | null
          updated_at?: string
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
        ]
      }
      pos_stores: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          tiny_deposit_name: string | null
          tiny_token: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tiny_deposit_name?: string | null
          tiny_token: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tiny_deposit_name?: string | null
          tiny_token?: string
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
      whatsapp_groups: {
        Row: {
          created_at: string
          description: string | null
          group_id: string
          id: string
          instance_id: string | null
          is_active: boolean | null
          is_admin: boolean | null
          is_vip: boolean | null
          last_synced_at: string | null
          name: string
          participant_count: number | null
          photo_url: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          group_id: string
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          is_admin?: boolean | null
          is_vip?: boolean | null
          last_synced_at?: string | null
          name: string
          participant_count?: number | null
          photo_url?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          group_id?: string
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          is_admin?: boolean | null
          is_vip?: boolean | null
          last_synced_at?: string | null
          name?: string
          participant_count?: number | null
          photo_url?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          channel: string
          created_at: string
          direction: string
          error_code: string | null
          error_message: string | null
          id: string
          is_group: boolean | null
          media_type: string | null
          media_url: string | null
          message: string
          message_id: string | null
          phone: string
          sender_name: string | null
          status: string | null
          whatsapp_number_id: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          direction: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          is_group?: boolean | null
          media_type?: string | null
          media_url?: string | null
          message: string
          message_id?: string | null
          phone: string
          sender_name?: string | null
          status?: string | null
          whatsapp_number_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          is_group?: boolean | null
          media_type?: string | null
          media_url?: string | null
          message?: string
          message_id?: string | null
          phone?: string
          sender_name?: string | null
          status?: string | null
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
        ]
      }
      whatsapp_numbers: {
        Row: {
          access_token: string | null
          business_account_id: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          phone_display: string
          phone_number_id: string | null
          provider: string
          updated_at: string
          zapi_client_token: string | null
          zapi_instance_id: string | null
          zapi_token: string | null
        }
        Insert: {
          access_token?: string | null
          business_account_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          phone_display: string
          phone_number_id?: string | null
          provider?: string
          updated_at?: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Update: {
          access_token?: string | null
          business_account_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          phone_display?: string
          phone_number_id?: string | null
          provider?: string
          updated_at?: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Relationships: []
      }
      zoppy_customers: {
        Row: {
          address1: string | null
          address2: string | null
          avg_ticket: number | null
          birth_date: string | null
          city: string | null
          country: string | null
          coupon_amount: number | null
          coupon_code: string | null
          coupon_expiry_date: string | null
          coupon_min_purchase: number | null
          coupon_start_date: string | null
          coupon_type: string | null
          coupon_used: boolean | null
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
          phone: string | null
          postcode: string | null
          region_type: string | null
          rfm_calculated_at: string | null
          rfm_frequency_score: number | null
          rfm_monetary_score: number | null
          rfm_recency_score: number | null
          rfm_segment: string | null
          rfm_total_score: number | null
          state: string | null
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
          avg_ticket?: number | null
          birth_date?: string | null
          city?: string | null
          country?: string | null
          coupon_amount?: number | null
          coupon_code?: string | null
          coupon_expiry_date?: string | null
          coupon_min_purchase?: number | null
          coupon_start_date?: string | null
          coupon_type?: string | null
          coupon_used?: boolean | null
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
          phone?: string | null
          postcode?: string | null
          region_type?: string | null
          rfm_calculated_at?: string | null
          rfm_frequency_score?: number | null
          rfm_monetary_score?: number | null
          rfm_recency_score?: number | null
          rfm_segment?: string | null
          rfm_total_score?: number | null
          state?: string | null
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
          avg_ticket?: number | null
          birth_date?: string | null
          city?: string | null
          country?: string | null
          coupon_amount?: number | null
          coupon_code?: string | null
          coupon_expiry_date?: string | null
          coupon_min_purchase?: number | null
          coupon_start_date?: string | null
          coupon_type?: string | null
          coupon_used?: boolean | null
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
          phone?: string | null
          postcode?: string | null
          region_type?: string | null
          rfm_calculated_at?: string | null
          rfm_frequency_score?: number | null
          rfm_monetary_score?: number | null
          rfm_recency_score?: number | null
          rfm_segment?: string | null
          rfm_total_score?: number | null
          state?: string | null
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
      [_ in never]: never
    }
    Functions: {
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "manager" | "user"
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
      app_role: ["admin", "manager", "user"],
    },
  },
} as const
