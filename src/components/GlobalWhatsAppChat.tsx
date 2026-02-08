import { useState, useEffect } from "react";
import { MessageCircle, X, ChevronLeft, Phone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { useCustomerStore } from "@/stores/customerStore";
import { ConversationList } from "./chat/ConversationList";
import { ChatView } from "./chat/ChatView";
import { Message, Conversation, ChatFilter, StageFilter } from "./chat/ChatTypes";

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
  
  const { orders, setHasUnreadMessages } = useDbOrderStore();
  const { customers } = useCustomerStore();

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
        // Update isGroup if any message indicates it's a group
        if (msg.is_group) {
          entry.isGroup = true;
        }
      }

      // Build conversations
      const convs: Conversation[] = [];
      phoneMap.forEach((value, phone) => {
        const lastMsg = value.messages[0];
        const allMessages = value.messages;
        
        // Check if last message is incoming and unanswered
        const hasUnansweredMessage = lastMsg.direction === 'incoming';
        
        // Find customer and order
        const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        const customer = customers.find(c => c.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        
        // Detect if it's a group (phone starting with group prefix or contains @g.us)
        const isGroup = value.isGroup || phone.includes('@g.us') || phone.includes('-');
        
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
        });
      });

      // Sort by last message
      convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      setConversations(convs);
    };

    loadConversations();

    // Subscribe to realtime
    const channel = supabase
      .channel('global-whatsapp-chat')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_messages' },
        () => {
          loadConversations();
          if (selectedPhone) {
            loadMessages(selectedPhone);
          }
        }
      )
      .subscribe();

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

  // Select conversation
  const handleSelectConversation = (phone: string) => {
    setSelectedPhone(phone);
    loadMessages(phone);
    
    // Mark as read
    const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (order) {
      setHasUnreadMessages(order.id, false);
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone || isSending) return;

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-send-message', {
        body: { phone: selectedPhone, message: newMessage },
      });

      if (error) throw error;

      setNewMessage("");
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false);
    }
  };

  // Get selected conversation
  const selectedConversation = conversations.find(c => c.phone === selectedPhone) || null;

  // Total unread
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
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-stage-paid text-white">
        <div className="flex items-center gap-2">
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
                <Users className="h-5 w-5" />
              ) : (
                <Phone className="h-5 w-5" />
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
          className="h-8 w-8 text-white hover:bg-white/20"
          onClick={() => {
            setIsOpen(false);
            setSelectedPhone(null);
          }}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

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
