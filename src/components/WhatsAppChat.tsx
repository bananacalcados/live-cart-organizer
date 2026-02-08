import { useState, useEffect, useRef } from "react";
import { Send, Loader2, ArrowLeft, Check, CheckCheck, Clock, X, ChevronDown, FileText, Paperclip, Image, Mic, Video, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useZapi } from "@/hooks/useZapi";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Order, OrderStage, STAGES } from "@/types/order";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { useTemplateStore, applyTemplateVariables } from "@/stores/templateStore";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { uploadMediaToStorage } from "./MediaAttachmentPicker";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface Message {
  id: string;
  phone: string;
  message: string;
  direction: "incoming" | "outgoing";
  message_id: string | null;
  status: string | null;
  created_at: string;
  media_type?: string;
  media_url?: string;
}

interface MediaAttachment {
  file: File;
  type: 'image' | 'audio' | 'video' | 'document';
  previewUrl: string;
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

function getMediaType(file: File): 'image' | 'audio' | 'video' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

function MessageMedia({ msg }: { msg: Message }) {
  if (msg.media_type === 'text' || !msg.media_url) return null;

  if (msg.media_type === 'image') {
    return (
      <img
        src={msg.media_url}
        alt="Imagem"
        className="max-w-full rounded-lg mb-1"
        style={{ maxHeight: 200 }}
      />
    );
  }

  if (msg.media_type === 'video') {
    return (
      <video
        src={msg.media_url}
        controls
        className="max-w-full rounded-lg mb-1"
        style={{ maxHeight: 200 }}
      />
    );
  }

  if (msg.media_type === 'audio') {
    return (
      <audio src={msg.media_url} controls className="w-full mb-1" />
    );
  }

  return null;
}

export function WhatsAppChat({ order, onBack }: WhatsAppChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<MediaAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const { sendMessage, sendMedia, isLoading: isSending } = useZapi();
  const { moveOrder, setHasUnreadMessages, updateOrder } = useDbOrderStore();
  const { getTemplatesByStage, templates } = useTemplateStore();

  const phone = order.whatsapp || '';
  const contactName = order.instagramHandle;
  const currentStage = STAGES.find(s => s.id === order.stage);

  // Normalize phone for database queries - create all possible variations
  const rawPhone = phone.replace(/\D/g, '');
  
  // Create normalized versions for storage and querying
  const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;
  const phoneWithoutCountry = rawPhone.startsWith('55') ? rawPhone.slice(2) : rawPhone;
  
  // For 9-digit mobile numbers, also try without the 9
  const phoneWithout9 = phoneWithoutCountry.length === 11 && phoneWithoutCountry.charAt(2) === '9'
    ? phoneWithoutCountry.slice(0, 2) + phoneWithoutCountry.slice(3)
    : null;
  
  // Build all phone variations for matching
  const phoneVariations = [
    normalizedPhone,
    rawPhone,
    phoneWithoutCountry,
    phoneWithout9,
    phoneWithout9 ? '55' + phoneWithout9 : null,
  ].filter(Boolean) as string[];

  const getTemplateVariables = () => {
    const totalValue = order.products.reduce((sum, p) => sum + p.price * p.quantity, 0);
    const productsList = order.products
      .map((p) => `• ${p.quantity}x ${p.title} - R$ ${(p.price * p.quantity).toFixed(2)}`)
      .join('\n');

    return {
      nome: order.instagramHandle.replace('@', ''),
      instagram: order.instagramHandle,
      whatsapp: order.whatsapp || '',
      link_carrinho: order.cartLink || '',
      total: totalValue.toFixed(2),
      produtos: productsList || 'Nenhum produto',
    };
  };

  const loadMessages = async () => {
    // Load messages matching any phone variation
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .in('phone', phoneVariations)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading messages:', error);
    } else {
      setMessages((data as Message[]) || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadMessages();
    // Mark messages as read when chat is opened
    setHasUnreadMessages(order.id, false);

    // Subscribe to realtime for the main normalized phone
    // Using a single channel with OR filter is more efficient
    const channel = supabase
      .channel(`whatsapp-messages-${normalizedPhone}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
        },
        (payload) => {
          const newMsg = payload.new as Message;
          // Check if this message is for our phone (any variation)
          if (!phoneVariations.includes(newMsg.phone)) return;
          
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          // If incoming message, mark as read immediately since chat is open
          if (newMsg.direction === 'incoming') {
            setHasUnreadMessages(order.id, false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [normalizedPhone, order.id, setHasUnreadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleStageChange = (newStage: OrderStage) => {
    moveOrder(order.id, newStage);
  };

  const handleEmojiSelect = (emoji: string) => {
    setNewMessage((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const handleTemplateSelect = (templateMessage: string) => {
    const variables = getTemplateVariables();
    const filledMessage = applyTemplateVariables(templateMessage, variables);
    setNewMessage(filledMessage);
    inputRef.current?.focus();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 16 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 16MB.');
      return;
    }

    const type = getMediaType(file);
    const previewUrl = URL.createObjectURL(file);
    setSelectedMedia({ file, type, previewUrl });
    event.target.value = '';
  };

  const handleSend = async () => {
    if (isSending || isUploading) return;

    // Send media if selected
    if (selectedMedia) {
      setIsUploading(true);
      
      const mediaUrl = await uploadMediaToStorage(selectedMedia.file);
      if (!mediaUrl) {
        setIsUploading(false);
        return;
      }

      const tempId = `temp-${Date.now()}`;
      const tempMessage: Message = {
        id: tempId,
        phone: normalizedPhone,
        message: newMessage.trim() || '',
        direction: 'outgoing',
        message_id: null,
        status: 'sending',
        created_at: new Date().toISOString(),
        media_type: selectedMedia.type,
        media_url: selectedMedia.previewUrl,
      };
      setMessages((prev) => [...prev, tempMessage]);

      const result = await sendMedia(phone, mediaUrl, selectedMedia.type, newMessage.trim() || undefined);

      if (result.success) {
        await supabase.from('whatsapp_messages').insert({
          phone: normalizedPhone,
          message: newMessage.trim() || `[${selectedMedia.type}]`,
          direction: 'outgoing',
          status: 'sent',
          media_type: selectedMedia.type,
          media_url: mediaUrl,
        });
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        // Track that we sent a message for no-response timer
        updateOrder(order.id, { last_sent_message_at: new Date().toISOString() });
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m))
        );
      }

      URL.revokeObjectURL(selectedMedia.previewUrl);
      setSelectedMedia(null);
      setNewMessage("");
      setIsUploading(false);
      return;
    }

    // Send text message
    if (!newMessage.trim()) return;

    const messageText = newMessage.trim();
    setNewMessage("");

    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      phone: normalizedPhone,
      message: messageText,
      direction: 'outgoing',
      message_id: null,
      status: 'sending',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMessage]);

    const result = await sendMessage(phone, messageText);

    if (result.success) {
      await supabase.from('whatsapp_messages').insert({
        phone: normalizedPhone,
        message: messageText,
        direction: 'outgoing',
        status: 'sent',
      });
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      // Track that we sent a message for no-response timer
      updateOrder(order.id, { last_sent_message_at: new Date().toISOString() });
    } else {
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

  const stageTemplates = getTemplatesByStage(order.stage);
  const allTemplates = templates;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Hidden file inputs */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />

      {/* WhatsApp-style Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#075E54] text-white">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="text-white hover:bg-white/10 h-8 w-8">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        
        <div className="h-10 w-10 rounded-full bg-gray-400 flex items-center justify-center text-lg font-semibold uppercase">
          {contactName.replace('@', '').charAt(0)}
        </div>
        
        <div className="flex-1 min-w-0">
          <p className="font-medium text-base truncate">{contactName}</p>
          <p className="text-xs text-white/70 truncate">{phone}</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto px-3 py-1.5 text-white hover:bg-white/10 gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-full", getStageColorClass(order.stage))} />
              <span className="text-sm font-medium">{currentStage?.title}</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {STAGES.map((stage) => (
              <DropdownMenuItem
                key={stage.id}
                onClick={() => handleStageChange(stage.id)}
                className={cn("gap-2 cursor-pointer", order.stage === stage.id && "bg-muted")}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", getStageColorClass(stage.id))} />
                {stage.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages Area */}
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
              <p className="text-sm text-gray-600">Nenhuma mensagem ainda</p>
              <p className="text-xs text-gray-500 mt-1">Inicie uma conversa enviando uma mensagem</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg, index) => {
              const showDate = index === 0 || 
                new Date(msg.created_at).toDateString() !== new Date(messages[index - 1].created_at).toDateString();
              
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-3">
                      <span className="bg-white/80 text-gray-600 text-xs px-3 py-1 rounded-lg shadow-sm">
                        {format(new Date(msg.created_at), "d 'de' MMMM", { locale: ptBR })}
                      </span>
                    </div>
                  )}
                  <div className={cn("flex", msg.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm relative",
                        msg.direction === 'outgoing' ? 'bg-[#DCF8C6] text-gray-800' : 'bg-white text-gray-800'
                      )}
                      style={{
                        borderTopRightRadius: msg.direction === 'outgoing' ? 0 : undefined,
                        borderTopLeftRadius: msg.direction === 'incoming' ? 0 : undefined,
                      }}
                    >
                      <MessageMedia msg={msg} />
                      {msg.message && <p className="whitespace-pre-wrap break-words pr-12">{msg.message}</p>}
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

      {/* Media Preview */}
      {selectedMedia && (
        <div className="p-3 bg-gray-100 border-t flex items-center gap-3">
          <div className="relative">
            {selectedMedia.type === 'image' && (
              <img src={selectedMedia.previewUrl} alt="Preview" className="h-16 w-16 object-cover rounded-lg" />
            )}
            {selectedMedia.type === 'video' && (
              <div className="h-16 w-16 bg-gray-300 rounded-lg flex items-center justify-center">
                <Play className="h-6 w-6 text-gray-600" />
              </div>
            )}
            {selectedMedia.type === 'audio' && (
              <div className="h-16 w-16 bg-gray-200 rounded-lg flex items-center justify-center">
                <Mic className="h-6 w-6 text-gray-500" />
              </div>
            )}
            {isUploading && (
              <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedMedia.file.name}</p>
            <p className="text-xs text-gray-500">{(selectedMedia.file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
          {!isUploading && (
            <Button variant="ghost" size="icon" onClick={() => setSelectedMedia(null)} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-center gap-1 px-2 py-2 bg-[#F0F0F0]">
        <EmojiPickerButton onEmojiSelect={handleEmojiSelect} />

        {/* Template Picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-10 w-10">
              <FileText className="h-5 w-5 text-gray-500" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-64 max-h-72 overflow-y-auto">
            {stageTemplates.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs">Para esta etapa ({currentStage?.title})</DropdownMenuLabel>
                {stageTemplates.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => handleTemplateSelect(t.message)}
                    className="flex-col items-start gap-0.5 cursor-pointer"
                  >
                    <span className="font-medium text-sm">{t.name}</span>
                    <span className="text-xs text-muted-foreground line-clamp-1">{t.message.substring(0, 50)}...</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-xs">Todos os templates</DropdownMenuLabel>
            {allTemplates.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => handleTemplateSelect(t.message)}
                className="flex-col items-start gap-0.5 cursor-pointer"
              >
                <span className="font-medium text-sm">{t.name}</span>
                <span className="text-xs text-muted-foreground line-clamp-1">{t.message.substring(0, 50)}...</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Media buttons */}
        <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => imageInputRef.current?.click()}>
          <Image className="h-5 w-5 text-gray-500" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => videoInputRef.current?.click()}>
          <Video className="h-5 w-5 text-gray-500" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => audioInputRef.current?.click()}>
          <Mic className="h-5 w-5 text-gray-500" />
        </Button>

        <Input
          ref={inputRef}
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={selectedMedia ? "Adicionar legenda..." : "Digite uma mensagem"}
          className="flex-1 bg-white rounded-full border-0 px-4 py-2 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          disabled={isSending || isUploading}
        />
        <Button
          onClick={handleSend}
          disabled={(!newMessage.trim() && !selectedMedia) || isSending || isUploading}
          className="h-10 w-10 rounded-full bg-[#075E54] hover:bg-[#064E46] p-0"
          size="icon"
        >
          {isSending || isUploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>
    </div>
  );
}
