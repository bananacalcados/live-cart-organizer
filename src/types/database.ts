export interface DbEvent {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  default_shipping_cost?: number;
  free_shipping_threshold?: number | null;
  installment_min_value?: number | null;
  installment_max?: number | null;
  setup_completed?: boolean;
  catalog_lead_page_id?: string;
  active_product_delay_seconds?: number;
  automation_enabled?: boolean;
  channel?: 'site' | 'pos_perola' | 'pos_centro';
  default_store_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbCustomer {
  id: string;
  instagram_handle: string;
  whatsapp?: string;
  is_banned: boolean;
  ban_reason?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface DbOrderProduct {
  id: string;
  shopifyId: string;
  sku?: string;
  title: string;
  variant: string;
  price: number;
  compareAtPrice?: number;
  quantity: number;
  image?: string;
}

export type DiscountType = 'fixed' | 'percentage';

export interface DbOrder {
  id: string;
  event_id: string;
  customer_id: string;
  latest_comment_id?: string | null;
  cart_link?: string;
  checkout_token?: string;
  notes?: string;
  stage: string;
  products: DbOrderProduct[];
  has_unread_messages: boolean;
  last_customer_message_at?: string;
  last_sent_message_at?: string;
  is_paid: boolean;
  paid_at?: string;
  paid_externally?: boolean;
  discount_type?: DiscountType;
  discount_value?: number;
  free_shipping?: boolean;
  shipping_cost?: number;
  has_gift?: boolean;
  coupon_code?: string;
  checkout_started_at?: string;
  eligible_for_prize?: boolean;
  created_at: string;
  updated_at: string;
  // Payment gateway IDs
  pagarme_order_id?: string | null;
  mercadopago_payment_id?: string | null;
  appmax_order_id?: string | null;
  vindi_transaction_id?: string | null;
  pos_sale_id?: string | null;
  // Payment details
  payment_method_label?: string | null;
  installments?: number | null;
  // AI pause
  ai_paused?: boolean;
  ai_paused_at?: string | null;
  // Delivery method
  delivery_method?: string | null;
  // Unificação de pedidos (envio único p/ mesmo cliente no mesmo evento)
  merged_into_order_id?: string | null;
  merged_at?: string | null;
  merged_by?: string | null;
  // Joined data
  customer?: DbCustomer;
}

export interface PromotionTier {
  quantity: number;
  price: number;
}

export interface EventPromotion {
  id: string;
  event_id: string;
  name: string;
  shopify_collection_handle?: string;
  shopify_product_ids?: string[];
  tiers: PromotionTier[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
