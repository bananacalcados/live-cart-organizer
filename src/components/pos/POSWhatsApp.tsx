import { useState, useEffect } from "react";
import { Phone, MessageCircle, Users, Pencil, Check, ChevronLeft, X, Send, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatView } from "@/components/chat/ChatView";
import { Message, Conversation, ChatFilter, StageFilter, InstanceFilter } from "@/components/chat/ChatTypes";
import { toast } from "sonner";

interface Props {
  storeId: string;
}

export function POSWhatsApp({ storeId }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>("all");
  const [sendVia, setSendVia] = useState<"zapi" | "meta">("zapi");
  const [chatContacts, setChatContacts] = useState<Record<string, string>>({});
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  const { numbers: metaNumbers, selectedNumberId, setSelectedNumberId, fetchNumbers } = useWhatsAppNumberStore();

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  // Load chat contacts
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("chat_contacts").select("phone, custom_name, display_name");
      if (data) {
        const map: Record<string, string> = {};
        for (const c of data) {
          if (c.custom_name) map[c.phone] = c.custom_name;
          else if (c.display_name) map[c.phone] = c.display_name;
        }
        setChatContacts(map);
      }
    };
    load();
  }, []);

  // Load conversations
  useEffect(() => {
    const loadConversations = async () => {
      const { data } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .order("created_at", { ascending: false });

      const phoneMap = new Map<string, { messages: Message[]; unread: number; isGroup: boolean }>();
      for (const msg of data || []) {
        if (!phoneMap.has(msg.phone)) phoneMap.set(msg.phone, { messages: [], unread: 0, isGroup: msg.is_group || false });
        const entry = phoneMap.get(msg.phone)!;
        entry.messages.push(msg);
        if (msg.direction === "incoming" && msg.status !== "read") entry.unread++;
        if (msg.is_group) entry.isGroup = true;
      }

      const convs: Conversation[] = [];
      phoneMap.forEach((value, phone) => {
        const lastMsg = value.messages[0];
        const lastIncoming = value.messages.find(m => m.direction === "incoming");
        const lastIncomingInstance: "zapi" | "meta" | undefined = lastIncoming?.whatsapp_number_id ? "meta" : lastIncoming ? "zapi" : undefined;
        const msgWithNumberId = value.messages.find(m => m.whatsapp_number_id);

        convs.push({
          phone,
          lastMessage: lastMsg.message,
          lastMessageAt: new Date(lastMsg.created_at),
          unreadCount: value.unread,
          customerName: chatContacts[phone],
          isGroup: value.isGroup || phone.includes("@g.us"),
          hasUnansweredMessage: lastMsg.direction === "incoming",
          whatsapp_number_id: msgWithNumberId?.whatsapp_number_id || null,
          lastIncomingInstance,
        });
      });

      convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      setConversations(convs);
    };

    loadConversations();

    const channel = supabase
      .channel("pos-whatsapp-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, () => {
        loadConversations();
        if (selectedPhone) loadMessages(selectedPhone);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_messages" }, () => loadConversations())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedPhone, chatContacts]);

  const loadMessages = async (phone: string) => {
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: true });
    setMessages(data || []);
  };

  const handleSelectConversation = (phone: string) => {
    setSelectedPhone(phone);
    loadMessages(phone);
    const conv = conversations.find(c => c.phone === phone);
    if (conv?.lastIncomingInstance === "meta") {
      setSendVia("meta");
      if (conv.whatsapp_number_id) setSelectedNumberId(conv.whatsapp_number_id);
    } else {
      setSendVia("zapi");
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone || isSending) return;
    const messageText = newMessage.trim();
    setIsSending(true);
    setNewMessage("");
    try {
      if (sendVia === "meta" && selectedNumberId) {
        const { error } = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: messageText, whatsapp_number_id: selectedNumberId },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.functions.invoke("zapi-send-message", {
          body: { phone: selectedPhone, message: messageText },
        });
        if (error) throw error;
      }

      await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone,
        message: messageText,
        direction: "outgoing",
        status: "sent",
        whatsapp_number_id: sendVia === "meta" ? selectedNumberId : null,
      });

      loadMessages(selectedPhone);
    } catch (error) {
      console.error("Error sending:", error);
      toast.error("Erro ao enviar mensagem");
    } finally {
      setIsSending(false);
    }
  };

  const handleSendAudio = async (audioUrl: string) => {
    if (!selectedPhone) return;
    setIsSending(true);
    try {
      if (sendVia === "meta" && selectedNumberId) {
        await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: "[áudio]", whatsapp_number_id: selectedNumberId, media_url: audioUrl, media_type: "audio" },
        });
      } else {
        await supabase.functions.invoke("zapi-send-media", {
          body: { phone: selectedPhone, mediaUrl: audioUrl, mediaType: "audio" },
        });
      }
      await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone, message: "[áudio]", direction: "outgoing", status: "sent", media_type: "audio", media_url: audioUrl,
      });
      loadMessages(selectedPhone);
      toast.success("Áudio enviado!");
    } catch (error) {
      toast.error("Erro ao enviar áudio");
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveContactName = async () => {
    if (!selectedPhone) return;
    const name = editNameValue.trim();
    try {
      await supabase.from("chat_contacts").upsert({ phone: selectedPhone, custom_name: name || null }, { onConflict: "phone" });
      setChatContacts(prev => {
        const next = { ...prev };
        if (name) next[selectedPhone] = name;
        else delete next[selectedPhone];
        return next;
      });
      setIsEditingName(false);
      toast.success("Nome atualizado!");
    } catch { toast.error("Erro ao salvar"); }
  };

  const selectedConversation = conversations.find(c => c.phone === selectedPhone) || null;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <div className="h-full flex flex-col bg-pos-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-pos-yellow/20 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedPhone ? (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-white/60 hover:text-pos-white" onClick={() => setSelectedPhone(null)}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              {selectedConversation?.isGroup ? <Users className="h-5 w-5 text-pos-yellow" /> : <Phone className="h-5 w-5 text-pos-yellow" />}
              {isEditingName ? (
                <div className="flex items-center gap-1 flex-1">
                  <Input
                    value={editNameValue}
                    onChange={e => setEditNameValue(e.target.value)}
                    className="h-7 text-sm bg-pos-white/10 border-pos-yellow/30 text-pos-white flex-1"
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleSaveContactName(); if (e.key === "Escape") setIsEditingName(false); }}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-pos-yellow" onClick={handleSaveContactName}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="font-bold text-pos-white truncate">{selectedConversation?.customerName || selectedPhone}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-pos-white/40" onClick={() => { setEditNameValue(selectedConversation?.customerName || ""); setIsEditingName(true); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
              </>
              )}
            </>
          ) : (
            <>
              <MessageCircle className="h-5 w-5 text-pos-yellow" />
              <span className="font-bold text-pos-white">WhatsApp</span>
              {totalUnread > 0 && <Badge className="bg-red-500 text-white border-0 text-xs">{totalUnread}</Badge>}
            </>
          )}
        </div>
        {selectedPhone && (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1 text-xs"
            onClick={() => {
              setSelectedPhone(null);
              setMessages([]);
              toast.success("Conversa finalizada");
            }}
          >
            <PhoneOff className="h-4 w-4" />
            Finalizar
          </Button>
        )}
      </div>

      {/* API Selector */}
      {selectedPhone && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-pos-yellow/10 text-xs flex-shrink-0">
          <span className="text-pos-white/40">Via:</span>
          <button onClick={() => setSendVia("zapi")} className={`px-2 py-0.5 rounded-full ${sendVia === "zapi" ? "bg-pos-yellow text-pos-black" : "bg-pos-white/10 text-pos-white/50"}`}>Z-API</button>
          <button onClick={() => setSendVia("meta")} className={`px-2 py-0.5 rounded-full ${sendVia === "meta" ? "bg-pos-yellow text-pos-black" : "bg-pos-white/10 text-pos-white/50"}`}>Meta API</button>
          {sendVia === "meta" && metaNumbers.length > 1 && <WhatsAppNumberSelector className="h-7 text-xs flex-1" />}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
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
            instanceFilter={instanceFilter}
            onInstanceFilterChange={setInstanceFilter}
            metaNumbers={metaNumbers}
          />
        ) : (
          <ChatView
            messages={messages}
            conversation={selectedConversation}
            newMessage={newMessage}
            onNewMessageChange={setNewMessage}
            onSendMessage={handleSendMessage}
            onSendAudio={handleSendAudio}
            onBack={() => setSelectedPhone(null)}
            isSending={isSending}
          />
        )}
      </div>
    </div>
  );
}
