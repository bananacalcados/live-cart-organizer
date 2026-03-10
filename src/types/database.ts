export interface DbEvent {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  default_shipping_cost?: number;
  catalog_lead_page_id?: string;
  active_product_delay_seconds?: number;
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
