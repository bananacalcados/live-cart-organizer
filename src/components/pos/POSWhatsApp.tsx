import { useState, useEffect, useMemo } from "react";
import { Phone, MessageCircle, Users, Pencil, Check, ChevronLeft, X, Send, PhoneOff, User, Package, Truck, MoreVertical, ShoppingBag, UserPlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "@/components/WhatsAppNumberSelector";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatView } from "@/components/chat/ChatView";
import { Message, Conversation, ChatFilter, StageFilter, InstanceFilter, ConversationStatusFilter } from "@/components/chat/ChatTypes";
import { useConversationEnrichment } from "@/hooks/useConversationEnrichment";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { POSProductCatalogSender } from "./POSProductCatalogSender";
import { NewConversationDialog } from "./NewConversationDialog";
import { useCrmPhoneLookup } from "@/hooks/useCrmPhoneLookup";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  storeId: string;
  initialFilter?: "unanswered" | "new";
}

interface CrmCustomerData {
  name?: string;
  instagram?: string;
  tags?: string[];
  profilePicUrl?: string;
  orders: {
    id: string;
    orderName?: string;
    status?: string;
    trackingCode?: string;
    totalPrice?: number;
    createdAt?: string;
  }[];
}

export function POSWhatsApp({ storeId, initialFilter }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ConversationStatusFilter>(initialFilter === "unanswered" ? "awaiting_reply" : initialFilter === "new" ? "not_started" : "all");
  const [sendVia, setSendVia] = useState<"zapi" | "meta">("zapi");
  const [chatContacts, setChatContacts] = useState<Record<string, string>>({});
  const [contactPhotos, setContactPhotos] = useState<Record<string, string>>({});
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [crmData, setCrmData] = useState<CrmCustomerData | null>(null);
  const [showCrmPanel, setShowCrmPanel] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);

  const { numbers: metaNumbers, selectedNumberId, setSelectedNumberId, fetchNumbers } = useWhatsAppNumberStore();
  const { enrichConversations, finishConversation } = useConversationEnrichment();

  // CRM phone lookup for conversation names
  const conversationPhones = useMemo(() => conversations.map(c => c.phone), [conversations]);
  const { crmMap, deleteWhatsApp } = useCrmPhoneLookup(conversationPhones);

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  // Load chat contacts + photos
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("chat_contacts").select("phone, custom_name, display_name, profile_pic_url");
      if (data) {
        const nameMap: Record<string, string> = {};
        const photoMap: Record<string, string> = {};
        const phonesWithoutPhotos: string[] = [];
        for (const c of data as any[]) {
          if (c.custom_name) nameMap[c.phone] = c.custom_name;
          else if (c.display_name) nameMap[c.phone] = c.display_name;
          if (c.profile_pic_url) photoMap[c.phone] = c.profile_pic_url;
          else phonesWithoutPhotos.push(c.phone);
        }
        setChatContacts(nameMap);
        setContactPhotos(photoMap);

        // Fetch missing profile pics from Z-API (batch of 20)
        if (phonesWithoutPhotos.length > 0) {
          try {
            const resp = await supabase.functions.invoke("zapi-profile-picture", {
              body: { phones: phonesWithoutPhotos.slice(0, 20) },
            });
            if (resp.data?.photos) {
              const validPhotos: Record<string, string> = {};
              for (const [phone, url] of Object.entries(resp.data.photos)) {
                if (url && url !== 'null' && typeof url === 'string' && url.startsWith('http')) {
                  validPhotos[phone] = url;
                }
              }
              if (Object.keys(validPhotos).length > 0) {
                setContactPhotos(prev => ({ ...prev, ...validPhotos }));
              }
            }
          } catch (e) {
            console.error("Error fetching profile pics:", e);
          }
        }
      }
    };
    load();
  }, []);

  // Fetch profile pics for conversation phones not yet in chat_contacts
  const fetchedPhonesRef = useMemo(() => new Set<string>(), []);
  useEffect(() => {
    if (conversations.length === 0) return;
    const missingPhones = conversations
      .filter(c => !c.isGroup && !contactPhotos[c.phone] && !fetchedPhonesRef.has(c.phone))
      .map(c => c.phone)
      .slice(0, 20);
    if (missingPhones.length === 0) return;
    missingPhones.forEach(p => fetchedPhonesRef.add(p));
    supabase.functions.invoke("zapi-profile-picture", {
      body: { phones: missingPhones },
    }).then(resp => {
      if (resp.data?.photos) {
        const validPhotos: Record<string, string> = {};
        for (const [phone, url] of Object.entries(resp.data.photos)) {
          if (url && url !== 'null' && typeof url === 'string' && (url as string).startsWith('http')) {
            validPhotos[phone] = url as string;
          }
        }
        if (Object.keys(validPhotos).length > 0) {
          setContactPhotos(prev => ({ ...prev, ...validPhotos }));
        }
      }
    }).catch(e => console.error("Error fetching conversation pics:", e));
  }, [conversations, contactPhotos]);

  // Load CRM data when phone is selected
  useEffect(() => {
    if (!selectedPhone) {
      setCrmData(null);
      setShowCrmPanel(false);
      return;
    }

    const loadCrmData = async () => {
      const cleanPhone = selectedPhone.replace(/\D/g, '');
      const suffix = cleanPhone.slice(-8);
      
      // Search customers, pos_customers, zoppy_customers, and campaign_leads
      const [customerRes, expRes, posRes, zoppyRes, leadRes] = await Promise.all([
        supabase
          .from("customers")
          .select("id, instagram_handle, tags, whatsapp")
          .or(`whatsapp.ilike.%${suffix}%`)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("expedition_orders")
          .select("id, shopify_order_name, expedition_status, freight_tracking_code, total_price, shopify_created_at")
          .or(`customer_phone.ilike.%${suffix}%`)
          .order("shopify_created_at", { ascending: false })
          .limit(5),
        supabase
          .from("pos_customers")
          .select("id, name, whatsapp, email")
          .or(`whatsapp.ilike.%${suffix}%`)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("zoppy_customers")
          .select("id, first_name, last_name, phone, email")
          .or(`phone.ilike.%${suffix}%`)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("campaign_leads")
          .select("id, name, phone, email, campaign_id")
          .or(`phone.ilike.%${suffix}%`)
          .limit(1)
          .maybeSingle(),
      ]);

      const customer = customerRes.data;
      const expOrders = expRes.data;
      const posCustomer = posRes.data as any;
      const zoppyCustomer = zoppyRes.data as any;
      const lead = leadRes.data;

      if (!customer && (!expOrders || expOrders.length === 0) && !posCustomer && !zoppyCustomer && !lead) {
        setCrmData(null);
        return;
      }

      // Determine best name with priority
      const resolvedName = chatContacts[selectedPhone]
        || posCustomer?.name
        || (zoppyCustomer ? `${zoppyCustomer.first_name || ''} ${zoppyCustomer.last_name || ''}`.trim() : null)
        || lead?.name
        || customer?.instagram_handle;

      setCrmData({
        name: resolvedName || undefined,
        instagram: customer?.instagram_handle,
        tags: customer?.tags || [],
        profilePicUrl: contactPhotos[selectedPhone],
        orders: (expOrders || []).map(o => ({
          id: o.id,
          orderName: o.shopify_order_name || undefined,
          status: o.expedition_status,
          trackingCode: o.freight_tracking_code || undefined,
          totalPrice: o.total_price || undefined,
          createdAt: o.shopify_created_at || undefined,
        })),
      });
      setShowCrmPanel(true);
    };

    loadCrmData();
  }, [selectedPhone, chatContacts, contactPhotos]);

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
      const phoneMessages = new Map<string, { direction: string }[]>();
      phoneMap.forEach((value, phone) => {
        const lastMsg = value.messages[0];
        const lastIncoming = value.messages.find(m => m.direction === "incoming");
        const lastIncomingInstance: "zapi" | "meta" | undefined = lastIncoming?.whatsapp_number_id ? "meta" : lastIncoming ? "zapi" : undefined;
        const msgWithNumberId = value.messages.find(m => m.whatsapp_number_id);

        phoneMessages.set(phone, value.messages.map(m => ({ direction: m.direction })));

        convs.push({
          phone,
          lastMessage: lastMsg.message,
          lastMessageAt: new Date(lastMsg.created_at),
          unreadCount: value.unread,
          customerName: chatContacts[phone] || crmMap.get(phone)?.name,
          isGroup: value.isGroup || phone.includes("@g.us"),
          hasUnansweredMessage: lastMsg.direction === "incoming",
          whatsapp_number_id: msgWithNumberId?.whatsapp_number_id || null,
          lastIncomingInstance,
        });
      });

      convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      setConversations(enrichConversations(convs, phoneMessages));
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
  }, [selectedPhone, chatContacts, crmMap]);

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

      // Deactivate any active AI session for this phone so AI doesn't respond while operator is chatting
      await supabase
        .from("automation_ai_sessions")
        .update({ is_active: false })
        .eq("phone", selectedPhone)
        .eq("is_active", true);

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

  const handleSendMedia = async (mediaUrl: string, mediaType: string, caption?: string) => {
    if (!selectedPhone) return;
    setIsSending(true);
    try {
      const msgText = caption || `[${mediaType}]`;
      if (sendVia === "meta" && selectedNumberId) {
        await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: msgText, whatsapp_number_id: selectedNumberId, media_url: mediaUrl, media_type: mediaType },
        });
      } else {
        await supabase.functions.invoke("zapi-send-media", {
          body: { phone: selectedPhone, mediaUrl: mediaUrl, mediaType: mediaType, caption },
        });
      }
      await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone, message: msgText, direction: "outgoing", status: "sent", media_type: mediaType, media_url: mediaUrl,
      });
      loadMessages(selectedPhone);
      toast.success("Mídia enviada!");
    } catch (error) {
      toast.error("Erro ao enviar mídia");
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

  const statusLabels: Record<string, string> = {
    pending: "Pendente",
    picking: "Separando",
    packing: "Embalando",
    ready_to_ship: "Pronto p/ envio",
    shipped: "Enviado",
    delivered: "Entregue",
    cancelled: "Cancelado",
  };

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  };

  const crmEntry = selectedPhone ? crmMap.get(selectedPhone) : null;
  const crmSourceLabel = crmEntry?.source === 'pos_customer' ? 'PDV' 
    : crmEntry?.source === 'zoppy_customer' ? 'Zoppy'
    : crmEntry?.source === 'campaign_lead' ? 'Lead'
    : crmEntry?.source === 'customer' ? 'CRM' : null;

  const customerInfoPanel = crmData && showCrmPanel ? (
    <div className="border-b border-[#00a884]/20 bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-2 flex-shrink-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-[#00a884]" />
          <div className="flex flex-col">
            <span className="text-xs font-bold text-foreground">
              {crmData.name || 'Cliente'}
            </span>
            {selectedPhone && (
              <span className="text-[10px] text-muted-foreground">{selectedPhone}</span>
            )}
          </div>
          {crmSourceLabel && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 border-[#00a884]/30 text-[#00a884]">
              {crmSourceLabel}
            </Badge>
          )}
          {crmData.instagram && (
            <span className="text-[10px] text-muted-foreground">@{crmData.instagram}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-destructive/60 hover:text-destructive"
            title="Excluir WhatsApp do CRM"
            onClick={async () => {
              if (!selectedPhone) return;
              if (!confirm('Excluir este WhatsApp de todas as bases de clientes?')) return;
              await deleteWhatsApp(selectedPhone);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => setShowCrmPanel(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {crmData.tags && crmData.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-1">
          {crmData.tags.map(t => (
            <Badge key={t} variant="secondary" className="text-[9px] bg-[#00a884]/20 text-[#00a884] border-0">{t}</Badge>
          ))}
        </div>
      )}
      {crmData.orders.length > 0 ? (
        <div className="space-y-1 max-h-24 overflow-y-auto">
          {crmData.orders.map(o => (
            <div key={o.id} className="flex items-center gap-2 text-[10px] text-muted-foreground bg-white dark:bg-[#202c33] rounded px-2 py-1">
              <Package className="h-3 w-3 text-pos-orange flex-shrink-0" />
              <span className="font-mono font-bold">{o.orderName || '—'}</span>
              <Badge variant="outline" className="text-[9px] border-muted text-muted-foreground">{statusLabels[o.status || ''] || o.status}</Badge>
              {o.trackingCode && (
                <span className="flex items-center gap-0.5">
                  <Truck className="h-3 w-3" /> {o.trackingCode}
                </span>
              )}
              {o.totalPrice && <span className="ml-auto">R$ {o.totalPrice.toFixed(2)}</span>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">Nenhum pedido encontrado</p>
      )}
    </div>
  ) : crmData && !showCrmPanel ? (
    <div className="border-b border-[#00a884]/20 bg-[#f0f2f5] dark:bg-[#111b21] px-3 py-1 flex-shrink-0">
      <Button variant="ghost" size="sm" className="text-[10px] text-[#00a884] h-5 px-2 gap-1" onClick={() => setShowCrmPanel(true)}>
        <User className="h-3 w-3" /> Ver dados do cliente ({crmData.orders.length} pedido{crmData.orders.length !== 1 ? 's' : ''})
      </Button>
    </div>
  ) : null;

  return (
    <div className="h-full flex flex-col bg-[#f0f2f5] dark:bg-[#111b21] min-w-0 overflow-hidden">
      {/* WhatsApp-style Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#008069] dark:bg-[#202c33] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedPhone ? (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10" onClick={() => setSelectedPhone(null)}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Avatar className="h-9 w-9">
                {contactPhotos[selectedPhone] ? (
                  <AvatarImage src={contactPhotos[selectedPhone]} />
                ) : null}
                <AvatarFallback className="bg-[#dfe5e7] dark:bg-[#6b7b8a] text-[#54656f] dark:text-white text-xs font-bold">
                  {selectedConversation?.isGroup ? <Users className="h-4 w-4" /> : getInitials(selectedConversation?.customerName || selectedPhone)}
                </AvatarFallback>
              </Avatar>
              {isEditingName ? (
                <div className="flex items-center gap-1 flex-1">
                  <Input
                    value={editNameValue}
                    onChange={e => setEditNameValue(e.target.value)}
                    className="h-7 text-sm bg-white/20 border-white/30 text-white flex-1 placeholder:text-white/50"
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleSaveContactName(); if (e.key === "Escape") setIsEditingName(false); }}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-white" onClick={handleSaveContactName}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
              <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="font-semibold text-white truncate">{selectedConversation?.customerName || selectedPhone}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-white/60 hover:text-white hover:bg-white/10" onClick={() => { setEditNameValue(selectedConversation?.customerName || ""); setIsEditingName(true); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                  {selectedConversation?.customerName && (
                    <span className="text-[11px] text-white/60 truncate">{selectedPhone}</span>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <MessageCircle className="h-5 w-5 text-white" />
              <span className="font-bold text-white">WhatsApp</span>
              {totalUnread > 0 && <Badge className="bg-white text-[#008069] border-0 text-xs font-bold">{totalUnread}</Badge>}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-white/80 hover:text-white hover:bg-white/10 gap-1 text-xs"
                onClick={() => setShowNewConversation(true)}
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Nova Conversa</span>
              </Button>
            </>
          )}
        </div>
        {selectedPhone && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-white/80 hover:text-white hover:bg-white/10 gap-1 text-xs"
              onClick={() => setShowCatalog(true)}
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="hidden sm:inline">Catálogo</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/80 hover:text-white hover:bg-white/10 gap-1 text-xs"
              onClick={async () => {
                if (selectedPhone) await finishConversation(selectedPhone);
                setSelectedPhone(null);
                setMessages([]);
                toast.success("Conversa finalizada");
              }}
            >
              <PhoneOff className="h-4 w-4" />
              Finalizar
            </Button>
          </div>
        )}
      </div>

      {/* API Selector */}
      {selectedPhone && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[#e9edef] dark:border-[#313d45] bg-white dark:bg-[#202c33] text-xs flex-shrink-0">
          <span className="text-muted-foreground">Via:</span>
          <button onClick={() => setSendVia("zapi")} className={`px-2 py-0.5 rounded-full font-medium transition-all ${sendVia === "zapi" ? "bg-[#00a884] text-white" : "bg-[#e9edef] dark:bg-[#3b4a54] text-muted-foreground"}`}>Z-API</button>
          <button onClick={() => setSendVia("meta")} className={`px-2 py-0.5 rounded-full font-medium transition-all ${sendVia === "meta" ? "bg-[#00a884] text-white" : "bg-[#e9edef] dark:bg-[#3b4a54] text-muted-foreground"}`}>Meta API</button>
          {sendVia === "meta" && metaNumbers.length > 1 && <WhatsAppNumberSelector className="h-7 text-xs flex-1" />}
        </div>
      )}

      {/* Content - Split view on desktop, single view on mobile */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Conversation List - always visible on desktop, hidden when chat open on mobile */}
        <div className={cn(
          "flex flex-col min-h-0 overflow-hidden border-r border-[#e9edef] dark:border-[#313d45]",
          selectedPhone ? "hidden md:flex md:w-[35%] lg:w-[30%]" : "flex-1"
        )}>
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
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            metaNumbers={metaNumbers}
            contactPhotos={contactPhotos}
            contactNames={chatContacts}
            selectedPhone={selectedPhone}
          />
        </div>

        {/* Chat View - takes remaining space on desktop */}
        {selectedPhone ? (
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            <ChatView
              messages={messages}
              conversation={selectedConversation}
              newMessage={newMessage}
              onNewMessageChange={setNewMessage}
              onSendMessage={handleSendMessage}
              onSendAudio={handleSendAudio}
              onSendMedia={handleSendMedia}
              onBack={() => setSelectedPhone(null)}
              isSending={isSending}
              customerInfoPanel={customerInfoPanel}
            />
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center bg-[#f0f2f5] dark:bg-[#222e35]">
            <div className="text-center text-[#667781]">
              <MessageCircle className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-light">Selecione uma conversa</p>
              <p className="text-sm mt-1">para começar a atender</p>
            </div>
          </div>
        )}
      </div>

      {/* Product Catalog Sender */}
      {selectedPhone && (
        <POSProductCatalogSender
          storeId={storeId}
          phone={selectedPhone}
          sendVia={sendVia}
          selectedNumberId={selectedNumberId}
          open={showCatalog}
          onOpenChange={setShowCatalog}
        />
      )}

      {/* New Conversation Dialog */}
      <NewConversationDialog
        open={showNewConversation}
        onOpenChange={setShowNewConversation}
        onConversationCreated={(phone) => {
          handleSelectConversation(phone);
        }}
      />
    </div>
  );
}
