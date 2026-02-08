import { useState, useEffect, useRef } from "react";
import { Send, Loader2, ArrowLeft, Check, CheckCheck, Clock, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useZapi } from "@/hooks/useZapi";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Order, OrderStage, STAGES } from "@/types/order";
import { useOrderStore } from "@/stores/orderStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Message {
  id: string;
  phone: string;
  message: string;
  direction: "incoming" | "outgoing";
  message_id: string | null;
  status: string | null;
  created_at: string;
}

interface WhatsAppChatProps {
  order: Order;
  onBack?: () => void;
}

function getStatusIcon(status: string | null) {
  switch (status) {
    case 'sending':
      return <Clock className="h-3 w-3" />;
    case 'sent':
      return <Check className="h-3 w-3" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case 'failed':
      return <X className="h-3 w-3 text-red-400" />;
    default:
      return <Check className="h-3 w-3" />;
  }
}

export function WhatsAppChat({ order, onBack }: WhatsAppChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sendMessage, isLoading: isSending } = useZapi();
  const { moveOrder } = useOrderStore();

  const phone = order.whatsapp || '';
  const contactName = order.instagramHandle;
  const currentStage = STAGES.find(s => s.id === order.stage);

  // Format phone with country code for storage
  const formattedPhone = phone.replace(/\D/g, '').startsWith('55') 
    ? phone.replace(/\D/g, '') 
    : '55' + phone.replace(/\D/g, '');

  // Load messages from database
  const loadMessages = async () => {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone', formattedPhone)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading messages:', error);
    } else {
      setMessages((data as Message[]) || []);
    }
    setIsLoading(false);
  };

  // Subscribe to realtime updates
  useEffect(() => {
    loadMessages();

    const channel = supabase
      .channel('whatsapp-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `phone=eq.${formattedPhone}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [formattedPhone]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleStageChange = (newStage: OrderStage) => {
    moveOrder(order.id, newStage);
  };

  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;

    const messageText = newMessage.trim();
    setNewMessage("");

    // Optimistically add message to UI
    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      phone: formattedPhone,
      message: messageText,
      direction: 'outgoing',
      message_id: null,
      status: 'sending',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMessage]);

    // Send via Z-API
    const result = await sendMessage(phone, messageText);

    if (result.success) {
      // Save to database
      await supabase.from('whatsapp_messages').insert({
        phone: formattedPhone,
        message: messageText,
        direction: 'outgoing',
        status: 'sent',
      });

      // Remove temp message (realtime will add the real one)
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } else {
      // Update temp message status to failed
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m))
      );
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Get stage color class
  const getStageColorClass = (stageId: OrderStage) => {
    const colors: Record<OrderStage, string> = {
      new: 'bg-[hsl(var(--stage-new))]',
      contacted: 'bg-[hsl(var(--stage-contacted))]',
      no_response: 'bg-[hsl(var(--stage-no-response))]',
      link_sent: 'bg-[hsl(var(--stage-link-sent))]',
      awaiting_payment: 'bg-[hsl(var(--stage-awaiting))]',
      paid: 'bg-[hsl(var(--stage-paid))]',
      shipped: 'bg-[hsl(var(--stage-shipped))]',
    };
    return colors[stageId];
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* WhatsApp-style Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#075E54] text-white">
        {onBack && (
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onBack}
            className="text-white hover:bg-white/10 h-8 w-8"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        
        {/* Avatar */}
        <div className="h-10 w-10 rounded-full bg-gray-400 flex items-center justify-center text-lg font-semibold uppercase">
          {contactName.replace('@', '').charAt(0)}
        </div>
        
        {/* Contact info */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-base truncate">{contactName}</p>
          <p className="text-xs text-white/70 truncate">{phone}</p>
        </div>

        {/* Stage Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              className="h-auto px-3 py-1.5 text-white hover:bg-white/10 gap-1.5"
            >
              <span className={cn(
                "h-2.5 w-2.5 rounded-full",
                getStageColorClass(order.stage)
              )} />
              <span className="text-sm font-medium">{currentStage?.title}</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {STAGES.map((stage) => (
              <DropdownMenuItem
                key={stage.id}
                onClick={() => handleStageChange(stage.id)}
                className={cn(
                  "gap-2 cursor-pointer",
                  order.stage === stage.id && "bg-muted"
                )}
              >
                <span className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  getStageColorClass(stage.id)
                )} />
                {stage.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages Area - WhatsApp wallpaper style */}
      <div 
        className="flex-1 overflow-y-auto p-3"
        style={{
          backgroundColor: '#ECE5DD',
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4cfc4' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-[#075E54]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="bg-white/80 rounded-lg px-6 py-4 shadow-sm">
              <p className="text-sm text-gray-600">
                Nenhuma mensagem ainda
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Inicie uma conversa enviando uma mensagem
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg, index) => {
              const showDate = index === 0 || 
                new Date(msg.created_at).toDateString() !== 
                new Date(messages[index - 1].created_at).toDateString();
              
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-3">
                      <span className="bg-white/80 text-gray-600 text-xs px-3 py-1 rounded-lg shadow-sm">
                        {format(new Date(msg.created_at), "d 'de' MMMM", { locale: ptBR })}
                      </span>
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex",
                      msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm relative",
                        msg.direction === 'outgoing'
                          ? 'bg-[#DCF8C6] text-gray-800'
                          : 'bg-white text-gray-800'
                      )}
                      style={{
                        borderTopRightRadius: msg.direction === 'outgoing' ? 0 : undefined,
                        borderTopLeftRadius: msg.direction === 'incoming' ? 0 : undefined,
                      }}
                    >
                      <p className="whitespace-pre-wrap break-words pr-12">{msg.message}</p>
                      <div className={cn(
                        "absolute bottom-1 right-2 flex items-center gap-1 text-[11px]",
                        msg.direction === 'outgoing' ? 'text-gray-500' : 'text-gray-400'
                      )}>
                        <span>{format(new Date(msg.created_at), "HH:mm")}</span>
                        {msg.direction === 'outgoing' && getStatusIcon(msg.status)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={scrollRef} />
          </div>
        )}
      </div>

      {/* Input Area - WhatsApp style */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#F0F0F0]">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Digite uma mensagem"
          className="flex-1 bg-white rounded-full border-0 px-4 py-2 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={isSending}
        />
        <Button
          onClick={handleSend}
          disabled={!newMessage.trim() || isSending}
          className="h-10 w-10 rounded-full bg-[#075E54] hover:bg-[#064E46] p-0"
          size="icon"
        >
          {isSending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>
    </div>
  );
}
