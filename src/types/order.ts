export type OrderStage = 
  | 'new'
  | 'contacted'
  | 'no_response'
  | 'awaiting_payment'
  | 'paid'
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
  { id: 'new', title: 'Novo Pedido', color: 'bg-stage-new' },
  { id: 'contacted', title: 'Contatado', color: 'bg-stage-contacted' },
  { id: 'no_response', title: 'Sem Resposta', color: 'bg-stage-no-response' },
  { id: 'awaiting_payment', title: 'Aguardando Pagamento', color: 'bg-stage-awaiting' },
  { id: 'paid', title: 'Pago', color: 'bg-stage-paid' },
  { id: 'shipped', title: 'Enviado', color: 'bg-stage-shipped' },
  { id: 'collect_next_day', title: 'Cobrar Dia Seguinte', color: 'bg-stage-collect-next-day' },
  { id: 'cancelled', title: 'Cancelado', color: 'bg-stage-cancelled' },
];
