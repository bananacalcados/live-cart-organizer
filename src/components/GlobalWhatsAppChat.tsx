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
import { toast } from "sonner";

export function GlobalWhatsAppChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [instanceFilter, setInstanceFilter] = useState<InstanceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ConversationStatusFilter>('all');
  const [sendVia, setSendVia] = useState<'zapi' | 'meta'>('zapi');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [chatContacts, setChatContacts] = useState<Record<string, string>>({});
  
  const { orders, setHasUnreadMessages } = useDbOrderStore();
  const { customers } = useCustomerStore();
  const { events } = useEventStore();
  const { numbers: metaNumbers, selectedNumberId, setSelectedNumberId, fetchNumbers } = useWhatsAppNumberStore();
  const { enrichConversations, finishConversation } = useConversationEnrichment();

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

  useEffect(() => {
    if (!isOpen) return;

    const loadConversations = async () => {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) { console.error('Error loading messages:', error); return; }

      const phoneMap = new Map<string, { messages: Message[], unread: number, isGroup: boolean }>();
      
      for (const msg of data || []) {
        if (!phoneMap.has(msg.phone)) phoneMap.set(msg.phone, { messages: [], unread: 0, isGroup: msg.is_group || false });
        const entry = phoneMap.get(msg.phone)!;
        entry.messages.push(msg);
        if (msg.direction === 'incoming' && msg.status !== 'read') entry.unread++;
        if (msg.is_group) entry.isGroup = true;
      }

      const convs: Conversation[] = [];
      const phoneMessages = new Map<string, { direction: string }[]>();
      
      phoneMap.forEach((value, phone) => {
        const lastMsg = value.messages[0];
        const matchingOrders = orders.filter(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        const order = matchingOrders[0];
        const customer = customers.find(c => c.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
        const isGroup = value.isGroup || phone.includes('@g.us') || phone.includes('-');
        const lastIncoming = value.messages.find(m => m.direction === 'incoming');
        const lastIncomingInstance: 'zapi' | 'meta' | undefined = lastIncoming?.whatsapp_number_id ? 'meta' : lastIncoming ? 'zapi' : undefined;
        const msgWithNumberId = value.messages.find(m => m.whatsapp_number_id);
        const eventNames = matchingOrders.map(o => events.find(e => e.id === o.event_id)?.name).filter(Boolean) as string[];
        
        phoneMessages.set(phone, value.messages.map(m => ({ direction: m.direction })));
        
        convs.push({
          phone,
          lastMessage: lastMsg.message,
          lastMessageAt: new Date(lastMsg.created_at),
          unreadCount: value.unread,
          customerName: chatContacts[phone] || order?.customer?.instagram_handle || customer?.instagram_handle,
          isGroup,
          hasUnansweredMessage: lastMsg.direction === 'incoming',
          stage: order?.stage,
          customerId: order?.customer_id || customer?.id,
          customerTags: customer?.tags,
          whatsapp_number_id: msgWithNumberId?.whatsapp_number_id || null,
          lastIncomingInstance,
          eventNames: [...new Set(eventNames)],
        });
      });

      convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
      setConversations(enrichConversations(convs, phoneMessages));
    };

    loadConversations();

    const channel = supabase
      .channel('global-whatsapp-chat-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, () => {
        loadConversations();
        if (selectedPhone) loadMessages(selectedPhone);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages' }, () => loadConversations())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOpen, orders, selectedPhone, customers, events, chatContacts, enrichConversations]);

  const loadMessages = async (phone: string) => {
    const { data } = await supabase.from('whatsapp_messages').select('*').eq('phone', phone).order('created_at', { ascending: true });
    if (data) setMessages(data || []);
  };

  const handleSelectConversation = (phone: string) => {
    setSelectedPhone(phone);
    loadMessages(phone);
    const conv = conversations.find(c => c.phone === phone);
    if (conv) {
      if (conv.lastIncomingInstance === 'meta') {
        setSendVia('meta');
        if (conv.whatsapp_number_id) setSelectedNumberId(conv.whatsapp_number_id);
      } else {
        setSendVia('zapi');
      }
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
          body: { phone: selectedPhone, message: messageText },
        });
        if (error) throw error;
      }
      await supabase.from('whatsapp_messages').insert({
        phone: selectedPhone, message: messageText, direction: 'outgoing', status: 'sent',
        whatsapp_number_id: sendVia === 'meta' ? selectedNumberId : null,
      });
      loadMessages(selectedPhone);
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
          body: { phone: selectedPhone, mediaUrl: audioUrl, mediaType: 'audio' },
        });
        if (error) throw error;
      }
      await supabase.from('whatsapp_messages').insert({
        phone: selectedPhone, message: '[áudio]', direction: 'outgoing', status: 'sent', media_type: 'audio', media_url: audioUrl,
      });
      loadMessages(selectedPhone);
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

  const selectedConversation = conversations.find(c => c.phone === selectedPhone) || null;
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

      {/* API Selector bar */}
      {selectedPhone && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50 text-xs flex-shrink-0">
          <span className="text-muted-foreground">Enviar via:</span>
          <button onClick={() => setSendVia('zapi')} className={`px-2 py-0.5 rounded-full transition-colors ${sendVia === 'zapi' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>Z-API</button>
          <button onClick={() => setSendVia('meta')} className={`px-2 py-0.5 rounded-full transition-colors ${sendVia === 'meta' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>Meta API</button>
          {sendVia === 'meta' && metaNumbers.length > 1 && <WhatsAppNumberSelector className="h-7 text-xs flex-1" />}
          {sendVia === 'meta' && metaNumbers.length > 0 && (
            <span className="text-muted-foreground truncate">{metaNumbers.find(n => n.id === selectedNumberId)?.label || ''}</span>
          )}
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
