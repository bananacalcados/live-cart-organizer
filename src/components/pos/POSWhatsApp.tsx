import { useState, useEffect, useMemo } from "react";
import { Phone, MessageCircle, Users, Pencil, Check, ChevronLeft, X, Send, PhoneOff, User, Package, Truck, MoreVertical, ShoppingBag, UserPlus, Trash2, QrCode, CreditCard, Archive, BarChart3, ArrowRightLeft } from "lucide-react";
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
import { useSupportPhones } from "@/hooks/useSupportPhones";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { POSProductCatalogSender } from "./POSProductCatalogSender";
import { NewConversationDialog } from "./NewConversationDialog";
import { useCrmPhoneLookup } from "@/hooks/useCrmPhoneLookup";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CreateSupportTicketDialog } from "@/components/CreateSupportTicketDialog";
import { POSWhatsAppCheckoutDialog } from "./POSWhatsAppCheckoutDialog";
import { POSWhatsAppPixDialog } from "./POSWhatsAppPixDialog";
import { POSWhatsAppSellerGate } from "./POSWhatsAppSellerGate";
import { POSFinishConversationDialog } from "./POSFinishConversationDialog";
import { POSWhatsAppDashboard } from "./POSWhatsAppDashboard";
import { TransferConversationDialog } from "@/components/chat/TransferConversationDialog";
import { AgentFilterSelector } from "@/components/chat/AgentFilterSelector";
import { MultiInstanceFilter } from "@/components/chat/MultiInstanceFilter";
import { useConversationAssignments } from "@/hooks/useConversationAssignments";

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
  const [selectedConvNumberId, setSelectedConvNumberId] = useState<string | null>(null);
  const [selectedConvKey, setSelectedConvKey] = useState<string | null>(null);
  const [selectedConvChannel, setSelectedConvChannel] = useState<string | null>(null);
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
  const [showCheckout, setShowCheckout] = useState(false);
  const [showPix, setShowPix] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [supportFilterActive, setSupportFilterActive] = useState(false);
  const [showSellerGate, setShowSellerGate] = useState(true);
  const sellerKey = `pos_whatsapp_seller_id_${storeId}`;
  const sellerNameKey = `pos_whatsapp_seller_name_${storeId}`;
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(() => sessionStorage.getItem(sellerKey));
  const [selectedSellerName, setSelectedSellerName] = useState<string | null>(() => sessionStorage.getItem(sellerNameKey));
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  const [showDashboard, setShowDashboard] = useState(() => !!sessionStorage.getItem(sellerKey));

  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [multiInstanceFilter, setMultiInstanceFilter] = useState<string[]>([]);

  // Store-specific WhatsApp number IDs
  const [storeNumberIds, setStoreNumberIds] = useState<string[]>([]);
  const [selectedSendNumberId, setSelectedSendNumberId] = useState<string | null>(null);

  const { numbers: metaNumbers, fetchNumbers } = useWhatsAppNumberStore();
  const { enrichConversations, finishConversation, archiveConversation, unarchiveConversation, finishedPhones, archivedPhones, awaitingPaymentPhones } = useConversationEnrichment();
  const { hasActiveSupport, supportCount } = useSupportPhones();
  const { isAdmin, filterByAssignment, viewAsUserId, setViewAsUserId, getAssignedTo } = useConversationAssignments();

  // CRM phone lookup for conversation names
  const conversationPhones = useMemo(() => conversations.map(c => c.phone), [conversations]);
  const { crmMap, deleteWhatsApp } = useCrmPhoneLookup(conversationPhones);

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  // Load store-specific WhatsApp numbers
  useEffect(() => {
    const loadStoreNumbers = async () => {
      const { data } = await supabase
        .from('pos_store_whatsapp_numbers')
        .select('whatsapp_number_id')
        .eq('store_id', storeId);
      setStoreNumberIds((data || []).map((d: any) => d.whatsapp_number_id));
    };
    loadStoreNumbers();
  }, [storeId]);

  // Reset seller when storeId changes
  useEffect(() => {
    const savedId = sessionStorage.getItem(`pos_whatsapp_seller_id_${storeId}`);
    const savedName = sessionStorage.getItem(`pos_whatsapp_seller_name_${storeId}`);
    setSelectedSellerId(savedId);
    setSelectedSellerName(savedName);
    setShowSellerGate(!savedId);
    setShowDashboard(!!savedId);
  }, [storeId]);

  // Numbers assigned to this store
  const storeNumbers = useMemo(() => {
    if (storeNumberIds.length === 0) return metaNumbers;
    return metaNumbers.filter(n => storeNumberIds.includes(n.id));
  }, [metaNumbers, storeNumberIds]);

  const selectedSendNumber = useMemo(
    () => storeNumbers.find((number) => number.id === selectedSendNumberId) ?? null,
    [storeNumbers, selectedSendNumberId]
  );

  useEffect(() => {
    const isSocialConversation = selectedConvChannel === "instagram" || selectedConvChannel === "messenger";

    if (isSocialConversation) {
      if (selectedSendNumberId !== null) setSelectedSendNumberId(null);
      if (sendVia !== "meta") setSendVia("meta");
      return;
    }

    if (storeNumbers.length === 0) {
      setSelectedSendNumberId(null);
      return;
    }

    if (selectedSendNumberId && storeNumbers.some((number) => number.id === selectedSendNumberId)) {
      return;
    }

    const fallbackNumber = storeNumbers.find((number) => number.provider === sendVia) ?? storeNumbers[0] ?? null;
    setSelectedSendNumberId(fallbackNumber?.id ?? null);
    if (fallbackNumber) {
      setSendVia(fallbackNumber.provider === "meta" ? "meta" : "zapi");
    }
  }, [storeNumbers, selectedSendNumberId, sendVia, selectedConvChannel]);

  useEffect(() => {
    if (!selectedPhone) {
      setSelectedConvChannel(null);
    }
  }, [selectedPhone]);

  // Load chat contacts + photos + group names
  useEffect(() => {
    const load = async () => {
      // Fetch all contacts (table may exceed default 1000-row limit)
      let allContactData: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data: page } = await supabase.from("chat_contacts").select("phone, custom_name, display_name, profile_pic_url").range(from, from + PAGE - 1);
        if (!page || page.length === 0) break;
        allContactData = allContactData.concat(page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      const [groupsRes] = await Promise.all([
        supabase.from("whatsapp_groups").select("group_id, name"),
      ]);
      const data = allContactData;
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
        // Map group names from whatsapp_groups table
        if (groupsRes.data) {
          for (const g of groupsRes.data as any[]) {
            if (g.group_id && g.name) {
              nameMap[g.group_id] = g.name;
            }
          }
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

      // Group by phone + whatsapp_number_id to create separate conversations per instance
      const convMap = new Map<string, { messages: Message[]; unread: number; isGroup: boolean; phone: string; numberId: string | null; hasIncoming: boolean; lastIsMassDispatch: boolean }>();
      for (const msg of data || []) {
        // Filter by store's assigned WhatsApp numbers
        if (storeNumberIds.length > 0) {
          const msgNumberId = msg.whatsapp_number_id;
          if (msgNumberId && !storeNumberIds.includes(msgNumberId)) continue;
          if (!msgNumberId) {
            const hasZapiInStore = storeNumbers.some(n => n.provider === 'zapi');
            if (!hasZapiInStore) continue;
          }
        }
        const convKey = `${msg.phone}__${msg.whatsapp_number_id || 'none'}`;
        if (!convMap.has(convKey)) convMap.set(convKey, { messages: [], unread: 0, isGroup: msg.is_group || false, phone: msg.phone, numberId: msg.whatsapp_number_id || null, hasIncoming: false, lastIsMassDispatch: false });
        const entry = convMap.get(convKey)!;
        entry.messages.push(msg);
        if (msg.direction === "incoming") {
          entry.hasIncoming = true;
          if (msg.status !== "read") entry.unread++;
        }
        if (msg.is_group) entry.isGroup = true;
        // Track if latest message is a mass dispatch
        if (entry.messages.length === 1 && (msg as any).is_mass_dispatch) entry.lastIsMassDispatch = true;
      }

      const convs: Conversation[] = [];
      const phoneMessages = new Map<string, { direction: string }[]>();
      convMap.forEach((value, convKey) => {
        const phone = value.phone;
        const lastMsg = value.messages[0];
        const lastIncoming = value.messages.find(m => m.direction === "incoming");
        const lastIncomingInstance: "zapi" | "meta" | undefined = (() => {
          if (!lastIncoming) return undefined;
          if (!lastIncoming.whatsapp_number_id) return "zapi";
          const matchedNumber = storeNumbers.find(n => n.id === lastIncoming.whatsapp_number_id);
          if (matchedNumber) return (matchedNumber.provider === 'meta' ? 'meta' : 'zapi') as "zapi" | "meta";
          return "zapi";
        })();

        phoneMessages.set(convKey, value.messages.map(m => ({ direction: m.direction })));

        const isDispatchOnly = (value.lastIsMassDispatch && lastMsg.direction === 'outgoing') || (lastMsg.direction === 'outgoing' && !value.hasIncoming);

        convs.push({
          phone,
          lastMessage: lastMsg.message,
          lastMessageAt: new Date(lastMsg.created_at),
          unreadCount: value.unread,
          customerName: chatContacts[phone] || crmMap.get(phone)?.name,
          isGroup: value.isGroup || phone.includes("@g.us"),
          hasUnansweredMessage: lastMsg.direction === "incoming",
          whatsapp_number_id: value.numberId,
          lastIncomingInstance,
          isDispatchOnly,
          channel: (lastMsg as any).channel || null,
        });
      });

      convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      setConversations(filterByAssignment(enrichConversations(convs, phoneMessages)));
    };

    loadConversations();

    const channel = supabase
      .channel("pos-whatsapp-realtime")
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
  }, [selectedPhone, chatContacts, crmMap, storeNumberIds, storeNumbers, finishedPhones, archivedPhones, awaitingPaymentPhones]);

  const loadMessages = async (phone: string, numberId?: string | null) => {
    let query = supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: true });
    
    if (numberId) {
      query = query.eq("whatsapp_number_id", numberId);
    } else if (numberId === null) {
      query = query.is("whatsapp_number_id", null);
    }
    
    const { data } = await query;
    setMessages(data || []);
  };

  const getSelectedChannel = () => {
    if (selectedConvChannel) return selectedConvChannel;
    if (!selectedPhone) return null;

    return conversations.find((conversation) => {
      const conversationKey = conversation.conversationKey || `${conversation.phone}__${conversation.whatsapp_number_id || 'none'}`;
      return conversationKey === (selectedConvKey || `${selectedPhone}__${selectedConvNumberId || 'none'}`);
    })?.channel || null;
  };

  const sendViaMessenger = async (
    recipientId: string,
    message: string,
    channel: "messenger" | "instagram" = "instagram",
    type: "text" | "image" | "video" | "audio" | "file" = "text",
    mediaUrl?: string,
  ) => {
    // Find a Meta number to get the access token from DB
    const metaNumberId = storeNumbers.find((n) => n.provider === "meta")?.id || null;
    const { data, error } = await supabase.functions.invoke("meta-messenger-send", {
      body: { recipientId, message, channel, type, mediaUrl, whatsapp_number_id: metaNumberId },
    });

    if (error) throw error;
    if (data?.success === false) {
      throw new Error(data?.error || `Erro ao enviar mensagem via ${channel}`);
    }

    return { messageId: data?.messageId || null };
  };

  const handleSelectConversation = async (phone: string, whatsappNumberId?: string | null) => {
    const conversationKey = `${phone}__${whatsappNumberId || 'none'}`;
    const selectedConversation = conversations.find((conversation) => {
      const key = conversation.conversationKey || `${conversation.phone}__${conversation.whatsapp_number_id || 'none'}`;
      return key === conversationKey;
    }) || null;
    const conversationChannel = selectedConversation?.channel || null;

    setSelectedPhone(phone);
    setSelectedConvNumberId(whatsappNumberId ?? null);
    setSelectedConvKey(conversationKey);
    setSelectedConvChannel(conversationChannel);
    loadMessages(phone, whatsappNumberId);

    if (conversationChannel === "instagram" || conversationChannel === "messenger") {
      setSelectedSendNumberId(null);
      setSendVia("meta");
    } else if (whatsappNumberId) {
      const matchedNumber = storeNumbers.find((number) => number.id === whatsappNumberId);
      setSelectedSendNumberId(whatsappNumberId);
      setSendVia(matchedNumber?.provider === 'meta' ? 'meta' : 'zapi');
    } else {
      const firstZapi = storeNumbers.find((number) => number.provider === 'zapi') ?? storeNumbers[0] ?? null;
      setSelectedSendNumberId(firstZapi?.id ?? null);
      setSendVia(firstZapi?.provider === 'meta' ? 'meta' : 'zapi');
    }

    // Track seller assignment (opened_at)
    if (selectedSellerId) {
      await supabase.from("chat_seller_assignments").upsert({
        phone,
        seller_id: selectedSellerId,
        store_id: storeId,
        opened_at: new Date().toISOString(),
      } as any, { onConflict: 'phone' });
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone || isSending) return;
    const messageText = newMessage.trim();
    const selectedChannel = getSelectedChannel();
    const useMessenger = selectedChannel === "instagram" || selectedChannel === "messenger";
    const messengerChannel = (selectedChannel as "instagram" | "messenger") || "instagram";

    setIsSending(true);
    setNewMessage("");

    try {
      const numberIdToUse = selectedSendNumberId || storeNumbers.find((number) => number.provider === sendVia)?.id || storeNumbers[0]?.id || null;
      const numberToUse = storeNumbers.find((number) => number.id === numberIdToUse) ?? null;
      const effectiveSendVia = numberToUse?.provider === "meta" ? "meta" : "zapi";

      let metaMessageId: string | null = null;
      if (useMessenger) {
        const result = await sendViaMessenger(selectedPhone, messageText, messengerChannel);
        metaMessageId = result.messageId;
      } else if (effectiveSendVia === "meta") {
        if (!numberIdToUse) {
          throw new Error("Nenhum número Meta configurado para esta loja");
        }
        const res = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: messageText, whatsapp_number_id: numberIdToUse },
        });
        if (res.error) throw res.error;
        metaMessageId = res.data?.messageId || null;
      } else {
        if (!numberIdToUse) {
          throw new Error("Nenhuma instância Z-API configurada para esta loja");
        }
        const { error } = await supabase.functions.invoke("zapi-send-message", {
          body: { phone: selectedPhone, message: messageText, whatsapp_number_id: numberIdToUse },
        });
        if (error) throw error;
      }

      await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone,
        message: messageText,
        direction: "outgoing",
        status: "sent",
        whatsapp_number_id: useMessenger ? null : numberIdToUse || null,
        message_id: metaMessageId,
        channel: useMessenger ? messengerChannel : null,
      });

      await supabase
        .from("automation_ai_sessions")
        .update({ is_active: false })
        .eq("phone", selectedPhone)
        .eq("is_active", true);

      if (selectedSellerId) {
        await supabase.from("chat_seller_assignments")
          .update({ first_reply_at: new Date().toISOString() } as any)
          .eq("phone", selectedPhone)
          .eq("seller_id", selectedSellerId)
          .is("first_reply_at", null);
      }

      loadMessages(selectedPhone, selectedConvNumberId);
    } catch (error) {
      console.error("Error sending:", error);
      setNewMessage(messageText);
      toast.error("Erro ao enviar mensagem");
    } finally {
      setIsSending(false);
    }
  };

  const handleSendAudio = async (audioUrl: string) => {
    if (!selectedPhone) return;
    setIsSending(true);
    try {
      const selectedChannel = getSelectedChannel();
      const useMessenger = selectedChannel === "instagram" || selectedChannel === "messenger";
      const messengerChannel = (selectedChannel as "instagram" | "messenger") || "instagram";
      const numberIdToUse = selectedSendNumberId || storeNumbers.find((number) => number.provider === sendVia)?.id || storeNumbers[0]?.id || null;
      const numberToUse = storeNumbers.find((number) => number.id === numberIdToUse) ?? null;
      const effectiveSendVia = numberToUse?.provider === "meta" ? "meta" : "zapi";

      let audioMsgId: string | null = null;
      if (useMessenger) {
        const result = await sendViaMessenger(selectedPhone, "[áudio]", messengerChannel, "audio", audioUrl);
        audioMsgId = result.messageId;
      } else if (effectiveSendVia === "meta") {
        if (!numberIdToUse) throw new Error("Nenhum número Meta configurado para esta loja");
        const res = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: "[áudio]", whatsapp_number_id: numberIdToUse, media_url: audioUrl, media_type: "audio" },
        });
        if (res.error) throw res.error;
        audioMsgId = res.data?.messageId || null;
      } else {
        if (!numberIdToUse) throw new Error("Nenhuma instância Z-API configurada para esta loja");
        const { error } = await supabase.functions.invoke("zapi-send-media", {
          body: { phone: selectedPhone, mediaUrl: audioUrl, mediaType: "audio", whatsapp_number_id: numberIdToUse },
        });
        if (error) throw error;
      }

      const { error: insertErr } = await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone, message: "[áudio]", direction: "outgoing", status: "sent", media_type: "audio", media_url: audioUrl,
        message_id: audioMsgId,
        whatsapp_number_id: useMessenger ? null : numberIdToUse,
        channel: useMessenger ? messengerChannel : null,
      });
      if (insertErr) console.error("Erro ao salvar áudio no banco:", insertErr);
      loadMessages(selectedPhone, selectedConvNumberId);
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
      const selectedChannel = getSelectedChannel();
      const useMessenger = selectedChannel === "instagram" || selectedChannel === "messenger";
      const messengerChannel = (selectedChannel as "instagram" | "messenger") || "instagram";
      const numberIdToUse = selectedSendNumberId || storeNumbers.find((number) => number.provider === sendVia)?.id || storeNumbers[0]?.id || null;
      const numberToUse = storeNumbers.find((number) => number.id === numberIdToUse) ?? null;
      const effectiveSendVia = numberToUse?.provider === "meta" ? "meta" : "zapi";
      const msgText = caption || `[${mediaType}]`;
      let mediaMsgId: string | null = null;

      if (useMessenger) {
        const result = await sendViaMessenger(
          selectedPhone,
          msgText,
          messengerChannel,
          mediaType === "document" ? "file" : mediaType as "image" | "video" | "audio",
          mediaUrl,
        );
        mediaMsgId = result.messageId;
      } else if (effectiveSendVia === "meta") {
        if (!numberIdToUse) throw new Error("Nenhum número Meta configurado para esta loja");
        const res = await supabase.functions.invoke("meta-whatsapp-send", {
          body: { phone: selectedPhone, message: msgText, whatsapp_number_id: numberIdToUse, media_url: mediaUrl, media_type: mediaType },
        });
        if (res.error) throw res.error;
        mediaMsgId = res.data?.messageId || null;
      } else {
        if (!numberIdToUse) throw new Error("Nenhuma instância Z-API configurada para esta loja");
        const { error } = await supabase.functions.invoke("zapi-send-media", {
          body: { phone: selectedPhone, mediaUrl: mediaUrl, mediaType: mediaType, caption, whatsapp_number_id: numberIdToUse },
        });
        if (error) throw error;
      }

      await supabase.from("whatsapp_messages").insert({
        phone: selectedPhone, message: msgText, direction: "outgoing", status: "sent", media_type: mediaType, media_url: mediaUrl,
        message_id: mediaMsgId,
        whatsapp_number_id: useMessenger ? null : numberIdToUse,
        channel: useMessenger ? messengerChannel : null,
      });
      loadMessages(selectedPhone, selectedConvNumberId);
      toast.success("Mídia enviada!");
    } catch (error) {
      toast.error("Erro ao enviar mídia");
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (msg: any) => {
    if (!msg.message_id || !selectedPhone) throw new Error('No message_id');
    const res = await supabase.functions.invoke("zapi-delete-message", {
      body: { phone: selectedPhone, messageId: msg.message_id, dbMessageId: msg.id, whatsapp_number_id: msg.whatsapp_number_id || selectedSendNumberId },
    });
    if (res.error) throw res.error;
    if (res.data?.error) throw new Error(res.data.error);
    loadMessages(selectedPhone, selectedConvNumberId);
  };

  const handleEditMessage = async (msg: any, newText: string) => {
    if (!msg.message_id || !selectedPhone) throw new Error('No message_id');
    const res = await supabase.functions.invoke("zapi-edit-message", {
      body: { phone: selectedPhone, messageId: msg.message_id, newMessage: newText, dbMessageId: msg.id, whatsapp_number_id: msg.whatsapp_number_id || selectedSendNumberId },
    });
    if (res.error) throw res.error;
    if (res.data?.error) throw new Error(res.data.error);
    loadMessages(selectedPhone, selectedConvNumberId);
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

  const selectedConversation = conversations.find(c => c.conversationKey === selectedConvKey) || conversations.find(c => c.phone === selectedPhone) || null;
  const selectedChannel = getSelectedChannel();
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
      {/* WhatsApp-style Header - simplified */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#008069] dark:bg-[#202c33] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedPhone && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 md:hidden" onClick={() => setSelectedPhone(null)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <MessageCircle className="h-5 w-5 text-white" />
          <span className="font-bold text-white">WhatsApp</span>
          {selectedSellerName && (
            <Badge className="bg-white/20 text-white border-0 text-[10px]">{selectedSellerName}</Badge>
          )}
          {totalUnread > 0 && <Badge className="bg-white text-[#008069] border-0 text-xs font-bold">{totalUnread}</Badge>}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {/* Multi-instance filter */}
          <MultiInstanceFilter
            numbers={storeNumbers}
            selectedIds={multiInstanceFilter}
            onSelectedIdsChange={setMultiInstanceFilter}
            className="h-7 text-[10px] bg-white/10 border-white/20 text-white hover:bg-white/20"
          />
          {/* Agent filter (admins only) */}
          {isAdmin && (
            <AgentFilterSelector
              value={viewAsUserId}
              onValueChange={setViewAsUserId}
              className="h-7 text-[10px] bg-white/10 border-white/20 text-white"
            />
          )}
          {selectedSellerId && (
            <Button
              variant="ghost"
              size="sm"
              className="text-white/80 hover:text-white hover:bg-white/10 gap-1 text-xs"
              onClick={() => setShowDashboard(true)}
            >
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-white/80 hover:text-white hover:bg-white/10 gap-1 text-xs"
            onClick={() => setShowNewConversation(true)}
          >
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Nova Conversa</span>
          </Button>
        </div>
      </div>

      {/* Dashboard view */}
      {showDashboard && selectedSellerId && selectedSellerName ? (
        <POSWhatsAppDashboard
          storeId={storeId}
          sellerId={selectedSellerId}
          sellerName={selectedSellerName}
          onGoToChat={(filter) => {
            setShowDashboard(false);
            if (filter) setStatusFilter(filter);
          }}
          onChangeSeller={() => {
            setSelectedSellerId(null);
            setSelectedSellerName(null);
            sessionStorage.removeItem(sellerKey);
            sessionStorage.removeItem(sellerNameKey);
            setShowDashboard(false);
            setShowSellerGate(true);
          }}
        />
      ) : (
      <>
      {/* Content - Split view */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Conversation List */}
        <div className={cn(
          "flex flex-col min-h-0 overflow-hidden border-r border-[#e9edef] dark:border-[#313d45]",
          selectedPhone ? "hidden md:flex md:w-[35%] lg:w-[30%]" : "flex-1"
        )}>
          <ConversationList
            conversations={multiInstanceFilter.length > 0
              ? conversations.filter(c => multiInstanceFilter.includes(c.whatsapp_number_id || ''))
              : conversations}
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
            metaNumbers={storeNumbers}
            contactPhotos={contactPhotos}
            contactNames={chatContacts}
            selectedPhone={selectedPhone}
            selectedConversationKey={selectedConvKey}
            onBulkFinish={async (phones) => {
              for (const phone of phones) {
                await finishConversation(phone);
              }
              toast.success(`${phones.length} conversa${phones.length !== 1 ? 's' : ''} finalizada${phones.length !== 1 ? 's' : ''}`);
            }}
            hasActiveSupport={hasActiveSupport}
            supportFilterActive={supportFilterActive}
            onSupportFilterToggle={() => setSupportFilterActive(prev => !prev)}
            supportCount={supportCount}
          />
        </div>

        {/* Chat View */}
        {selectedPhone ? (
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            {/* Contact Header Bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 flex-shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7 hidden md:flex" onClick={() => setSelectedPhone(null)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Avatar className="h-8 w-8">
                {contactPhotos[selectedPhone] ? <AvatarImage src={contactPhotos[selectedPhone]} /> : null}
                <AvatarFallback className="bg-[#dfe5e7] dark:bg-[#6b7b8a] text-[#54656f] dark:text-white text-xs font-bold">
                  {selectedConversation?.isGroup ? <Users className="h-4 w-4" /> : getInitials(selectedConversation?.customerName || selectedPhone)}
                </AvatarFallback>
              </Avatar>
              {isEditingName ? (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <Input
                    value={editNameValue}
                    onChange={e => setEditNameValue(e.target.value)}
                    className="h-7 text-sm flex-1"
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleSaveContactName(); if (e.key === "Escape") setIsEditingName(false); }}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveContactName}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-sm font-semibold truncate">{selectedConversation?.customerName || selectedPhone}</span>
                    <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => { setEditNameValue(selectedConversation?.customerName || ""); setIsEditingName(true); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                  {selectedConversation?.customerName && (
                    <span className="text-[10px] text-muted-foreground truncate">{selectedPhone}</span>
                  )}
                  {selectedChannel === "instagram" && (
                    <Badge variant="secondary" className="mt-1 w-fit text-[10px]">📷 Instagram Direct</Badge>
                  )}
                  {selectedChannel === "messenger" && (
                    <Badge variant="secondary" className="mt-1 w-fit text-[10px]">💬 Messenger</Badge>
                  )}
                </div>
              )}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs gap-1 text-[#00a884]" onClick={() => setShowCheckout(true)} title="Gerar Link Checkout">
                  <CreditCard className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">Checkout</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs gap-1 text-emerald-600" onClick={() => setShowPix(true)} title="Gerar PIX">
                  <QrCode className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">PIX</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs gap-1" onClick={() => setShowCatalog(true)} title="Catálogo">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">Catálogo</span>
                </Button>
                <CreateSupportTicketDialog phone={selectedPhone} customerName={selectedConversation?.customerName} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-xs gap-1 text-blue-500 hover:text-blue-400"
                  title="Transferir Conversa"
                  onClick={() => setShowTransferDialog(true)}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">Transferir</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-xs gap-1 text-muted-foreground hover:text-amber-600"
                  title="Arquivar Conversa"
                  onClick={async () => {
                    if (selectedPhone) {
          const conv = conversations.find(c => c.phone === selectedPhone);
          if (conv?.isArchived) {
            await unarchiveConversation(selectedPhone);
            toast.success("Conversa desarquivada");
          } else {
            await archiveConversation(selectedPhone, selectedSellerId || undefined);
            toast.success("Conversa arquivada");
            setSelectedPhone(null);
            setMessages([]);
          }
        }
      }}
    >
      <Archive className="h-3.5 w-3.5" />
      <span className="hidden xl:inline">{conversations.find(c => c.phone === selectedPhone)?.isArchived ? 'Desarquivar' : 'Arquivar'}</span>
    </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-xs gap-1 text-muted-foreground hover:text-destructive"
                  title="Finalizar Conversa"
                  onClick={() => setShowFinishDialog(true)}
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">Finalizar</span>
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[#e9edef] dark:border-[#313d45] bg-white dark:bg-[#202c33] text-xs flex-shrink-0">
              {selectedChannel === "instagram" ? (
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5">📷 Instagram Direct</Badge>
              ) : selectedChannel === "messenger" ? (
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5">💬 Messenger</Badge>
              ) : storeNumbers.length > 1 ? (
                <WhatsAppNumberSelector
                  className="h-7 min-w-[220px] text-xs"
                  value={selectedSendNumberId}
                  onValueChange={(id) => {
                    setSelectedSendNumberId(id);
                    const matchedNumber = storeNumbers.find((number) => number.id === id);
                    if (matchedNumber) {
                      setSendVia(matchedNumber.provider === 'meta' ? 'meta' : 'zapi');
                    }
                  }}
                />
              ) : selectedSendNumber ? (
                <Badge className="text-[10px] px-2 py-0.5 bg-[#00a884] text-white font-medium gap-1">
                  {selectedSendNumber.label}
                  <span className="opacity-70 ml-1">{selectedSendNumber.phone_display}</span>
                </Badge>
              ) : (
                <span className="text-muted-foreground">Nenhuma instância disponível</span>
              )}
              <span className="text-muted-foreground ml-auto">
                {selectedChannel === "instagram"
                  ? "Instagram Direct"
                  : selectedChannel === "messenger"
                    ? "Messenger"
                    : selectedSendNumber?.provider === 'meta'
                      ? 'Meta API'
                      : 'Z-API'}
              </span>
            </div>

            <ChatView
              messages={messages}
              conversation={selectedConversation}
              newMessage={newMessage}
              onNewMessageChange={setNewMessage}
              onSendMessage={handleSendMessage}
              onSendAudio={handleSendAudio}
              onSendMedia={handleSendMedia}
              onDeleteMessage={handleDeleteMessage}
              onEditMessage={handleEditMessage}
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
      </>
      )}

      {/* Product Catalog Sender */}
      {selectedPhone && (
        <POSProductCatalogSender
          storeId={storeId}
          phone={selectedPhone}
          sendVia={selectedSendNumber?.provider === 'meta' ? 'meta' : 'zapi'}
          selectedNumberId={selectedSendNumberId}
          open={showCatalog}
          onOpenChange={setShowCatalog}
        />
      )}

      {/* Checkout Dialog */}
      {selectedPhone && (
        <POSWhatsAppCheckoutDialog
          open={showCheckout}
          onOpenChange={setShowCheckout}
          storeId={storeId}
          phone={selectedPhone}
          customerName={selectedConversation?.customerName}
          sendVia={selectedSendNumber?.provider === 'meta' ? 'meta' : 'zapi'}
          selectedNumberId={selectedSendNumberId}
        />
      )}

      {/* PIX Dialog */}
      {selectedPhone && (
        <POSWhatsAppPixDialog
          open={showPix}
          onOpenChange={setShowPix}
          storeId={storeId}
          phone={selectedPhone}
          customerName={selectedConversation?.customerName}
          sendVia={selectedSendNumber?.provider === 'meta' ? 'meta' : 'zapi'}
          selectedNumberId={selectedSendNumberId}
        />
      )}

      {/* New Conversation Dialog */}
      <NewConversationDialog
        open={showNewConversation}
        onOpenChange={setShowNewConversation}
        onConversationCreated={(phone, whatsappNumberId) => {
          handleSelectConversation(phone, whatsappNumberId);
        }}
      />

      {/* Seller Gate */}
      <POSWhatsAppSellerGate
        storeId={storeId}
        open={showSellerGate && !selectedSellerId}
        onSellerSelected={(id, name) => {
          setSelectedSellerId(id);
          setSelectedSellerName(name);
          sessionStorage.setItem(sellerKey, id);
          sessionStorage.setItem(sellerNameKey, name);
          setShowSellerGate(false);
          setShowDashboard(true);
          toast.success(`Vendedora: ${name}`);
        }}
        onSkip={() => setShowSellerGate(false)}
      />

      {/* Finish Conversation Dialog */}
      <POSFinishConversationDialog
        open={showFinishDialog}
        onOpenChange={setShowFinishDialog}
        onFinish={async (reason) => {
          if (selectedPhone) {
            await finishConversation(selectedPhone, reason, selectedSellerId || undefined);
            
            // Immediately update conversations state so UI reflects the change
            setConversations(prev => prev.map(c =>
              c.phone === selectedPhone ? { ...c, isFinished: true } : c
            ));
            
            // Auto-send NPS when reason is 'compra'
            if (reason === 'compra') {
              const conv = conversations.find(c => c.phone === selectedPhone);
              supabase.functions.invoke('chat-send-nps', {
                body: {
                  phone: selectedPhone,
                  sellerId: selectedSellerId || null,
                  storeId,
                  whatsappNumberId: conv?.whatsapp_number_id || null,
                },
              }).then(res => {
                if (res.data?.success) toast.success('NPS enviado ao cliente');
              }).catch(() => {});
            }

            // Deactivate any active followup for this phone
            supabase.from('chat_payment_followups')
              .update({ is_active: false, completed_at: new Date().toISOString() } as any)
              .eq('phone', selectedPhone)
              .eq('is_active', true)
              .then(() => {});

            setSelectedPhone(null);
            setMessages([]);
            setShowFinishDialog(false);
            toast.success("Conversa finalizada");
          }
        }}
      />

      {/* Transfer Conversation Dialog */}
      {selectedPhone && (
        <TransferConversationDialog
          open={showTransferDialog}
          onOpenChange={setShowTransferDialog}
          phone={selectedPhone}
          whatsappNumberId={selectedConvNumberId}
          customerName={selectedConversation?.customerName}
          currentAssignedTo={getAssignedTo(selectedConvKey || '')}
          onTransferred={() => {
            toast.success("Conversa transferida!");
          }}
        />
      )}
    </div>
  );
}
