import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { WhatsAppMediaAttachment } from "@/components/chat/WhatsAppMediaAttachment";

interface LeadWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  leadName?: string;
}

interface WaMessage {
  id: string;
  phone: string;
  message: string;
  direction: string;
  created_at: string;
  media_type?: string;
  media_url?: string;
  status?: string;
  whatsapp_number_id?: string;
  sender_name?: string;
}

export function LeadWhatsAppDialog({ open, onOpenChange, phone, leadName }: LeadWhatsAppDialogProps) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendVia, setSendVia] = useState<'zapi' | 'meta'>('meta');
  const { numbers: metaNumbers, selectedNumberId, fetchNumbers } = useWhatsAppNumberStore();

  const cleanPhone = phone?.replace(/\D/g, '') || '';
  // Build phone variants: raw, with DDI 55, without DDI 55
  const phoneVariants = (() => {
    if (!cleanPhone) return [];
    const variants = new Set<string>();
    variants.add(cleanPhone);
    if (cleanPhone.startsWith('55') && cleanPhone.length >= 12) {
      variants.add(cleanPhone.slice(2)); // without DDI
    } else {
      variants.add('55' + cleanPhone); // with DDI
    }
    return [...variants];
  })();

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  const loadMessages = useCallback(async () => {
    if (phoneVariants.length === 0) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .in('phone', phoneVariants)
        .order('created_at', { ascending: true });
      setMessages(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [phoneVariants.join(',')]); // eslint-disable-line

  useEffect(() => {
    if (open && phoneVariants.length > 0) {
      loadMessages();
      const channel = supabase
        .channel(`lead-chat-${cleanPhone}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, (payload: any) => {
          if (phoneVariants.includes(payload.new?.phone)) loadMessages();
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [open, phoneVariants.join(','), loadMessages]); // eslint-disable-line

  // Determine which phone format exists in messages for sending
  const sendPhone = messages.length > 0 ? messages[0].phone : (cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone);

  const handleSend = async () => {
    if (!newMessage.trim() || !cleanPhone || isSending) return;
    const text = newMessage.trim();
    setIsSending(true);
    setNewMessage("");
    try {
      if (sendVia === 'meta' && selectedNumberId) {
        const { error } = await supabase.functions.invoke('meta-whatsapp-send', {
          body: { phone: sendPhone, message: text, whatsapp_number_id: selectedNumberId },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.functions.invoke('zapi-send-message', {
          body: { phone: sendPhone, message: text, whatsapp_number_id: selectedNumberId },
        });
        if (error) throw error;
      }
      await supabase.from('whatsapp_messages').insert({
        phone: sendPhone, message: text, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: selectedNumberId || null,
      });
      loadMessages();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar mensagem");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg h-[600px] flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-stage-paid text-white rounded-t-lg">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <div>
              <p className="font-semibold text-sm">{leadName || cleanPhone}</p>
              <p className="text-[10px] opacity-80">{cleanPhone}</p>
            </div>
          </div>
        </div>

        {/* Send via selector */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50 text-xs flex-shrink-0">
          <span className="text-muted-foreground">Enviar via:</span>
          <button onClick={() => setSendVia('zapi')} className={`px-2 py-0.5 rounded-full transition-colors ${sendVia === 'zapi' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>Z-API</button>
          <button onClick={() => setSendVia('meta')} className={`px-2 py-0.5 rounded-full transition-colors ${sendVia === 'meta' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>Meta API</button>
          {sendVia === 'meta' && metaNumbers.length > 1 && <WhatsAppNumberSelector className="h-7 text-xs flex-1" />}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageSquare className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">Nenhuma mensagem encontrada</p>
              <p className="text-xs">Telefone: {cleanPhone}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {messages.map(msg => (
                <div key={msg.id} className={cn("flex", msg.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    "max-w-[80%] rounded-lg px-3 py-1.5 text-sm",
                    msg.direction === 'outgoing'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  )}>
                    <WhatsAppMediaAttachment
                      mediaUrl={msg.media_url}
                      mediaType={msg.media_type}
                      message={msg.message}
                      imageClassName="rounded max-w-full max-h-48 mb-1"
                      audioClassName="max-w-full mb-1"
                      pdfClassName="w-full h-64 rounded-md border border-border bg-background mb-2"
                    />
                    <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                    <div className={cn("flex items-center gap-1 mt-0.5", msg.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                      <span className="text-[10px] opacity-60">
                        {format(new Date(msg.created_at), "dd/MM HH:mm", { locale: ptBR })}
                      </span>
                      {msg.direction === 'outgoing' && msg.status && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 border-current opacity-50">{msg.status}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <div className="flex items-center gap-2 p-3 border-t bg-background">
          <Input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Digite uma mensagem..."
            className="flex-1"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <Button size="icon" onClick={handleSend} disabled={!newMessage.trim() || isSending}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
