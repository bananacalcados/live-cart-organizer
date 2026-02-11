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
          tiny_token: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tiny_token: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tiny_token?: string
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
          sender_name: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          message: string
          sender_name: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          message?: string
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
      whatsapp_messages: {
        Row: {
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
