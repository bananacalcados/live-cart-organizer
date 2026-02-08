export type OrderStage = 
  | 'new'
  | 'contacted'
  | 'no_response'
  | 'link_sent'
  | 'awaiting_payment'
  | 'paid'
  | 'shipped';

export interface OrderProduct {
  id: string;
  shopifyId: string;
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
  products: OrderProduct[];
  stage: OrderStage;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
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
  { id: 'link_sent', title: 'Link Enviado', color: 'bg-stage-link-sent' },
  { id: 'awaiting_payment', title: 'Aguardando Pagamento', color: 'bg-stage-awaiting' },
  { id: 'paid', title: 'Pago', color: 'bg-stage-paid' },
  { id: 'shipped', title: 'Enviado', color: 'bg-stage-shipped' },
];
