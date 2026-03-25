export type OrderStage = 
  | 'incomplete_order'
  | 'awaiting_confirmation'
  | 'new'
  | 'contacted'
  | 'no_response'
  | 'awaiting_payment'
  | 'paid'
  | 'awaiting_shipping'
  | 'awaiting_mototaxi'
  | 'awaiting_pickup'
  | 'completed'
  | 'shipped'
  | 'cancelled'
  | 'collect_next_day';

export interface OrderProduct {
  id: string;
  shopifyId: string;
  sku?: string;
  title: string;
  variant: string;
  price: number;
  quantity: number;
  image?: string;
}

export interface Order {
  id: string;
  instagramHandle: string;
  whatsapp?: string;
  cartLink?: string;
  products: OrderProduct[];
  stage: OrderStage;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  hasUnreadMessages?: boolean;
  lastCustomerMessageAt?: Date;
  lastSentMessageAt?: Date;
}

export interface Stage {
  id: OrderStage;
  title: string;
  color: string;
}

export const STAGES: Stage[] = [
  { id: 'incomplete_order', title: 'Pedido Incompleto', color: 'bg-stage-incomplete' },
  { id: 'awaiting_confirmation', title: 'Aguardando Confirmação', color: 'bg-stage-awaiting-confirm' },
  { id: 'new', title: 'Novo Pedido', color: 'bg-stage-new' },
  { id: 'contacted', title: 'Contatado', color: 'bg-stage-contacted' },
  { id: 'no_response', title: 'Sem Resposta', color: 'bg-stage-no-response' },
  { id: 'awaiting_payment', title: 'Aguardando Pagamento', color: 'bg-stage-awaiting' },
  { id: 'paid', title: 'Pago', color: 'bg-stage-paid' },
  { id: 'awaiting_shipping', title: 'Aguardando Envio', color: 'bg-stage-awaiting-shipping' },
  { id: 'awaiting_mototaxi', title: 'Aguardando Mototaxista', color: 'bg-stage-awaiting-mototaxi' },
  { id: 'awaiting_pickup', title: 'Aguardando Retirada', color: 'bg-stage-awaiting-pickup' },
  { id: 'completed', title: 'Concluído', color: 'bg-stage-completed' },
  { id: 'shipped', title: 'Enviado', color: 'bg-stage-shipped' },
  { id: 'collect_next_day', title: 'Cobrar Dia Seguinte', color: 'bg-stage-collect-next-day' },
  { id: 'cancelled', title: 'Cancelado', color: 'bg-stage-cancelled' },
];

// Check if an order has all required fields filled
export const isOrderComplete = (order: { products: Array<{ title: string; variant: string }>; customer?: { instagram_handle?: string; whatsapp?: string } | null }): boolean => {
  // Must have customer name (instagram_handle)
  if (!order.customer?.instagram_handle?.trim()) return false;
  // Must have WhatsApp
  if (!order.customer?.whatsapp?.trim()) return false;
  // Must have at least one product
  if (!order.products || order.products.length === 0) return false;
  // Each product must have variant (size/color info)
  for (const p of order.products) {
    if (!p.variant?.trim()) return false;
  }
  return true;
};

// Get missing fields for incomplete order badge display
export const getMissingFields = (order: { products: Array<{ title: string; variant: string }>; customer?: { instagram_handle?: string; whatsapp?: string } | null }): string[] => {
  const missing: string[] = [];
  if (!order.customer?.instagram_handle?.trim()) missing.push('Cliente');
  if (!order.customer?.whatsapp?.trim()) missing.push('WhatsApp');
  if (!order.products || order.products.length === 0) missing.push('Produto');
  else {
    const hasIncompleteVariant = order.products.some(p => !p.variant?.trim());
    if (hasIncompleteVariant) missing.push('Tamanho/Cor');
  }
  return missing;
};
