import { useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { WhatsAppMediaAttachment } from "@/components/chat/WhatsAppMediaAttachment";
import { useConversationInstance } from "@/hooks/useConversationInstance";
import { useChatMessages } from "@/hooks/chat/useChatMessages";
import { useChatSender } from "@/hooks/chat/useChatSender";

interface LeadWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  leadName?: string;
}

export function LeadWhatsAppDialog({ open, onOpenChange, phone, leadName }: LeadWhatsAppDialogProps) {
  const [newMessage, setNewMessage] = useState("");
  const [sendVia, setSendVia] = useState<'zapi' | 'meta'>('meta');
  const { numbers: metaNumbers, fetchNumbers } = useWhatsAppNumberStore();
  const currentUserId = useCurrentUserId();

  const cleanPhone = phone?.replace(/\D/g, '') || '';
  const phoneVariants = useMemo(() => {
    if (!cleanPhone) return [];
    const variants = new Set<string>();
    variants.add(cleanPhone);
    if (cleanPhone.startsWith('55') && cleanPhone.length >= 12) {
      variants.add(cleanPhone.slice(2));
    } else {
      variants.add('55' + cleanPhone);
    }
    return [...variants];
  }, [cleanPhone]);

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  // Mensagens: usa o hook unificado. Sem filtro por numberId (queremos histórico cross-instância no Leads).
  const { messages, isLoading: loading, refresh: loadMessages } = useChatMessages(
    open ? cleanPhone : null,
    undefined,
    { phoneVariations: phoneVariants },
  );

  const { effectiveNumberId, boundNumber, isLocked } = useConversationInstance(phone, { messages: messages as never });
  const { sendText, isSending } = useChatSender();

  // Telefone de envio: usa o formato que já existe no histórico, ou injeta DDI 55 como fallback.
  const sendPhone = messages.length > 0
    ? (messages[0] as { phone: string }).phone
    : (cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone);

  const handleSend = async () => {
    if (!newMessage.trim() || !cleanPhone || isSending) return;
    const text = newMessage.trim();
    setNewMessage("");
    const result = await sendText({
      phone: sendPhone,
      message: text,
      route: {
        channel: 'whatsapp',
        provider: sendVia,
        numberId: effectiveNumberId || null,
      },
      senderUserId: currentUserId || null,
    });
    if (result.success) loadMessages();
    else setNewMessage(text); // restaura em caso de erro
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
          {sendVia === 'meta' && (
            isLocked && boundNumber ? (
              <div className="text-[10px] text-muted-foreground border rounded px-2 py-1 bg-muted/40 flex-1 truncate">
                🔒 {boundNumber.label}
              </div>
            ) : (
              metaNumbers.length > 1 && <WhatsAppNumberSelector className="h-7 text-xs flex-1" />
            )
          )}
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
              {messages.map((msg) => {
                const m = msg as {
                  id: string; direction: string; created_at: string; status?: string;
                  media_url?: string; media_type?: string; message: string;
                };
                return (
                  <div key={m.id} className={cn("flex", m.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      "max-w-[80%] rounded-lg px-3 py-1.5 text-sm",
                      m.direction === 'outgoing'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}>
                      <WhatsAppMediaAttachment
                        mediaUrl={m.media_url}
                        mediaType={m.media_type}
                        message={m.message}
                        direction={m.direction}
                        imageClassName="rounded max-w-full max-h-48 mb-1"
                        audioClassName="max-w-full mb-1"
                        pdfClassName="w-full h-64 rounded-md border border-border bg-background mb-2"
                      />
                      <p className="whitespace-pre-wrap break-words">{m.message}</p>
                      <div className={cn("flex items-center gap-1 mt-0.5", m.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                        <span className="text-[10px] opacity-60">
                          {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                        {m.direction === 'outgoing' && m.status && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 border-current opacity-50">{m.status}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
