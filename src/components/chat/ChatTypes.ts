export interface Message {
  id: string;
  phone: string;
  message: string;
  direction: string;
  created_at: string;
  media_type?: string;
  media_url?: string;
  status?: string;
  is_group?: boolean;
  whatsapp_number_id?: string;
  sender_name?: string;
}

export interface Conversation {
  phone: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  customerName?: string;
  isGroup: boolean;
  hasUnansweredMessage: boolean;
  stage?: string;
  customerId?: string;
  customerTags?: string[];
  whatsapp_number_id?: string | null;
  lastIncomingInstance?: 'zapi' | 'meta';
  eventNames?: string[];
}

export type ChatFilter = 'all' | 'contacts' | 'groups';
export type StageFilter = 'all' | string;
export type InstanceFilter = 'all' | 'zapi' | 'meta' | string;
