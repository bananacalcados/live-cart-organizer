import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MessageCircle, Send, Loader2, ArrowLeft, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useEventStore } from "@/stores/eventStore";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "./WhatsAppNumberSelector";
import { ChatView } from "./chat/ChatView";
import { Message, Conversation } from "./chat/ChatTypes";
import { useConversationEnrichment } from "@/hooks/useConversationEnrichment";
import { STAGES, OrderStage } from "@/types/order";
import { toast } from "sonner";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";

type PanelFilter = "sem_resposta" | "recentes" | OrderStage;

const STAGE_FILTERS: { id: OrderStage; label: string; color: string }[] = [
  { id: "new", label: "Novo", color: "bg-[hsl(var(--stage-new))]" },
  { id: "contacted", label: "Contatado", color: "bg-[hsl(var(--stage-contacted))]" },
  { id: "no_response", label: "Sem Resposta", color: "bg-[hsl(var(--stage-no-response))]" },
  { id: "awaiting_payment", label: "Aguard. Pgto", color: "bg-[hsl(var(--stage-awaiting))]" },
  { id: "paid", label: "Pago", color: "bg-[hsl(var(--stage-paid))]" },
];

export function DashboardChatPanel() {
  const [filter, setFilter] = useState<PanelFilter>("sem_resposta");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedConvNumberId, setSelectedConvNumberId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendVia, setSendVia] = useState<"zapi" | "meta">("zapi");
  const [chatContacts, setChatContacts] = useState<Record<string, string>>({});
  const [profilePics, setProfilePics] = useState<Record<string, string>>({});
  const fetchedPicsRef = useRef<Set<string>>(new Set());

  const { orders, setHasUnreadMessages } = useDbOrderStore();
  const { customers } = useCustomerStore();
  const { events, currentEventId } = useEventStore();
  const { numbers: metaNumbers, selectedNumberId, setSelectedNumberId, fetchNumbers, getSelectedNumber } = useWhatsAppNumberStore();
  const { enrichConversations } = useConversationEnrichment();

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  useEffect(() => {
    const loadChatContacts = async () => {
      const { data } = await supabase.from("chat_contacts").select("phone, custom_name, display_name, profile_pic_url");
      if (data) {
        const nameMap: Record<string, string> = {};
        const picMap: Record<string, string> = {};
        for (const c of data) {
          if (c.custom_name) nameMap[c.phone] = c.custom_name;
          else if (c.display_name) nameMap[c.phone] = c.display_name;
          if (c.profile_pic_url) picMap[c.phone] = c.profile_pic_url;
        }
        setChatContacts(nameMap);
        setProfilePics(prev => ({ ...prev, ...picMap }));
      }
    };
    loadChatContacts();
  }, []);

  // Build a map of normalized phone → instagram handle from current event orders
  const orderPhoneMap = useMemo(() => {
    const map = new Map<string, { instagram?: string; stage?: string; customerId?: string }>();
    for (const order of orders) {
      const phone = order.customer?.whatsapp?.replace(/\D/g, "");
      if (phone) {
        const suffix = phone.slice(-8);
        map.set(suffix, {
          instagram: order.customer?.instagram_handle,
          stage: order.stage,
          customerId: order.customer_id,
        });
      }
    }
    return map;
  }, [orders]);

  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data) return;

    const convMap = new Map<string, { messages: any[]; unread: number; isGroup: boolean; phone: string; numberId: string | null }>();

    for (const msg of data) {
      const convKey = `${msg.phone}__${msg.whatsapp_number_id || "none"}`;
      if (!convMap.has(convKey)) convMap.set(convKey, { messages: [], unread: 0, isGroup: msg.is_group || false, phone: msg.phone, numberId: msg.whatsapp_number_id || null });
      const entry = convMap.get(convKey)!;
      entry.messages.push(msg);
      if (msg.direction === "incoming" && msg.status !== "read") entry.unread++;
      if (msg.is_group) entry.isGroup = true;
    }

    const convs: Conversation[] = [];
    const phoneMessages = new Map<string, { direction: string }[]>();

    convMap.forEach((value, convKey) => {
      const phone = value.phone;
      const phoneSuffix = phone.replace(/\D/g, "").slice(-8);
      const orderData = orderPhoneMap.get(phoneSuffix);

      // Only include conversations that have orders in current event
      if (!orderData) return;

      const lastMsg = value.messages[0];
      const isGroup = value.isGroup || phone.includes("@g.us") || phone.includes("-");
      const lastIncoming = value.messages.find((m: any) => m.direction === "incoming");
      const lastIncomingInstance: "zapi" | "meta" | undefined = (() => {
        if (!lastIncoming) return undefined;
        if (!lastIncoming.whatsapp_number_id) return "zapi";
        const matchedNumber = metaNumbers.find(n => n.id === lastIncoming.whatsapp_number_id);
        if (matchedNumber) return (matchedNumber.provider === "meta" ? "meta" : "zapi") as "zapi" | "meta";
        return "zapi";
      })();

      phoneMessages.set(convKey, value.messages.map((m: any) => ({ direction: m.direction })));

      convs.push({
        phone,
        lastMessage: lastMsg.message,
        lastMessageAt: new Date(lastMsg.created_at),
        unreadCount: value.unread,
        customerName: chatContacts[phone] || orderData.instagram,
        isGroup,
        hasUnansweredMessage: lastMsg.direction === "incoming",
        stage: orderData.stage,
        customerId: orderData.customerId,
        whatsapp_number_id: value.numberId,
        lastIncomingInstance,
      });
    });

    convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
    const enriched = enrichConversations(convs, phoneMessages);
    setConversations(enriched);

    // Fetch profile pics for Z-API conversations missing pics
    const phonesNeedingPics = enriched
      .filter(c => !c.isGroup && !profilePics[c.phone] && !fetchedPicsRef.current.has(c.phone) && c.lastIncomingInstance === "zapi")
      .map(c => c.phone)
      .slice(0, 20);

    if (phonesNeedingPics.length > 0) {
      phonesNeedingPics.forEach(p => fetchedPicsRef.current.add(p));
      supabase.functions.invoke("zapi-profile-picture", {
        body: { phones: phonesNeedingPics, whatsapp_number_id: metaNumbers.find(n => n.provider === "zapi")?.id },
      }).then(({ data }) => {
        if (data?.photos) {
          setProfilePics(prev => ({ ...prev, ...data.photos }));
        }
      }).catch(() => {});
    }
  }, [orderPhoneMap, chatContacts, metaNumbers, enrichConversations]);

  useEffect(() => {
    loadConversations();
    const channel = supabase
      .channel("dashboard-chat-panel-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, () => {
        loadConversations();
        if (selectedPhone) loadMessages(selectedPhone, selectedConvNumberId);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_messages" }, () => {
        loadConversations();
        if (selectedPhone) loadMessages(selectedPhone, selectedConvNumberId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadConversations, selectedPhone, selectedConvNumberId]);

  const loadMessages = async (phone: string, numberId?: string | null) => {
    // Load ALL messages for this phone across all instances so sidebar stays in sync with kanban card chats
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: true });
    if (data) setMessages(data || []);
  };

  const handleSelectConversation = (phone: string, whatsappNumberId?: string | null) => {
    setSelectedPhone(phone);
    setSelectedConvNumberId(whatsappNumberId ?? null);
    loadMessages(phone, whatsappNumberId);
    if (whatsappNumberId) {
      const matchedNumber = metaNumbers.find(n => n.id === whatsappNumberId);
      if (matchedNumber) {
        setSendVia(matchedNumber.provider === "meta" ? "meta" : "zapi");
        setSelectedNumberId(matchedNumber.id);
      } else {
        setSendVia("zapi");
        setSelectedNumberId(whatsappNumberId);
      }
    } else {
      setSendVia("zapi");
    }
    const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, "") === phone.replace(/\D/g, ""));
    if (order) setHasUnreadMessages(order.id, false);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone || isSending) return;
    const messageText = newMessage.trim();
    setIsSending(true);
    setNewMessage("");
    try {
      const selectedNum = getSelectedNumber();
      const isZapi = selectedNum?.provider === "zapi" || sendVia === "zapi";

      if (!isZapi && selectedNumberId) {
        const { error } = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: messageText, whatsappNumberId: selectedNumberId },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.functions.invoke("zapi-send-message", {
          body: { phone: selectedPhone, message: messageText, whatsapp_number_id: selectedNumberId },
        });
        if (error) throw error;
      }
      await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone, message: messageText, direction: "outgoing", status: "sent",
        whatsapp_number_id: selectedNumberId || null,
      });
      loadMessages(selectedPhone, selectedConvNumberId);
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Erro ao enviar mensagem");
    } finally {
      setIsSending(false);
    }
  };

  const handleSendAudio = async (audioUrl: string) => {
    if (!selectedPhone) return;
    setIsSending(true);
    try {
      const selectedNum = getSelectedNumber();
      const isZapi = selectedNum?.provider === "zapi" || sendVia === "zapi";
      if (!isZapi && selectedNumberId) {
        await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: "[áudio]", whatsappNumberId: selectedNumberId, type: "audio", mediaUrl: audioUrl },
        });
      } else {
        await supabase.functions.invoke("zapi-send-media", {
          body: { phone: selectedPhone, mediaUrl: audioUrl, mediaType: "audio", whatsapp_number_id: selectedNumberId },
        });
      }
      await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone, message: "[áudio]", direction: "outgoing", status: "sent", media_type: "audio", media_url: audioUrl,
        whatsapp_number_id: selectedNumberId || null,
      });
      loadMessages(selectedPhone, selectedConvNumberId);
      toast.success("Áudio enviado!");
    } catch (error) {
      toast.error("Erro ao enviar áudio");
    } finally {
      setIsSending(false);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter(c => {
    if (c.isGroup) return false;
    if (c.isFinished || c.isArchived) return false;

    if (filter === "sem_resposta") {
      return c.hasUnansweredMessage;
    }
    if (filter === "recentes") {
      return true;
    }
    // Stage filter
    return c.stage === filter;
  });

  const unansweredCount = conversations.filter(c => !c.isGroup && !c.isFinished && !c.isArchived && c.hasUnansweredMessage).length;

  const formatTime = (date: Date) => {
    if (isToday(date)) return format(date, "HH:mm");
    if (isYesterday(date)) return "Ontem";
    return format(date, "dd/MM", { locale: ptBR });
  };

  // Chat view
  if (selectedPhone) {
    const conv = conversations.find(c => c.phone === selectedPhone && (c.whatsapp_number_id || null) === selectedConvNumberId);
    return (
      <div className="flex flex-col h-full bg-card border-l border-border">
        <ChatView
          messages={messages}
          conversation={conv || null}
          newMessage={newMessage}
          onNewMessageChange={setNewMessage}
          onSendMessage={handleSendMessage}
          onSendAudio={handleSendAudio}
          onBack={() => setSelectedPhone(null)}
          isSending={isSending}
        />
      </div>
    );
  }

  // Conversation list
  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      {/* Header */}
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle className="h-5 w-5 text-[hsl(var(--stage-paid))]" />
          <h3 className="font-bold text-sm text-foreground">Chat WhatsApp</h3>
          {unansweredCount > 0 && (
            <Badge className="bg-destructive text-destructive-foreground text-xs font-bold ml-auto">
              {unansweredCount}
            </Badge>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin" style={{ WebkitOverflowScrolling: 'touch' }}>
          <button
            onClick={() => setFilter("sem_resposta")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-bold transition-all border-2",
              filter === "sem_resposta"
                ? "bg-destructive text-destructive-foreground border-destructive shadow-md scale-105"
                : "bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25"
            )}
          >
            🔴 Sem Resposta {unansweredCount > 0 && `(${unansweredCount})`}
          </button>
          <button
            onClick={() => setFilter("recentes")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-bold transition-all border-2",
              filter === "recentes"
                ? "bg-[hsl(210,80%,50%)] text-white border-[hsl(210,80%,50%)] shadow-md scale-105"
                : "bg-[hsl(210,80%,50%)]/15 text-[hsl(210,80%,50%)] border-[hsl(210,80%,50%)]/30 hover:bg-[hsl(210,80%,50%)]/25"
            )}
          >
            🕐 Recentes
          </button>
          {STAGE_FILTERS.map(sf => {
            const count = conversations.filter(c => !c.isGroup && !c.isFinished && !c.isArchived && c.stage === sf.id).length;
            if (count === 0) return null;
            return (
              <button
                key={sf.id}
                onClick={() => setFilter(sf.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-bold transition-all border-2",
                  filter === sf.id
                    ? `${sf.color} text-white border-transparent shadow-md scale-105`
                    : `${sf.color}/15 border-current/30 hover:opacity-80`
                )}
                style={filter !== sf.id ? { opacity: 0.7 } : undefined}
              >
                {sf.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageCircle className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs">Nenhuma conversa encontrada</p>
          </div>
        ) : (
           <div className="divide-y divide-border">
            {filteredConversations.map(conv => {
              const phoneSuffix = conv.phone.replace(/\D/g, "").slice(-8);
              const orderData = orderPhoneMap.get(phoneSuffix);
              const instagramHandle = orderData?.instagram || null;
              const picUrl = profilePics[conv.phone];

              return (
                <button
                  key={`${conv.phone}__${conv.whatsapp_number_id || "none"}`}
                  onClick={() => handleSelectConversation(conv.phone, conv.whatsapp_number_id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="flex-shrink-0 mt-0.5">
                      <Avatar className="h-9 w-9">
                        {picUrl && <AvatarImage src={picUrl} alt={conv.customerName || conv.phone} />}
                        <AvatarFallback className="bg-muted text-muted-foreground text-xs font-bold">
                          {(conv.customerName || conv.phone)?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {conv.phone}
                          </span>
                          {instagramHandle && (
                            <span className="text-[11px] font-medium text-primary truncate">@{instagramHandle.replace(/^@/, "")}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-1">
                          {formatTime(conv.lastMessageAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessage}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {conv.stage && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                            {STAGES.find(s => s.id === conv.stage)?.title || conv.stage}
                          </Badge>
                        )}
                        {conv.unreadCount > 0 && (
                          <Badge className="bg-[hsl(var(--stage-paid))] text-white text-[9px] px-1.5 py-0 h-4 ml-auto">
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
