export interface DbEvent {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
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
  title: string;
  variant: string;
  price: number;
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
  discount_type?: DiscountType;
  discount_value?: number;
  free_shipping?: boolean;
  has_gift?: boolean;
  created_at: string;
  updated_at: string;
  // Joined data
  customer?: DbCustomer;
}
