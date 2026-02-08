import { useState, useEffect, useRef } from "react";
import { Send, Loader2, ArrowLeft, Phone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useZapi } from "@/hooks/useZapi";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

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
  phone: string;
  contactName?: string;
  onBack?: () => void;
}

export function WhatsAppChat({ phone, contactName, onBack }: WhatsAppChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sendMessage, isLoading: isSending } = useZapi();

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

  // Reload messages (sync button now just reloads from DB)
  const syncMessages = async () => {
    setIsSyncing(true);
    await loadMessages();
    setIsSyncing(false);
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

  return (
    <div className="flex flex-col h-full bg-background rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-muted/30">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <Avatar className="h-10 w-10 bg-stage-paid/20">
          <AvatarFallback className="bg-stage-paid/20 text-stage-paid">
            <Phone className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="font-medium">{contactName || phone}</p>
          <p className="text-xs text-muted-foreground">{phone}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={syncMessages}
          disabled={isSyncing}
        >
          <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Phone className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">Nenhuma mensagem ainda</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[250px]">
              Envie uma mensagem ou configure o webhook para receber mensagens
            </p>
          </div>
        ) : (
          <div className="space-y-3">
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
                    "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                    msg.direction === 'outgoing'
                      ? 'bg-stage-paid text-white'
                      : 'bg-muted'
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                  <p
                    className={cn(
                      "text-[10px] mt-1 text-right",
                      msg.direction === 'outgoing'
                        ? 'text-white/70'
                        : 'text-muted-foreground'
                    )}
                  >
                    {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                    {msg.status === 'sending' && ' •••'}
                    {msg.status === 'failed' && ' ✕'}
                  </p>
                </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="flex items-center gap-2 p-4 border-t bg-muted/30">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Digite uma mensagem..."
          className="flex-1"
          disabled={isSending}
        />
        <Button
          onClick={handleSend}
          disabled={!newMessage.trim() || isSending}
          className="bg-stage-paid hover:bg-stage-paid/90"
          size="icon"
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
