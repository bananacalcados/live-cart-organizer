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
      events: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
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
          checkout_token: string | null
          coupon_code: string | null
          created_at: string
          customer_id: string
          discount_type: string | null
          discount_value: number | null
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
          checkout_token?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_id: string
          discount_type?: string | null
          discount_value?: number | null
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
          checkout_token?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_id?: string
          discount_type?: string | null
          discount_value?: number | null
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
      whatsapp_messages: {
        Row: {
          created_at: string
          direction: string
          id: string
          is_group: boolean | null
          media_type: string | null
          media_url: string | null
          message: string
          message_id: string | null
          phone: string
          status: string | null
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          is_group?: boolean | null
          media_type?: string | null
          media_url?: string | null
          message: string
          message_id?: string | null
          phone: string
          status?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          is_group?: boolean | null
          media_type?: string | null
          media_url?: string | null
          message?: string
          message_id?: string | null
          phone?: string
          status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
