import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Phone, Users, MessageCircle, Filter, ArrowLeft,
  Send, Mic, Image, Video, Paperclip, X, Check, CheckCheck,
  Clock, Camera, Plus, Smile, MoreVertical, ChevronDown, Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useDbOrderStore } from "@/stores/dbOrderStore";
import { useCustomerStore } from "@/stores/customerStore";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { useZapi } from "@/hooks/useZapi";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
import { toast } from "sonner";
import { Message, Conversation, ChatFilter } from "@/components/chat/ChatTypes";
import { STAGES } from "@/types/order";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Status icon helper ──
function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'sending': return <Clock className="h-3 w-3" />;
    case 'sent': return <Check className="h-3 w-3" />;
    case 'delivered': return <CheckCheck className="h-3 w-3" />;
    case 'read': return <CheckCheck className="h-3 w-3 text-[#53bdeb]" />;
    case 'failed': return <X className="h-3 w-3 text-red-400" />;
    default: return <Check className="h-3 w-3" />;
  }
}

// ── Media in message bubble ──
function MessageMedia({ msg }: { msg: Message }) {
  if (!msg.media_url || msg.media_type === 'text') return null;
  if (msg.media_type === 'image') return <img src={msg.media_url} alt="" className="max-w-full rounded-md mb-1" style={{ maxHeight: 280 }} />;
  if (msg.media_type === 'video') return <video src={msg.media_url} controls className="max-w-full rounded-md mb-1" style={{ maxHeight: 280 }} />;
  if (msg.media_type === 'audio') return <audio src={msg.media_url} controls className="w-full mb-1" />;
  return <div className="flex items-center gap-2 p-2 bg-black/5 rounded mb-1"><Paperclip className="h-4 w-4" /><span className="text-xs truncate">{msg.message}</span></div>;
}

// ── Format helpers ──
function formatConvTime(date: Date) {
  if (isToday(date)) return format(date, 'HH:mm', { locale: ptBR });
  if (isYesterday(date)) return 'Ontem';
  return format(date, 'dd/MM', { locale: ptBR });
}

function getMediaType(file: File): 'image' | 'audio' | 'video' | 'document' {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

export default function ChatPage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Media
  const [selectedMedia, setSelectedMedia] = useState<{ file: File; type: 'image' | 'audio' | 'video' | 'document'; previewUrl: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { orders, setHasUnreadMessages } = useDbOrderStore();
  const { customers } = useCustomerStore();
  const { numbers, fetchNumbers, selectedNumberId, setSelectedNumberId } = useWhatsAppNumberStore();
  const { sendMessage: zapiSend, sendMedia: zapiSendMedia } = useZapi();

  // ── Fetch numbers on mount ──
  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  // ── Load conversations ──
  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) { console.error('Error loading messages:', error); return; }

    const phoneMap = new Map<string, { messages: Message[]; unread: number; isGroup: boolean }>();
    for (const msg of data || []) {
      if (!phoneMap.has(msg.phone)) phoneMap.set(msg.phone, { messages: [], unread: 0, isGroup: msg.is_group || false });
      const entry = phoneMap.get(msg.phone)!;
      entry.messages.push(msg as Message);
      if (msg.direction === 'incoming' && msg.status !== 'read') entry.unread++;
      if (msg.is_group) entry.isGroup = true;
    }

    const convs: Conversation[] = [];
    phoneMap.forEach((value, phone) => {
      const lastMsg = value.messages[0];
      const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
      const customer = customers.find(c => c.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
      const isGroup = value.isGroup || phone.includes('@g.us') || phone.includes('-');
      convs.push({
        phone,
        lastMessage: lastMsg.message,
        lastMessageAt: new Date(lastMsg.created_at),
        unreadCount: value.unread,
        customerName: order?.customer?.instagram_handle || customer?.instagram_handle,
        isGroup,
        hasUnansweredMessage: lastMsg.direction === 'incoming',
        stage: order?.stage,
        customerId: order?.customer_id || customer?.id,
        customerTags: customer?.tags,
      });
    });
    convs.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
    setConversations(convs);
  }, [orders, customers]);

  useEffect(() => {
    loadConversations();
    const channel = supabase
      .channel('chat-page-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, () => {
        loadConversations();
        if (selectedPhone) loadMessages(selectedPhone);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages' }, () => {
        loadConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadConversations, selectedPhone]);

  // ── Load messages for a phone ──
  const loadMessages = async (phone: string) => {
    setIsLoadingMessages(true);
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: true });
    if (!error) setMessages((data || []) as Message[]);
    setIsLoadingMessages(false);
  };

  // ── Select conversation ──
  const handleSelectConversation = (phone: string) => {
    setSelectedPhone(phone);
    loadMessages(phone);
    const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (order) setHasUnreadMessages(order.id, false);
  };

  // ── Scroll on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── File select ──
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error('Arquivo muito grande. Máximo 16MB.'); return; }
    setSelectedMedia({ file, type: getMediaType(file), previewUrl: URL.createObjectURL(file) });
    event.target.value = '';
  };

  // ── Audio recording ──
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setRecordingDuration(0);

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `audio-${Date.now()}.webm`, { type: 'audio/webm' });
        setSelectedMedia({ file: audioFile, type: 'audio', previewUrl: URL.createObjectURL(audioBlob) });
        setIsRecording(false);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingDuration(0);
    audioChunksRef.current = [];
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Send message ──
  const handleSend = async () => {
    if (isSending || isUploading || !selectedPhone) return;

    // Send media
    if (selectedMedia) {
      setIsUploading(true);
      const mediaUrl = await uploadMediaToStorage(selectedMedia.file);
      if (!mediaUrl) { setIsUploading(false); return; }

      const result = await zapiSendMedia(selectedPhone, mediaUrl, selectedMedia.type, newMessage.trim() || undefined);
      if (result.success) {
        await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone,
          message: newMessage.trim() || `[${selectedMedia.type}]`,
          direction: 'outgoing',
          status: 'sent',
          media_type: selectedMedia.type,
          media_url: mediaUrl,
        });
      }
      URL.revokeObjectURL(selectedMedia.previewUrl);
      setSelectedMedia(null);
      setNewMessage("");
      setIsUploading(false);
      return;
    }

    // Send text
    if (!newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage("");
    setIsSending(true);

    const result = await zapiSend(selectedPhone, text);
    if (result.success) {
      await supabase.from('whatsapp_messages').insert({
        phone: selectedPhone,
        message: text,
        direction: 'outgoing',
        status: 'sent',
      });
    }
    setIsSending(false);
  };

  // ── Filter conversations ──
  const filteredConversations = conversations
    .filter(c => {
      if (chatFilter === 'contacts' && c.isGroup) return false;
      if (chatFilter === 'groups' && !c.isGroup) return false;
      return true;
    })
    .filter(c =>
      c.phone.includes(searchQuery) ||
      c.customerName?.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const selectedConv = conversations.find(c => c.phone === selectedPhone);
  const contactsCount = conversations.filter(c => !c.isGroup).length;
  const groupsCount = conversations.filter(c => c.isGroup).length;

  return (
    <div className="h-screen flex flex-col bg-[#111b21]">
      {/* WhatsApp-style top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#202c33] border-b border-[#2a3942]">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="text-[#aebac1] hover:bg-[#2a3942]" onClick={() => navigate('/events')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <MessageCircle className="h-5 w-5 text-[#00a884]" />
          <span className="text-[#e9edef] font-semibold text-lg">WhatsApp</span>
        </div>
        {/* Instance selector */}
        {numbers.length > 1 && (
          <Select value={selectedNumberId || ''} onValueChange={setSelectedNumberId}>
            <SelectTrigger className="w-auto min-w-[180px] h-8 text-xs bg-[#2a3942] border-[#3b4a54] text-[#e9edef]">
              <Phone className="h-3.5 w-3.5 mr-2 text-[#00a884]" />
              <SelectValue placeholder="Instância" />
            </SelectTrigger>
            <SelectContent className="bg-[#233138] border-[#3b4a54]">
              {numbers.map((num) => (
                <SelectItem key={num.id} value={num.id} className="text-[#e9edef] focus:bg-[#2a3942] focus:text-[#e9edef]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{num.label}</span>
                    <span className="text-[#8696a0] text-xs">{num.phone_display}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel: conversation list ── */}
        <div className={cn(
          "w-[420px] flex flex-col bg-[#111b21] border-r border-[#2a3942]",
          selectedPhone && "hidden md:flex"
        )}>
          {/* Search */}
          <div className="p-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8696a0]" />
              <Input
                placeholder="Pesquisar ou começar uma nova conversa"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9 bg-[#202c33] border-none text-[#e9edef] placeholder:text-[#8696a0] focus-visible:ring-0"
              />
            </div>
            {/* Filter tabs */}
            <div className="flex gap-1.5">
              {(['all', 'contacts', 'groups'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setChatFilter(f)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    chatFilter === f
                      ? "bg-[#00a884] text-[#111b21]"
                      : "bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]"
                  )}
                >
                  {f === 'all' ? 'Todas' : f === 'contacts' ? `Contatos (${contactsCount})` : `Grupos (${groupsCount})`}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[#8696a0]">
                <MessageCircle className="h-16 w-16 mb-3 opacity-30" />
                <p className="text-sm">Nenhuma conversa encontrada</p>
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <button
                  key={conv.phone}
                  onClick={() => handleSelectConversation(conv.phone)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 hover:bg-[#202c33] transition-colors",
                    selectedPhone === conv.phone && "bg-[#2a3942]",
                    conv.hasUnansweredMessage && "bg-[#1a2e1a] hover:bg-[#1e3520]"
                  )}
                >
                  <div className={cn(
                    "h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0 text-lg font-semibold uppercase",
                    conv.isGroup ? "bg-[#00a884]/20 text-[#00a884]" : "bg-[#2a3942] text-[#aebac1]"
                  )}>
                    {conv.isGroup ? <Users className="h-6 w-6" /> : (conv.customerName || conv.phone).charAt(0).replace('@', '')}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[#e9edef] font-medium text-[15px] truncate">
                        {conv.customerName || conv.phone}
                      </span>
                      <span className={cn(
                        "text-xs flex-shrink-0 ml-2",
                        conv.unreadCount > 0 ? "text-[#00a884]" : "text-[#8696a0]"
                      )}>
                        {formatConvTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-sm text-[#8696a0] truncate flex-1">{conv.lastMessage}</p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {conv.customerTags?.slice(0, 1).map(tag => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-[#00a884]/20 text-[#00a884]">{tag}</span>
                        ))}
                        {conv.unreadCount > 0 && (
                          <span className="h-5 min-w-5 px-1 rounded-full bg-[#00a884] text-[#111b21] text-xs font-medium flex items-center justify-center">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Right panel: chat area ── */}
        <div className={cn(
          "flex-1 flex flex-col",
          !selectedPhone && "hidden md:flex"
        )}>
          {!selectedPhone ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center bg-[#222e35]">
              <div className="text-center">
                <MessageCircle className="h-20 w-20 text-[#364147] mx-auto mb-4" />
                <h2 className="text-[#e9edef] text-2xl font-light mb-2">WhatsApp Web</h2>
                <p className="text-[#8696a0] text-sm max-w-md">
                  Envie e receba mensagens diretamente pelo seu CRM.<br />
                  Selecione uma conversa para começar.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-2 bg-[#202c33] border-b border-[#2a3942]">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden text-[#aebac1] hover:bg-[#2a3942]"
                  onClick={() => setSelectedPhone(null)}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 text-base font-semibold uppercase",
                  selectedConv?.isGroup ? "bg-[#00a884]/20 text-[#00a884]" : "bg-[#2a3942] text-[#aebac1]"
                )}>
                  {selectedConv?.isGroup ? <Users className="h-5 w-5" /> : (selectedConv?.customerName || selectedPhone).charAt(0).replace('@', '')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#e9edef] font-medium truncate">{selectedConv?.customerName || selectedPhone}</p>
                  <p className="text-xs text-[#8696a0] truncate">{selectedPhone}</p>
                </div>
                {selectedConv?.stage && (
                  <span className="text-xs text-[#8696a0] bg-[#2a3942] px-2 py-1 rounded">
                    {STAGES.find(s => s.id === selectedConv.stage)?.title}
                  </span>
                )}
              </div>

              {/* Messages area */}
              <div
                className="flex-1 overflow-y-auto px-[6%] py-3"
                style={{
                  backgroundColor: '#0b141a',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='400' height='400' viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%231e2a30' fill-opacity='0.5'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
              >
                {isLoadingMessages ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="w-8 h-8 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="bg-[#182229] rounded-lg px-6 py-3 text-center">
                      <p className="text-sm text-[#8696a0]">Nenhuma mensagem ainda</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {messages.map((msg, i) => {
                      const showDate = i === 0 || new Date(msg.created_at).toDateString() !== new Date(messages[i - 1].created_at).toDateString();
                      return (
                        <div key={msg.id}>
                          {showDate && (
                            <div className="flex justify-center my-3">
                              <span className="bg-[#182229] text-[#8696a0] text-[11px] px-3 py-1 rounded-lg shadow">
                                {isToday(new Date(msg.created_at)) ? 'Hoje' :
                                 isYesterday(new Date(msg.created_at)) ? 'Ontem' :
                                 format(new Date(msg.created_at), "d 'de' MMMM", { locale: ptBR })}
                              </span>
                            </div>
                          )}
                          <div className={cn("flex mb-0.5", msg.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
                            <div
                              className={cn(
                                "max-w-[65%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm relative",
                                msg.direction === 'outgoing'
                                  ? 'bg-[#005c4b] text-[#e9edef]'
                                  : 'bg-[#202c33] text-[#e9edef]'
                              )}
                              style={{
                                borderTopRightRadius: msg.direction === 'outgoing' ? 0 : undefined,
                                borderTopLeftRadius: msg.direction === 'incoming' ? 0 : undefined,
                              }}
                            >
                              <MessageMedia msg={msg} />
                              {msg.message && <p className="whitespace-pre-wrap break-words pr-14 leading-[1.35]">{msg.message}</p>}
                              <div className="absolute bottom-1 right-2 flex items-center gap-1 text-[11px] text-[#ffffff99]">
                                <span>{format(new Date(msg.created_at), "HH:mm")}</span>
                                {msg.direction === 'outgoing' && <StatusIcon status={msg.status || null} />}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Media preview */}
              {selectedMedia && (
                <div className="px-4 py-3 bg-[#1a2228] border-t border-[#2a3942] flex items-center gap-3">
                  {selectedMedia.type === 'image' && <img src={selectedMedia.previewUrl} alt="" className="h-16 w-16 object-cover rounded-lg" />}
                  {selectedMedia.type === 'video' && <video src={selectedMedia.previewUrl} className="h-16 w-16 object-cover rounded-lg" />}
                  {selectedMedia.type === 'audio' && (
                    <div className="h-16 w-16 bg-[#2a3942] rounded-lg flex items-center justify-center"><Mic className="h-6 w-6 text-[#00a884]" /></div>
                  )}
                  {selectedMedia.type === 'document' && (
                    <div className="h-16 w-16 bg-[#2a3942] rounded-lg flex items-center justify-center"><Paperclip className="h-6 w-6 text-[#8696a0]" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#e9edef] font-medium truncate">{selectedMedia.file.name}</p>
                    <p className="text-xs text-[#8696a0]">{(selectedMedia.file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => { URL.revokeObjectURL(selectedMedia.previewUrl); setSelectedMedia(null); }} className="text-[#aebac1] hover:bg-[#2a3942]">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Recording bar */}
              {isRecording && (
                <div className="px-4 py-3 bg-[#1a2228] border-t border-[#2a3942] flex items-center gap-3">
                  <Button variant="ghost" size="icon" onClick={cancelRecording} className="text-red-400 hover:bg-[#2a3942]">
                    <X className="h-5 w-5" />
                  </Button>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[#e9edef] text-sm font-mono">{formatDuration(recordingDuration)}</span>
                    <div className="flex-1 h-1 bg-[#2a3942] rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full animate-pulse" style={{ width: '60%' }} />
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={stopRecording} className="text-[#00a884] hover:bg-[#2a3942]">
                    <Square className="h-5 w-5 fill-current" />
                  </Button>
                </div>
              )}

              {/* Input bar */}
              {!isRecording && (
                <div className="flex items-center gap-2 px-3 py-2 bg-[#202c33] border-t border-[#2a3942]">
                  {/* Hidden file inputs */}
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                  <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
                  <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar" className="hidden" onChange={handleFileSelect} />

                  {/* Attachment menu */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-[#8696a0] hover:bg-[#2a3942] h-10 w-10">
                        <Plus className="h-6 w-6" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-[#233138] border-[#3b4a54] text-[#e9edef]" align="start" side="top">
                      <DropdownMenuItem onClick={() => imageInputRef.current?.click()} className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                        <Image className="h-4 w-4 text-[#bf59cf]" /> Foto
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => videoInputRef.current?.click()} className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                        <Video className="h-4 w-4 text-[#ff6b6b]" /> Vídeo
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => docInputRef.current?.click()} className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                        <Paperclip className="h-4 w-4 text-[#5f66cd]" /> Documento
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment'; input.onchange = (e: any) => handleFileSelect(e); input.click(); }} className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                        <Camera className="h-4 w-4 text-[#d3396d]" /> Câmera
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <EmojiPickerButton onEmojiSelect={(emoji) => setNewMessage(prev => prev + emoji)} />

                  {/* Message input */}
                  <Input
                    ref={inputRef}
                    placeholder="Digite uma mensagem"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    className="flex-1 bg-[#2a3942] border-none text-[#e9edef] placeholder:text-[#8696a0] focus-visible:ring-0 h-10 rounded-lg"
                  />

                  {/* Send or Mic button */}
                  {newMessage.trim() || selectedMedia ? (
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={isSending || isUploading}
                      className="bg-[#00a884] hover:bg-[#00a884]/90 text-[#111b21] h-10 w-10 rounded-full"
                    >
                      <Send className="h-5 w-5" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      onClick={startRecording}
                      className="bg-transparent hover:bg-[#2a3942] text-[#8696a0] h-10 w-10 rounded-full"
                    >
                      <Mic className="h-6 w-6" />
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
