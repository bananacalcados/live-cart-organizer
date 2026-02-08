import { useState, useEffect, useRef } from "react";
import { MessageCircle, X, Send, Smile, Paperclip, Search, Phone, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { cn } from "@/lib/utils";
import { EmojiPickerButton } from "./EmojiPickerButton";

interface Message {
  id: string;
  phone: string;
  message: string;
  direction: string;
  created_at: string;
  media_type?: string;
  media_url?: string;
  status?: string;
}

interface Conversation {
  phone: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
  customerName?: string;
}

export function GlobalWhatsAppChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { orders, setHasUnreadMessages } = useDbOrderStore();

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
      const phoneMap = new Map<string, { messages: Message[], unread: number }>();
      
      for (const msg of data || []) {
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, { messages: [], unread: 0 });
        }
        const entry = phoneMap.get(msg.phone)!;
        entry.messages.push(msg);
        if (msg.direction === 'incoming' && msg.status !== 'read') {
          entry.unread++;
        }
      }

      // Build conversations
      const convs: Conversation[] = [];
      phoneMap.forEach((value, phone) => {
        const lastMsg = value.messages[0];
        // Find customer name
        const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        
        convs.push({
          phone,
          lastMessage: lastMsg.message,
          lastMessageAt: new Date(lastMsg.created_at),
          unreadCount: value.unread,
          customerName: order?.customer?.instagram_handle,
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
  }, [isOpen, orders, selectedPhone]);

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
    
    // Scroll to bottom
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
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

  // Format message time
  const formatMessageTime = (date: Date) => {
    return format(date, 'HH:mm', { locale: ptBR });
  };

  // Format conversation time
  const formatConversationTime = (date: Date) => {
    if (isToday(date)) {
      return format(date, 'HH:mm', { locale: ptBR });
    }
    if (isYesterday(date)) {
      return 'Ontem';
    }
    return format(date, 'dd/MM', { locale: ptBR });
  };

  // Filter conversations
  const filteredConversations = conversations.filter(c => 
    c.phone.includes(searchQuery) || 
    c.customerName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
    <div className="fixed bottom-24 right-4 z-50 w-[400px] h-[600px] bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-stage-paid text-white">
        <div className="flex items-center gap-2">
          {selectedPhone && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white hover:bg-white/20"
              onClick={() => setSelectedPhone(null)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <MessageCircle className="h-5 w-5" />
          <span className="font-semibold">
            {selectedPhone 
              ? conversations.find(c => c.phone === selectedPhone)?.customerName || selectedPhone 
              : 'WhatsApp'}
          </span>
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
        // Conversation list
        <div className="flex-1 flex flex-col">
          {/* Search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar conversas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          {/* Conversations */}
          <ScrollArea className="flex-1">
            {filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Nenhuma conversa encontrada</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredConversations.map((conv) => (
                  <button
                    key={conv.phone}
                    onClick={() => handleSelectConversation(conv.phone)}
                    className="w-full p-3 flex items-start gap-3 hover:bg-secondary/50 transition-colors text-left"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stage-paid/20 text-stage-paid flex-shrink-0">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm truncate">
                          {conv.customerName || conv.phone}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatConversationTime(conv.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.lastMessage}
                        </p>
                        {conv.unreadCount > 0 && (
                          <span className="h-5 min-w-5 px-1 rounded-full bg-stage-paid text-white text-xs flex items-center justify-center">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      ) : (
        // Chat view
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <ScrollArea className="flex-1 p-3 bg-[#e5ddd5] dark:bg-[#0b141a]">
            <div className="space-y-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                      msg.direction === 'outgoing'
                        ? 'bg-[#dcf8c6] dark:bg-[#005c4b] text-foreground'
                        : 'bg-white dark:bg-[#202c33] text-foreground'
                    )}
                  >
                    {msg.media_url && msg.media_type?.includes('image') && (
                      <img src={msg.media_url} alt="" className="max-w-full rounded mb-1" />
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                    <p className="text-[10px] text-muted-foreground text-right mt-1">
                      {formatMessageTime(new Date(msg.created_at))}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="p-2 border-t bg-[#f0f0f0] dark:bg-[#202c33] flex items-center gap-2">
            <EmojiPickerButton 
              onEmojiSelect={(emoji) => setNewMessage(prev => prev + emoji)} 
            />
            <Input
              placeholder="Digite uma mensagem..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1 bg-white dark:bg-[#2a3942]"
            />
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || isSending}
              className="bg-stage-paid hover:bg-stage-paid/90"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
