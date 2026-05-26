import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWaMessageBroadcast } from "@/hooks/useWaMessageBroadcast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Instagram, Send, Loader2, AlertCircle, Info, Camera, Video, Mic, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";

interface DMMessage {
  id: string;
  message: string | null;
  direction: "incoming" | "outgoing";
  created_at: string;
  status: string | null;
  media_type: string | null;
  media_url: string | null;
}

interface InstagramDMChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;          // sem @
  eventId?: string;
  fallbackCommentId?: string; // último comment_id desse usuário (pra private_reply)
  profilePicUrl?: string | null;
}

const cleanHandle = (h: string) => (h || "").replace(/^@/, "").trim().toLowerCase();

export function InstagramDMChat({
  open,
  onOpenChange,
  username,
  eventId,
  fallbackCommentId,
  profilePicUrl,
}: InstagramDMChatProps) {
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [igUserId, setIgUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const handle = cleanHandle(username);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      const el = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }, []);

  const loadHistory = useCallback(async () => {
    if (!handle) return;
    setLoading(true);
    try {
      // 1) Achar o ig_user_id desse @
      const { data: link } = await supabase
        .from("instagram_user_links")
        .select("ig_user_id")
        .ilike("username", handle)
        .maybeSingle();

      let userId = link?.ig_user_id || null;

      if (!userId) {
        // fallback via whatsapp_messages (sender_name)
        const { data: m } = await supabase
          .from("whatsapp_messages")
          .select("phone")
          .eq("channel", "instagram")
          .ilike("sender_name", `@${handle}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        userId = (m?.phone && /^\d+$/.test(m.phone)) ? m.phone : null;
      }

      setIgUserId(userId);

      if (!userId) {
        setMessages([]);
        return;
      }

      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, message, direction, created_at, status, media_type, media_url")
        .eq("channel", "instagram")
        .eq("phone", userId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw error;
      setMessages((data || []) as DMMessage[]);
      scrollToBottom();

      // Marcar como lido
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("instagram_dm_reads").upsert({
          user_id: user.id,
          username: handle,
          last_read_at: new Date().toISOString(),
        }, { onConflict: "user_id,username" });
      }
    } catch (err: any) {
      console.error("[IG DM] load error:", err);
      toast.error("Erro ao carregar histórico");
    } finally {
      setLoading(false);
    }
  }, [handle, scrollToBottom]);

  useEffect(() => {
    if (open) loadHistory();
  }, [open, loadHistory]);

  // Broadcast-based new-message notification (postgres_changes removed for CPU).
  // Filters Instagram-channel messages via refetch in loadHistory.
  useWaMessageBroadcast((payload) => {
    if (!open || !igUserId) return;
    if (payload?.phone !== igUserId) return;
    loadHistory();
    scrollToBottom();
  });


  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-dm-send", {
        body: { username: handle, message: text, eventId, fallbackCommentId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      setDraft("");
      toast.success(`Enviado via ${(data as any)?.method === "private_reply" ? "Private Reply" : "DM direto"}`);
      // Recarrega pra pegar a mensagem persistida + atualizar igUserId se acabou de descobrir
      await loadHistory();
    } catch (err: any) {
      console.error("[IG DM] send error:", err);
      toast.error(err.message || "Falha ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const cannotSendDirectly = !igUserId && !fallbackCommentId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b border-border bg-gradient-to-r from-pink-500/10 to-purple-500/10">
          <DialogTitle className="flex items-center gap-3">
            {profilePicUrl ? (
              <img src={profilePicUrl} alt={handle} className="w-10 h-10 rounded-full object-cover border" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white font-bold">
                {handle.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Instagram className="h-4 w-4 text-pink-500" />
                <span className="font-bold">@{handle}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-normal">
                {igUserId ? (
                  <Badge variant="outline" className="text-[10px]">Thread aberta</Badge>
                ) : fallbackCommentId ? (
                  <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                    Private Reply (1ª mensagem)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500 border-red-500/30">
                    Sem janela ativa
                  </Badge>
                )}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-4" ref={scrollRef as any}>
          <div className="py-4 space-y-2">
            {loading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2 text-muted-foreground">
                <Info className="h-8 w-8 opacity-40" />
                <p className="text-sm">Nenhuma mensagem ainda.</p>
                <p className="text-xs">
                  {fallbackCommentId
                    ? "A primeira mensagem será enviada como Private Reply ao comentário."
                    : "Aguardando o usuário iniciar conversa pra abrir a janela de 24h."}
                </p>
              </div>
            )}
            {messages.map((m) => {
              const isOut = m.direction === "outgoing";
              return (
                <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isOut
                      ? "bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {m.media_url && m.media_type?.startsWith("image") && (
                      <img src={m.media_url} alt="" className="rounded mb-1 max-w-full" />
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.message || (m.media_type ? `[${m.media_type}]` : "")}</p>
                    <p className={`text-[10px] mt-1 ${isOut ? "text-white/70" : "text-muted-foreground"}`}>
                      {formatTime(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-3 bg-card">
          {cannotSendDirectly && (
            <div className="mb-2 flex items-start gap-2 text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Sem janela ativa nem comentário recente. Aguarde o cliente comentar/enviar mensagem.</span>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Digite sua mensagem..."
              className="min-h-[60px] max-h-[120px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sending || cannotSendDirectly}
            />
            <Button
              onClick={handleSend}
              disabled={!draft.trim() || sending || cannotSendDirectly}
              className="bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-90"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
