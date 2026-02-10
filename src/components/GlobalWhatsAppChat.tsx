import { useState, useEffect } from "react";
import { MessageCircle, X, ChevronLeft, Phone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "./WhatsAppNumberSelector";
import { ConversationList } from "./chat/ConversationList";
import { ChatView } from "./chat/ChatView";
import { Message, Conversation, ChatFilter, StageFilter, InstanceFilter } from "./chat/ChatTypes";

export function GlobalWhatsAppChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>('all');
  const [sendVia, setSendVia] = useState<'zapi' | 'meta'>('zapi');
  
  const { orders, setHasUnreadMessages } = useDbOrderStore();
  const { customers } = useCustomerStore();
  const { numbers: metaNumbers, selectedNumberId, setSelectedNumberId, fetchNumbers } = useWhatsAppNumberStore();

  // Fetch Meta numbers on mount
  useEffect(() => {
    fetchNumbers();
  }, [fetchNumbers]);

  // Load conversations
  useEffect(() => {
    if (!isOpen) return;

    const loadConversations = async () => {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading messages:', error);
        return;
      }

      // Group by phone
      const phoneMap = new Map<string, { messages: Message[], unread: number, isGroup: boolean }>();
      
      for (const msg of data || []) {
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, { messages: [], unread: 0, isGroup: msg.is_group || false });
        }
        const entry = phoneMap.get(msg.phone)!;
        entry.messages.push(msg);
        if (msg.direction === 'incoming' && msg.status !== 'read') {
          entry.unread++;
        }
        if (msg.is_group) {
          entry.isGroup = true;
        }
      }

      // Build conversations
      const convs: Conversation[] = [];
      phoneMap.forEach((value, phone) => {
        const lastMsg = value.messages[0];
        const hasUnansweredMessage = lastMsg.direction === 'incoming';
        
        const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        const customer = customers.find(c => c.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        const isGroup = value.isGroup || phone.includes('@g.us') || phone.includes('-');
        
        // Detect which instance the last incoming message came from
        const lastIncoming = value.messages.find(m => m.direction === 'incoming');
        const lastIncomingInstance: 'zapi' | 'meta' | undefined = lastIncoming?.whatsapp_number_id ? 'meta' : lastIncoming ? 'zapi' : undefined;
        // Also get the whatsapp_number_id from the last message (incoming or outgoing) that has one
        const msgWithNumberId = value.messages.find(m => m.whatsapp_number_id);
        
        convs.push({
          phone,
          lastMessage: lastMsg.message,
          lastMessageAt: new Date(lastMsg.created_at),
          unreadCount: value.unread,
          customerName: order?.customer?.instagram_handle || customer?.instagram_handle,
          isGroup,
          hasUnansweredMessage,
          stage: order?.stage,
          customerId: order?.customer_id || customer?.id,
          customerTags: customer?.tags,
          whatsapp_number_id: msgWithNumberId?.whatsapp_number_id || null,
          lastIncomingInstance,
        });
      });

      convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      setConversations(convs);
    };

    loadConversations();

    const channel = supabase
      .channel('global-whatsapp-chat-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' },
        (payload) => {
          console.log('[Chat] New message received:', payload);
          loadConversations();
          if (selectedPhone) {
            loadMessages(selectedPhone);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages' },
        () => {
          loadConversations();
        }
      )
      .subscribe((status) => {
        console.log('[Chat] Realtime subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, orders, selectedPhone, customers]);

  // Load messages for selected phone
  const loadMessages = async (phone: string) => {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading messages:', error);
      return;
    }

    setMessages(data || []);
  };

  // Select conversation - auto-detect instance
  const handleSelectConversation = (phone: string) => {
    setSelectedPhone(phone);
    loadMessages(phone);
    
    // Auto-detect which instance to use for reply
    const conv = conversations.find(c => c.phone === phone);
    if (conv) {
      if (conv.lastIncomingInstance === 'meta') {
        setSendVia('meta');
        // Also set the specific Meta number if available
        if (conv.whatsapp_number_id) {
          setSelectedNumberId(conv.whatsapp_number_id);
        }
      } else {
        setSendVia('zapi');
      }
    }
    
    // Mark as read
    const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (order) {
      setHasUnreadMessages(order.id, false);
    }
  };

  // Send message via selected API
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone || isSending) return;

    setIsSending(true);
    try {
      if (sendVia === 'meta' && selectedNumberId) {
        const { data, error } = await supabase.functions.invoke('meta-whatsapp-send', {
          body: { 
            phone: selectedPhone, 
            message: newMessage,
            whatsapp_number_id: selectedNumberId,
          },
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.functions.invoke('zapi-send-message', {
          body: { phone: selectedPhone, message: newMessage },
        });
        if (error) throw error;
      }

      setNewMessage("");
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const selectedConversation = conversations.find(c => c.phone === selectedPhone) || null;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-4 z-50 h-14 w-14 rounded-full shadow-lg bg-stage-paid hover:bg-stage-paid/90"
        size="icon"
      >
        <MessageCircle className="h-6 w-6" />
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </Button>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 w-[420px] h-[650px] bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header - always visible */}
      <div className="flex items-center justify-between p-3 border-b bg-stage-paid text-white flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {selectedPhone ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20 flex-shrink-0"
                onClick={() => setSelectedPhone(null)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              {selectedConversation?.isGroup ? (
                <Users className="h-5 w-5 flex-shrink-0" />
              ) : (
                <Phone className="h-5 w-5 flex-shrink-0" />
              )}
              <span className="font-semibold truncate">
                {selectedConversation?.customerName || selectedPhone}
              </span>
            </>
          ) : (
            <>
              <MessageCircle className="h-5 w-5" />
              <span className="font-semibold">WhatsApp</span>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white hover:bg-white/20 flex-shrink-0"
          onClick={() => {
            setIsOpen(false);
            setSelectedPhone(null);
          }}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* API Selector bar - when in conversation */}
      {selectedPhone && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50 text-xs flex-shrink-0">
          <span className="text-muted-foreground">Enviar via:</span>
          <button
            onClick={() => setSendVia('zapi')}
            className={`px-2 py-0.5 rounded-full transition-colors ${sendVia === 'zapi' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
          >
            Z-API
          </button>
          <button
            onClick={() => setSendVia('meta')}
            className={`px-2 py-0.5 rounded-full transition-colors ${sendVia === 'meta' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
          >
            Meta API
          </button>
          {sendVia === 'meta' && metaNumbers.length > 1 && (
            <WhatsAppNumberSelector className="h-7 text-xs flex-1" />
          )}
          {sendVia === 'meta' && metaNumbers.length > 0 && (
            <span className="text-muted-foreground truncate">
              {metaNumbers.find(n => n.id === selectedNumberId)?.label || ''}
            </span>
          )}
        </div>
      )}

      {/* Content area - takes remaining space */}
      {!selectedPhone ? (
        <ConversationList
          conversations={conversations}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectConversation={handleSelectConversation}
          chatFilter={chatFilter}
          onChatFilterChange={setChatFilter}
          stageFilter={stageFilter}
          onStageFilterChange={setStageFilter}
          instanceFilter={instanceFilter}
          onInstanceFilterChange={setInstanceFilter}
          metaNumbers={metaNumbers}
        />
      ) : (
        <ChatView
          messages={messages}
          conversation={selectedConversation}
          newMessage={newMessage}
          onNewMessageChange={setNewMessage}
          onSendMessage={handleSendMessage}
          isSending={isSending}
        />
      )}
    </div>
  );
}
