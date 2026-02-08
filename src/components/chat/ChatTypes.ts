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
}

export type ChatFilter = 'all' | 'contacts' | 'groups';
export type StageFilter = 'all' | string;
