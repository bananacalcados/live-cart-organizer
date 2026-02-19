import { useState, useEffect, useRef } from "react";
import { Send, X, Loader2, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { useZapi } from "@/hooks/useZapi";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LiveWhatsAppChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerName: string;
  viewerPhone: string;
  cartSummary?: string;
}

interface WaMessage {
  id: string;
  phone: string;
  message: string;
  direction: "incoming" | "outgoing";
  status: string;
  media_type?: string;
  media_url?: string;
  created_at: string;
}

export function LiveWhatsAppChatDialog({ open, onOpenChange, viewerName, viewerPhone, cartSummary }: LiveWhatsAppChatDialogProps) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sendMessage: zapiSendMessage } = useZapi();
  const { fetchNumbers, getSelectedNumber } = useWhatsAppNumberStore();

  useEffect(() => {
    if (open) {
      fetchNumbers();
      loadMessages();
    }
  }, [open, viewerPhone]);

  // Realtime subscription
  useEffect(() => {
    if (!open || !viewerPhone) return;
    const channel = supabase
      .channel(`live-wa-chat-${viewerPhone}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_messages",
        filter: `phone=eq.${viewerPhone}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as WaMessage]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, viewerPhone]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadMessages = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("phone", viewerPhone)
      .order("created_at", { ascending: true })
      .limit(100);
    setMessages((data as WaMessage[]) || []);
    setLoading(false);
  };

  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;
    const text = newMessage.trim();
    setIsSending(true);
    setNewMessage("");
    try {
      const selectedNum = getSelectedNumber();
      if (selectedNum?.provider === "meta") {
        const { error } = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: viewerPhone, message: text, whatsapp_number_id: selectedNum.id },
        });
        if (error) throw error;
      } else {
        const result = await zapiSendMessage(viewerPhone, text);
        if (!result.success) throw new Error(result.error);
      }
      // Save to DB
      await supabase.from("whatsapp_messages").insert({
        phone: viewerPhone,
        message: text,
        direction: "outgoing",
        status: "sent",
        whatsapp_number_id: selectedNum?.provider === "meta" ? selectedNum.id : null,
      });
      toast.success("Mensagem enviada!");
    } catch (err: any) {
      console.error("Error sending:", err);
      toast.error("Erro ao enviar mensagem");
      setNewMessage(text); // Restore message
    } finally {
      setIsSending(false);
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[600px] p-0 overflow-hidden gap-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#008069] text-white flex-shrink-0">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{viewerName}</p>
            <p className="text-xs text-white/70">{viewerPhone}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Cart summary */}
        {cartSummary && (
          <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b text-xs text-amber-700 dark:text-amber-400 flex-shrink-0">
            🛒 {cartSummary}
          </div>
        )}

        {/* Number selector */}
        <div className="px-3 py-1.5 border-b flex-shrink-0">
          <WhatsAppNumberSelector className="h-8 text-xs" />
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1.5 bg-[#efeae2] dark:bg-[#0b141a]" style={{ backgroundImage: "url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiB4PSIwIiB5PSIwIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIGlkPSJwIj48Y2lyY2xlIGN4PSIyIiBjeT0iMiIgcj0iMC41IiBmaWxsPSJyZ2JhKDAsMCwwLDAuMDMpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI3ApIi8+PC9zdmc+')" }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <MessageCircle className="h-8 w-8 opacity-40" />
              <p className="text-xs">Nenhuma conversa anterior</p>
              <p className="text-[10px]">Envie a primeira mensagem!</p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm shadow-sm ${
                  msg.direction === "outgoing"
                    ? "bg-[#d9fdd3] dark:bg-[#005c4b] text-foreground"
                    : "bg-white dark:bg-[#202c33] text-foreground"
                }`}>
                  {msg.media_url && msg.media_type === "image" && (
                    <img src={msg.media_url} className="max-w-full rounded mb-1" alt="" />
                  )}
                  {msg.media_url && msg.media_type === "audio" && (
                    <audio src={msg.media_url} controls className="max-w-full mb-1" />
                  )}
                  <p className="whitespace-pre-wrap break-words text-[13px]">{msg.message}</p>
                  <p className={`text-[10px] mt-0.5 text-right ${msg.direction === "outgoing" ? "text-[#667781]" : "text-muted-foreground"}`}>
                    {formatTime(msg.created_at)}
                    {msg.direction === "outgoing" && msg.status === "read" && " ✓✓"}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 p-3 border-t bg-background flex-shrink-0">
          <Input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Digite sua mensagem..."
            className="flex-1 text-sm"
            disabled={isSending}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={isSending || !newMessage.trim()}
            className="bg-[#00a884] hover:bg-[#008069] h-9 w-9"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
