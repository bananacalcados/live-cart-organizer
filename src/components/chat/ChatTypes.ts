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
  /** Computed conversation status */
  conversationStatus?: ConversationStatus;
  /** Whether this phone has conversations on other instances */
  hasOtherInstances?: boolean;
  /** Label of the instance (e.g. "DataCrazy", "Z-API") */
  instanceLabel?: string;
  /** Whether this conversation is marked as finished */
  isFinished?: boolean;
}

export type ChatFilter = 'all' | 'contacts' | 'groups';
export type StageFilter = 'all' | string;
export type InstanceFilter = 'all' | 'zapi' | 'meta' | string;

/** 
 * Conversation status filter for the new tabs:
 * - all: all conversations
 * - not_started: customer sent message but we never replied
 * - awaiting_reply: we replied, customer replied back, waiting on us
 * - awaiting_customer: we sent message, customer hasn't replied
 * - finished: marked as done
 */
export type ConversationStatus = 'not_started' | 'awaiting_reply' | 'awaiting_customer' | 'finished';
export type ConversationStatusFilter = 'all' | ConversationStatus;
