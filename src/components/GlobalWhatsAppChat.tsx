import { useState, useEffect } from "react";
import { MessageCircle, X, ChevronLeft, Phone, Users, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useEventStore } from "@/stores/eventStore";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { WhatsAppNumberSelector } from "./WhatsAppNumberSelector";
import { ConversationList } from "./chat/ConversationList";
import { ChatView } from "./chat/ChatView";
import { Message, Conversation, ChatFilter, StageFilter, InstanceFilter, ConversationStatusFilter } from "./chat/ChatTypes";
import { useConversationEnrichment } from "@/hooks/useConversationEnrichment";
import { useSupportPhones } from "@/hooks/useSupportPhones";
import { toast } from "sonner";

export function GlobalWhatsAppChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedConvNumberId, setSelectedConvNumberId] = useState<string | null>(null);
  const [selectedConvKey, setSelectedConvKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ConversationStatusFilter>('all');
  const [supportFilterActive, setSupportFilterActive] = useState(false);
  const [sendVia, setSendVia] = useState<'zapi' | 'meta'>('zapi');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [chatContacts, setChatContacts] = useState<Record<string, string>>({});
  
  const { orders, setHasUnreadMessages } = useDbOrderStore();
  const { customers } = useCustomerStore();
  const { events } = useEventStore();
  const { numbers: metaNumbers, selectedNumberId, setSelectedNumberId, fetchNumbers } = useWhatsAppNumberStore();
  const { enrichConversations, finishConversation } = useConversationEnrichment();
  const { hasActiveSupport, supportCount } = useSupportPhones();

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  useEffect(() => {
    if (!isOpen) return;
    const loadChatContacts = async () => {
      const { data } = await supabase.from('chat_contacts').select('phone, custom_name, display_name');
      if (data) {
        const map: Record<string, string> = {};
        for (const c of data) {
          if (c.custom_name) map[c.phone] = c.custom_name;
          else if (c.display_name) map[c.phone] = c.display_name;
        }
        setChatContacts(map);
      }
    };
    loadChatContacts();
  }, [isOpen]);

  // Helper to map RPC rows to Conversation objects
  const mapRowsToConvs = (rows: any[]) => {
    const convs: Conversation[] = [];
    const phoneMessages = new Map<string, { direction: string }[]>();
    for (const row of rows) {
      const phone = row.phone;
      const rowNumberId = row.whatsapp_number_id || null;
      const convKey = `${phone}__${rowNumberId || 'none'}`;
      const isGroup = row.is_group || phone.includes('@g.us') || phone.includes('-');

      const msgs: { direction: string }[] = [{ direction: row.direction }];
      if (row.has_outgoing && row.direction === 'incoming') {
        msgs.push({ direction: 'outgoing' });
      }
      phoneMessages.set(convKey, msgs);

      const lastIncomingInstance: 'zapi' | 'meta' | undefined = (() => {
        if (row.direction !== 'incoming' && !row.has_incoming) return undefined;
        if (!rowNumberId) return 'zapi';
        const matchedNumber = metaNumbers.find(n => n.id === rowNumberId);
        if (matchedNumber) return (matchedNumber.provider === 'meta' ? 'meta' : 'zapi') as 'zapi' | 'meta';
        return 'zapi';
      })();

      const senderNameFromRPC = row.sender_name || null;
      const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
      const customer = customers.find(c => c.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
      const matchingOrders = orders.filter(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
      const eventNames = matchingOrders.map(o => events.find(e => e.id === o.event_id)?.name).filter(Boolean) as string[];

      convs.push({
        phone,
        lastMessage: row.last_message,
        lastMessageAt: new Date(row.last_message_at),
        unreadCount: Number(row.unread_count),
        customerName: chatContacts[phone] || senderNameFromRPC || order?.customer?.instagram_handle || customer?.instagram_handle,
        isGroup,
        hasUnansweredMessage: row.direction === 'incoming',
        stage: order?.stage,
        customerId: order?.customer_id || customer?.id,
        customerTags: customer?.tags,
        whatsapp_number_id: rowNumberId,
        lastIncomingInstance,
        isDispatchOnly: row.is_dispatch_only || false,
        eventNames: [...new Set(eventNames)],
        channel: (row as any).channel || null,
      });
    }
    return { convs, phoneMessages };
  };

  useEffect(() => {
    if (!isOpen) return;

    const loadConversations = async () => {
      const regularResult = await supabase.rpc('get_conversations', {
        p_number_id: null,
        p_dispatch_only: false,
      });

      if (regularResult.error) { console.error('Error loading conversations:', regularResult.error); return; }

      const { convs, phoneMessages } = mapRowsToConvs(regularResult.data || []);
      convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      setConversations(enrichConversations(convs, phoneMessages));
    };

    loadConversations();

    const channel = supabase
      .channel('global-whatsapp-chat-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, () => {
        loadConversations();
        if (selectedPhone) loadMessages(selectedPhone, selectedConvNumberId);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages' }, () => loadConversations())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOpen, orders, selectedPhone, selectedConvNumberId, customers, events, chatContacts, enrichConversations, metaNumbers]);

  const loadMessages = async (phone: string, numberId?: string | null) => {
    let query = supabase.from('whatsapp_messages').select('*').eq('phone', phone).order('created_at', { ascending: true });
    if (numberId) {
      query = query.eq('whatsapp_number_id', numberId);
    } else if (numberId === null) {
      query = query.is('whatsapp_number_id', null);
    }
    const { data } = await query;
    if (data) setMessages(data || []);
  };

  const handleSelectConversation = (phone: string, whatsappNumberId?: string | null) => {
    setSelectedPhone(phone);
    setSelectedConvNumberId(whatsappNumberId ?? null);
    setSelectedConvKey(`${phone}__${whatsappNumberId || 'none'}`);
    loadMessages(phone, whatsappNumberId);
    // Auto-route: detect instance from conversation metadata
    if (whatsappNumberId) {
      const matchedNumber = metaNumbers.find(n => n.id === whatsappNumberId);
      if (matchedNumber) {
        setSendVia(matchedNumber.provider === 'meta' ? 'meta' : 'zapi');
        setSelectedNumberId(matchedNumber.id);
      } else {
        setSendVia('zapi');
        setSelectedNumberId(whatsappNumberId);
      }
    } else {
      setSendVia('zapi');
    }
    const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (order) setHasUnreadMessages(order.id, false);
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone || isSending) return;
    const messageText = newMessage.trim();
    setIsSending(true);
    setNewMessage("");
    try {
      if (sendVia === 'meta' && selectedNumberId) {
        const { error } = await supabase.functions.invoke('meta-whatsapp-send', {
          body: { phone: selectedPhone, message: messageText, whatsapp_number_id: selectedNumberId },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.functions.invoke('zapi-send-message', {
          body: { phone: selectedPhone, message: messageText, whatsapp_number_id: selectedNumberId },
        });
        if (error) throw error;
      }
      await supabase.from('whatsapp_messages').insert({
        phone: selectedPhone, message: messageText, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: selectedNumberId || null,
      });
      loadMessages(selectedPhone, selectedConvNumberId);
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Erro ao enviar mensagem');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendAudio = async (audioUrl: string) => {
    if (!selectedPhone) return;
    setIsSending(true);
    try {
      if (sendVia === 'meta' && selectedNumberId) {
        const { error } = await supabase.functions.invoke('meta-whatsapp-send', {
          body: { phone: selectedPhone, message: '[áudio]', whatsapp_number_id: selectedNumberId, media_url: audioUrl, media_type: 'audio' },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.functions.invoke('zapi-send-media', {
          body: { phone: selectedPhone, mediaUrl: audioUrl, mediaType: 'audio', whatsapp_number_id: selectedNumberId },
        });
        if (error) throw error;
      }
      await supabase.from('whatsapp_messages').insert({
        phone: selectedPhone, message: '[áudio]', direction: 'outgoing', status: 'sent', media_type: 'audio', media_url: audioUrl,
      });
      loadMessages(selectedPhone, selectedConvNumberId);
      toast.success('Áudio enviado!');
    } catch (error) {
      console.error('Error sending audio:', error);
      toast.error('Erro ao enviar áudio');
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveContactName = async () => {
    if (!selectedPhone) return;
    const name = editNameValue.trim();
    try {
      await supabase.from('chat_contacts').upsert({ phone: selectedPhone, custom_name: name || null }, { onConflict: 'phone' });
      setChatContacts(prev => {
        const next = { ...prev };
        if (name) next[selectedPhone] = name;
        else delete next[selectedPhone];
        return next;
      });
      setIsEditingName(false);
      toast.success('Nome atualizado!');
    } catch (error) {
      console.error('Error saving contact name:', error);
      toast.error('Erro ao salvar nome');
    }
  };

  const selectedConversation = conversations.find(c => c.conversationKey === selectedConvKey) || conversations.find(c => c.phone === selectedPhone) || null;
  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-4 z-50 h-14 w-14 rounded-full shadow-lg bg-stage-paid hover:bg-stage-paid/90"
        size="icon"
      >
        <MessageCircle className="h-6 w-6" />
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </Button>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 w-[420px] h-[650px] bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-stage-paid text-white flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedPhone ? (
            <>
              {selectedConversation?.isGroup ? <Users className="h-5 w-5 flex-shrink-0" /> : <Phone className="h-5 w-5 flex-shrink-0" />}
              {isEditingName ? (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <Input value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)}
                    className="h-7 text-sm bg-white/20 border-white/30 text-white placeholder:text-white/60 flex-1" placeholder="Nome do contato" autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveContactName(); if (e.key === 'Escape') setIsEditingName(false); }} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/20" onClick={handleSaveContactName}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <span className="font-semibold truncate">
                    {selectedConversation?.customerName || selectedPhone}
                  </span>
                  {selectedConversation?.instanceLabel && (
                    <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded flex-shrink-0">
                      {selectedConversation.instanceLabel}
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-white/70 hover:bg-white/20 flex-shrink-0"
                    onClick={() => { setEditNameValue(selectedConversation?.customerName || ''); setIsEditingName(true); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <MessageCircle className="h-5 w-5" />
              <span className="font-semibold">WhatsApp</span>
            </>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20 flex-shrink-0"
          onClick={() => { setIsOpen(false); setSelectedPhone(null); }}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Auto-routed instance indicator (locked) */}
      {selectedPhone && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50 text-xs flex-shrink-0">
          {(() => {
            const activeNum = metaNumbers.find(n => n.id === selectedNumberId);
            return activeNum ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
                🔒 {activeNum.label}
                <span className="opacity-70">{activeNum.phone_display}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Nenhuma instância detectada</span>
            );
          })()}
          {/* Cross-instance indicator */}
          {selectedConversation?.hasOtherInstances && (
            <span className="text-[10px] text-orange-400">
              🔗 Também em: {selectedConversation.otherInstanceLabels?.join(', ')}
            </span>
          )}
          <span className="text-muted-foreground ml-auto">
            {sendVia === 'meta' ? 'Meta API' : 'Z-API'}
          </span>
        </div>
      )}

      {/* Content */}
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
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          metaNumbers={metaNumbers}
          hasActiveSupport={hasActiveSupport}
          supportFilterActive={supportFilterActive}
          onSupportFilterToggle={() => setSupportFilterActive(prev => !prev)}
          supportCount={supportCount}
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
          onFinish={async () => {
            if (selectedPhone) await finishConversation(selectedPhone);
            setSelectedPhone(null);
            toast.success("Conversa finalizada");
          }}
          isSending={isSending}
        />
      )}
    </div>
  );
}
