import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Phone, Users, MessageCircle, Filter, ArrowLeft,
  Send, Mic, Image, Video, Paperclip, X, Check, CheckCheck,
  Clock, Camera, Plus, Smile, MoreVertical, ChevronDown, Square,
  FileText, UserPlus, Pencil,
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
import { useSupportPhones } from "@/hooks/useSupportPhones";
import { Message, Conversation, ChatFilter, ConversationStatusFilter } from "@/components/chat/ChatTypes";
import { useConversationEnrichment } from "@/hooks/useConversationEnrichment";
import { useCrmPhoneLookup } from "@/hooks/useCrmPhoneLookup";
import { STAGES } from "@/types/order";
import { WhatsAppMediaAttachment } from "@/components/chat/WhatsAppMediaAttachment";
import { InstagramReferralCard } from "@/components/chat/InstagramReferralCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Status icon helper ──
function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'sending': return <Clock className="h-3 w-3 text-[#ffffff99]" />;
    case 'sent': return <Check className="h-3 w-3 text-[#ffffff99]" />;
    case 'delivered': return <CheckCheck className="h-3 w-3 text-[#ffffff99]" />;
    case 'read': return <CheckCheck className="h-3 w-3 text-[#53bdeb]" />;
    case 'failed': return <X className="h-3 w-3 text-red-400" />;
    default: return <Check className="h-3 w-3 text-[#ffffff99]" />;
  }
}

// ── Media in message bubble ──
function MessageMedia({ msg }: { msg: Message }) {
  return (
    <WhatsAppMediaAttachment
      mediaUrl={msg.media_url}
      mediaType={msg.media_type}
      message={msg.message}
      imageClassName="max-w-full rounded-md mb-1"
      imageStyle={{ maxHeight: 280 }}
      videoClassName="max-w-full rounded-md mb-1"
      videoStyle={{ maxHeight: 280 }}
      audioClassName="w-full mb-1"
      documentClassName="mb-1 rounded-md bg-black/5 p-2"
      pdfClassName="w-full h-72 rounded-md border border-border bg-background mb-2"
    />
  );
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

// ── Meta Template interface ──
interface MetaTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    example?: { header_handle?: string[]; body_text?: string[][] };
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
}

// ── Chat contact type ──
interface ChatContact {
  id: string;
  phone: string;
  display_name: string | null;
  custom_name: string | null;
}

export default function ChatPage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedConvNumberId, setSelectedConvNumberId] = useState<string | null | undefined>(undefined);
  const [selectedConvKey, setSelectedConvKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [numberFilter, setNumberFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ConversationStatusFilter>('all');
  const [supportFilterActive, setSupportFilterActive] = useState(false);
  const [chatContacts, setChatContacts] = useState<ChatContact[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  // Templates
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<MetaTemplate | null>(null);
  const [templateParamValues, setTemplateParamValues] = useState<string[]>([]);
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState("");

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
  const activeConversationRef = useRef<{ phone: string | null; numberId: string | null | undefined }>({
    phone: null,
    numberId: undefined,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { orders, setHasUnreadMessages } = useDbOrderStore();
  const { customers } = useCustomerStore();
  const { numbers, fetchNumbers, selectedNumberId, setSelectedNumberId } = useWhatsAppNumberStore();
  const { sendMessage: zapiSend, sendMedia: zapiSendMedia } = useZapi();
  const { enrichConversations, finishConversation } = useConversationEnrichment();
  const { hasActiveSupport, supportCount } = useSupportPhones();

  // CRM phone lookup for conversation names
  const conversationPhones = useMemo(() => conversations.map(c => c.phone), [conversations]);
  const { crmMap, deleteWhatsApp } = useCrmPhoneLookup(conversationPhones);

  // ── Fetch numbers and contacts on mount ──
  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);
  
  useEffect(() => {
    const loadContacts = async () => {
      const { data } = await supabase.from('chat_contacts').select('*');
      if (data) setChatContacts(data as ChatContact[]);
    };
    loadContacts();
    const channel = supabase
      .channel('chat-contacts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_contacts' }, () => loadContacts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const getContactName = useCallback((phone: string): string | null => {
    const contact = chatContacts.find(c => c.phone === phone);
    if (contact?.custom_name) return contact.custom_name;
    if (contact?.display_name) return contact.display_name;
    return null;
  }, [chatContacts]);

  useEffect(() => {
    activeConversationRef.current = {
      phone: selectedPhone,
      numberId: selectedConvNumberId,
    };
  }, [selectedPhone, selectedConvNumberId]);

  const saveContactName = async (phone: string, customName: string) => {
    const existing = chatContacts.find(c => c.phone === phone);
    if (existing) {
      await supabase.from('chat_contacts').update({ custom_name: customName || null }).eq('id', existing.id);
    } else {
      await supabase.from('chat_contacts').insert({ phone, custom_name: customName || null });
    }
    setEditingName(false);
  };

  // ── Helper to map RPC rows to Conversation objects ──
  const mapRowsToConvs = useCallback((rows: any[]) => {
    const convs: Conversation[] = [];
    const phoneMessages = new Map<string, { direction: string }[]>();
    for (const row of rows) {
      const phone = row.phone;
      const rowNumberId = row.whatsapp_number_id || null;
      const convKey = `${phone}__${rowNumberId || 'none'}`;
      const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
      const customer = customers.find(c => c.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
      const isGroup = row.is_group || phone.includes('@g.us') || phone.includes('-');

      const msgs: { direction: string }[] = [{ direction: row.direction }];
      if (row.has_outgoing && row.direction === 'incoming') {
        msgs.push({ direction: 'outgoing' });
      }
      phoneMessages.set(convKey, msgs);

      const senderNameFromRPC = row.sender_name || null;
      convs.push({
        phone,
        lastMessage: row.last_message,
        lastMessageAt: new Date(row.last_message_at),
        unreadCount: Number(row.unread_count),
        customerName: getContactName(phone) || senderNameFromRPC || crmMap.get(phone)?.name || order?.customer?.instagram_handle || customer?.instagram_handle,
        isGroup,
        hasUnansweredMessage: row.direction === 'incoming',
        stage: order?.stage,
        customerId: order?.customer_id || customer?.id,
        customerTags: customer?.tags,
        whatsapp_number_id: rowNumberId,
        isDispatchOnly: row.is_dispatch_only || false,
        channel: (row as any).channel || null,
      });
    }
    return { convs, phoneMessages };
  }, [orders, customers, getContactName, crmMap]);

  // ── Load conversations via RPC - separate calls for regular and dispatch ──
  const loadConversations = useCallback(async () => {
    const numberId = numberFilter !== 'all' ? numberFilter : undefined;

    // Load regular (non-dispatch) and dispatch conversations in parallel
    const [regularResult, dispatchResult] = await Promise.all([
      supabase.rpc('get_conversations', {
        p_number_id: numberId || null,
        p_dispatch_only: false,
      }),
      supabase.rpc('get_conversations', {
        p_number_id: numberId || null,
        p_dispatch_only: true,
      }),
    ]);

    if (regularResult.error) { console.error('Error loading conversations:', regularResult.error); return; }

    const allRows = [...(regularResult.data || []), ...(dispatchResult.data || [])];
    const { convs, phoneMessages } = mapRowsToConvs(allRows);

    setConversations(enrichConversations(convs, phoneMessages));
  }, [numberFilter, mapRowsToConvs, enrichConversations]);

  useEffect(() => {
    loadConversations();
    const channel = supabase
      .channel('chat-page-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, () => {
        loadConversations();
        const active = activeConversationRef.current;
        if (active.phone) loadMessages(active.phone, false, active.numberId);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages' }, () => {
        loadConversations();
        const active = activeConversationRef.current;
        if (active.phone) loadMessages(active.phone, false, active.numberId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadConversations]);

  // ── Load messages for a phone (paginated) ──
  const PAGE_SIZE = 50;

  const loadMessages = async (phone: string, loadMore = false, numberId?: string | null) => {
    if (loadMore) setIsLoadingMore(true);
    else setIsLoadingMessages(true);

    const offset = loadMore ? messages.length : 0;
    let query = supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    
    // Filter by whatsapp_number_id if specified
    if (numberId !== undefined) {
      if (numberId) {
        query = query.eq('whatsapp_number_id', numberId);
      } else {
        query = query.is('whatsapp_number_id', null);
      }
    }

    const { data, error } = await query;

    if (!error && data) {
      const sorted = [...data].reverse() as Message[];
      if (loadMore) {
        setMessages(prev => [...sorted, ...prev]);
      } else {
        setMessages(sorted);
      }
      setHasMoreMessages(data.length === PAGE_SIZE);
    }

    if (loadMore) setIsLoadingMore(false);
    else setIsLoadingMessages(false);
  };

  // ── Select conversation ──
  const handleSelectConversation = (conv: Conversation) => {
    const phone = conv.phone;
    const numberId = conv.whatsapp_number_id;
    setSelectedPhone(phone);
    setSelectedConvNumberId(numberId);
    setSelectedConvKey(conv?.conversationKey || `${phone}__${numberId || 'none'}`);
    loadMessages(phone, false, numberId);
    const order = orders.find(o => o.customer?.whatsapp?.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (order) setHasUnreadMessages(order.id, false);
    // Auto-route: lock to the instance
    if (numberId) {
      setNumberFilter(numberId);
      setSelectedNumberId(numberId);
    }
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
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
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
    } catch { toast.error('Não foi possível acessar o microfone'); }
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); };

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

  // ── Determine if using Meta API ──
  const getActiveNumberId = (): string | null => {
    // If we have a selected conversation with a specific instance, use that
    if (selectedConvNumberId) return selectedConvNumberId;
    return numberFilter !== 'all' ? numberFilter : (selectedNumberId || null);
  };

  const isMetaNumber = (): boolean => {
    // Z-API conversations have null whatsapp_number_id — always use Z-API for them
    if (selectedConvNumberId === null) return false;
    const numId = getActiveNumberId();
    if (!numId) return false;
    return numbers.some(n => n.id === numId);
  };

  const sendViaMeta = async (phone: string, message: string, type: string = 'text', mediaUrl?: string, caption?: string): Promise<{ success: boolean; messageId?: string }> => {
    const numberId = getActiveNumberId();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-send`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone, message, type, mediaUrl, caption, whatsappNumberId: numberId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      toast.error(data?.error || 'Erro ao enviar mensagem via Meta API');
      return { success: false };
    }
    toast.success('Mensagem enviada!');
    return { success: true, messageId: data.messageId };
  };

  // ── Send via Messenger/Instagram API ──
  const sendViaMessenger = async (recipientId: string, message: string, channel: 'messenger' | 'instagram' = 'instagram', type: string = 'text', mediaUrl?: string): Promise<{ success: boolean; messageId?: string }> => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-messenger-send`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipientId, message, channel, type, mediaUrl }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      toast.error(data?.error || `Erro ao enviar mensagem via ${channel}`);
      return { success: false };
    }
    toast.success('Mensagem enviada!');
    return { success: true, messageId: data.messageId };
  };

  // ── Get selected conversation channel ──
  const getSelectedChannel = (): string | null => {
    if (!selectedPhone) return null;
    const conv = conversations.find(c => c.phone === selectedPhone && c.conversationKey === selectedConvKey);
    return conv?.channel || null;
  };

  const isInstagramOrMessenger = (): boolean => {
    const ch = getSelectedChannel();
    return ch === 'instagram' || ch === 'messenger';
  };

  // ── Send message ──
  const handleSend = async () => {
    if (isSending || isUploading || !selectedPhone) return;
    const useMeta = isMetaNumber();
    const useMessenger = isInstagramOrMessenger();
    const messengerChannel = (getSelectedChannel() as 'instagram' | 'messenger') || 'instagram';
    const numberId = getActiveNumberId();

    if (selectedMedia) {
      setIsUploading(true);
      const mediaUrl = await uploadMediaToStorage(selectedMedia.file);
      if (!mediaUrl) { setIsUploading(false); return; }

      let sendResult: { success: boolean; messageId?: string } = { success: false };
      if (useMessenger) {
        sendResult = await sendViaMessenger(selectedPhone, newMessage.trim() || '', messengerChannel, selectedMedia.type, mediaUrl);
      } else if (useMeta) {
        sendResult = await sendViaMeta(selectedPhone, newMessage.trim() || '', selectedMedia.type, mediaUrl, newMessage.trim() || undefined);
      } else {
        const result = await zapiSendMedia(selectedPhone, mediaUrl, selectedMedia.type, newMessage.trim() || undefined, numberId || undefined);
        sendResult = { success: result.success, messageId: undefined };
      }

      if (sendResult.success) {
        await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone,
          message: newMessage.trim() || `[${selectedMedia.type}]`,
          direction: 'outgoing',
          status: 'sent',
          media_type: selectedMedia.type,
          media_url: mediaUrl,
          whatsapp_number_id: numberId,
          message_id: sendResult.messageId || null,
          channel: useMessenger ? messengerChannel : null,
        } as any);
        loadMessages(selectedPhone, false, selectedConvNumberId);
      }
      URL.revokeObjectURL(selectedMedia.previewUrl);
      setSelectedMedia(null);
      setNewMessage("");
      setIsUploading(false);
      return;
    }

    if (!newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage("");
    setIsSending(true);

    let sendResult: { success: boolean; messageId?: string } = { success: false };
    if (useMessenger) {
      sendResult = await sendViaMessenger(selectedPhone, text, messengerChannel);
    } else if (useMeta) {
      sendResult = await sendViaMeta(selectedPhone, text);
    } else {
      const result = await zapiSend(selectedPhone, text, numberId || undefined);
      sendResult = { success: result.success, messageId: undefined };
    }

    if (sendResult.success) {
      await supabase.from('whatsapp_messages').insert({
        phone: selectedPhone,
        message: text,
        direction: 'outgoing',
        status: 'sent',
        whatsapp_number_id: numberId,
        message_id: sendResult.messageId || null,
        channel: useMessenger ? messengerChannel : null,
      } as any);
      loadMessages(selectedPhone, false, selectedConvNumberId);
    }
    setIsSending(false);
  };

  // ── Fetch Meta templates ──
  const fetchTemplates = async () => {
    setIsLoadingTemplates(true);
    try {
      const numberId = numberFilter !== 'all' ? numberFilter : selectedNumberId;
      const params = numberId ? `?whatsappNumberId=${numberId}` : '';
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-get-templates${params}`;
      const res = await fetch(url, {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
      });
      const result = await res.json();
      if (result.templates) {
        setTemplates(result.templates);
      } else {
        toast.error(result?.details?.error?.message || 'Erro ao buscar templates');
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
      toast.error('Erro ao buscar templates');
    }
    setIsLoadingTemplates(false);
  };

  const handleOpenTemplates = () => {
    setShowTemplateDialog(true);
    fetchTemplates();
  };

  // Extract parameter count from template body
  const getTemplateParamCount = (template: MetaTemplate): number => {
    const bodyComp = template.components.find(c => c.type === 'BODY');
    if (!bodyComp?.text) return 0;
    const matches = bodyComp.text.match(/\{\{\d+\}\}/g);
    return matches ? matches.length : 0;
  };

  const handleSelectTemplate = (template: MetaTemplate) => {
    const paramCount = getTemplateParamCount(template);
    if (paramCount > 0) {
      setSelectedTemplate(template);
      setTemplateParamValues(new Array(paramCount).fill(''));
    } else {
      handleSendTemplate(template, []);
    }
  };

  const handleSendTemplate = async (template: MetaTemplate, paramValues: string[]) => {
    if (!selectedPhone) return;
    setIsSending(true);
    setShowTemplateDialog(false);
    setSelectedTemplate(null);

    // Build components array with parameters
    const components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> = [];
    if (paramValues.length > 0) {
      components.push({
        type: 'body',
        parameters: paramValues.map(val => ({ type: 'text', text: val })),
      });
    }

    // Check for HEADER with IMAGE format
    const headerComp = template.components.find(c => c.type === 'HEADER');
    if (headerComp?.format === 'IMAGE' && headerComp.example?.header_handle?.[0]) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', link: headerComp.example.header_handle[0] } as any],
      });
    }

    try {
      const numberId = numberFilter !== 'all' ? numberFilter : selectedNumberId;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-send-template`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: selectedPhone,
          templateName: template.name,
          language: template.language,
          whatsappNumberId: numberId,
          components: components.length > 0 ? components : undefined,
        }),
      });

      const result = await res.json();
      if (result.success) {
        // Save to local messages
        const bodyComp = template.components.find(c => c.type === 'BODY');
        const bodyText = bodyComp?.text || `[Template: ${template.name}]`;
        await supabase.from('whatsapp_messages').insert({
          phone: selectedPhone.replace(/\D/g, '').startsWith('55') ? selectedPhone.replace(/\D/g, '') : '55' + selectedPhone.replace(/\D/g, ''),
          message: bodyText,
          direction: 'outgoing',
          status: 'sent',
          message_id: result.messageId,
          whatsapp_number_id: numberId || null,
        });
        toast.success('Template enviado!');
        loadMessages(selectedPhone, false, selectedConvNumberId);
      } else {
        toast.error(result.error || 'Erro ao enviar template');
      }
    } catch (err) {
      toast.error('Erro ao enviar template');
    }
    setIsSending(false);
  };

  // ── Filter conversations ──
  const STATUS_TABS: { value: string; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'not_started', label: 'Novas' },
    { value: 'awaiting_reply', label: 'Aguard.' },
    { value: 'awaiting_customer', label: 'Follow Up' },
    { value: 'dispatch', label: 'Disparos 📢' },
    { value: 'finished', label: 'Finalizadas' },
  ];

  const filteredConversations = conversations
    .filter(c => {
      if (chatFilter === 'contacts' && c.isGroup) return false;
      if (chatFilter === 'groups' && !c.isGroup) return false;
      return true;
    })
    .filter(c => {
      if (statusFilter === 'all') {
        // "Todas" hides finalizadas, arquivadas, and dispatch-only
        return !c.isFinished && !c.isArchived && !c.isDispatchOnly;
      }
      if (statusFilter === 'dispatch') return c.isDispatchOnly && !c.isArchived;
      if (statusFilter === 'finished') return c.isFinished && !c.isArchived;
      if (c.isFinished || c.isArchived || c.isDispatchOnly) return false;
      return c.conversationStatus === statusFilter;
    })
    .filter(c => {
      if (supportFilterActive) return hasActiveSupport(c.phone);
      return true;
    })
    .filter(c =>
      c.phone.includes(searchQuery) ||
      c.customerName?.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const selectedConv = conversations.find(c => c.conversationKey === selectedConvKey) || conversations.find(c => c.phone === selectedPhone);
  const contactsCount = conversations.filter(c => !c.isGroup).length;
  const groupsCount = conversations.filter(c => c.isGroup).length;

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
    t.components.some(c => c.text?.toLowerCase().includes(templateSearch.toLowerCase()))
  );

  return (
    <div className="h-screen flex flex-col bg-[#111b21]">
      {/* WhatsApp-style top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#202c33] border-b border-[#2a3942]">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="text-[#aebac1] hover:bg-[#2a3942]" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <MessageCircle className="h-5 w-5 text-[#00a884]" />
          <span className="text-[#e9edef] font-semibold text-lg">WhatsApp</span>
        </div>
        {/* Instance selector with "Todos" */}
        <Select value={numberFilter} onValueChange={setNumberFilter}>
          <SelectTrigger className="w-auto min-w-[200px] h-8 text-xs bg-[#2a3942] border-[#3b4a54] text-[#e9edef]">
            <Phone className="h-3.5 w-3.5 mr-2 text-[#00a884]" />
            <SelectValue placeholder="Filtrar número" />
          </SelectTrigger>
          <SelectContent className="bg-[#233138] border-[#3b4a54]">
            <SelectItem value="all" className="text-[#e9edef] focus:bg-[#2a3942] focus:text-[#e9edef]">
              <div className="flex items-center gap-2">
                <span className="font-medium">Todos os WhatsApps</span>
              </div>
            </SelectItem>
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
            {/* Status filter tabs */}
            <div className="flex gap-1 flex-wrap">
              {STATUS_TABS.map(tab => (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value as ConversationStatusFilter)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors",
                    statusFilter === tab.value
                      ? "bg-[#00a884] text-[#111b21]"
                      : "bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Support filter */}
            <button
              onClick={() => setSupportFilterActive(prev => !prev)}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[10px] font-medium transition-colors",
                supportFilterActive
                  ? "bg-orange-500/20 text-orange-400"
                  : "bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]"
              )}
            >
              🎧 Suporte Ativo
              {supportCount > 0 && (
                <span className="ml-auto text-[9px] opacity-80">({supportCount})</span>
              )}
            </button>
            {/* Chat type filter */}
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
            {/* New conversation button */}
            <div className="px-2 pb-2">
              <Button
                onClick={() => setShowNewChatDialog(true)}
                className="w-full bg-[#00a884] hover:bg-[#00a884]/90 text-[#111b21] h-9 text-sm font-medium gap-2"
              >
                <UserPlus className="h-4 w-4" />
                Nova conversa
              </Button>
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
                  key={conv.conversationKey || conv.phone}
                  onClick={() => handleSelectConversation(conv)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 hover:bg-[#202c33] transition-colors",
                    selectedConvKey === conv.conversationKey && "bg-[#2a3942]",
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
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        <span className="text-[#e9edef] font-medium text-[15px] truncate">
                          {conv.customerName || conv.phone}
                        </span>
                        {conv.channel === 'instagram' && (
                          <span className="text-[8px] px-1 py-0 rounded flex-shrink-0 font-medium bg-pink-500/20 text-pink-400">
                            📷 Instagram
                          </span>
                        )}
                        {conv.channel === 'messenger' && (
                          <span className="text-[8px] px-1 py-0 rounded flex-shrink-0 font-medium bg-blue-500/20 text-blue-400">
                            💬 Messenger
                          </span>
                        )}
                        {conv.instanceLabel && !conv.channel && (
                          <span className={cn(
                            "text-[8px] px-1 py-0 rounded flex-shrink-0 font-medium",
                            conv.whatsapp_number_id ? "bg-blue-500/20 text-blue-400" : "bg-green-500/20 text-green-400"
                          )}>
                            {conv.instanceLabel}
                          </span>
                        )}
                        {conv.hasOtherInstances && (
                          <span className="text-[8px] text-orange-400 flex-shrink-0">🔗</span>
                        )}
                      </div>
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
                  {editingName ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveContactName(selectedPhone!, editNameValue);
                          if (e.key === 'Escape') setEditingName(false);
                        }}
                        className="h-7 text-sm bg-[#2a3942] border-none text-[#e9edef] focus-visible:ring-0"
                        placeholder="Nome do contato"
                      />
                      <Button size="sm" variant="ghost" className="h-7 text-[#00a884] hover:bg-[#2a3942]" onClick={() => saveContactName(selectedPhone!, editNameValue)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[#aebac1] hover:bg-[#2a3942]" onClick={() => setEditingName(false)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <p className="text-[#e9edef] font-medium truncate">{selectedConv?.customerName || selectedPhone}</p>
                      {selectedConv?.instanceLabel && (
                        <span className="text-[9px] bg-[#2a3942] px-1.5 py-0.5 rounded text-[#00a884] font-medium flex-shrink-0">
                          {selectedConv.instanceLabel}
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setEditNameValue(selectedConv?.customerName || '');
                          setEditingName(true);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8696a0] hover:text-[#e9edef]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
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
                              {/* WhatsApp number indicator */}
                              {msg.whatsapp_number_id && (() => {
                                const num = numbers.find(n => n.id === msg.whatsapp_number_id);
                                return num ? (
                                  <p className="text-[10px] font-medium mb-0.5" style={{ color: msg.direction === 'outgoing' ? '#34d399' : '#60a5fa' }}>
                                    {num.label}
                                  </p>
                                ) : null;
                              })()}
                              <InstagramReferralCard referral={msg.referral} />
                              <MessageMedia msg={msg} />
                              {msg.message && <p className="whitespace-pre-wrap break-words pr-14 leading-[1.35]">{msg.message}</p>}
                              <div className="absolute bottom-1 right-2 flex items-center gap-1 text-[11px] text-[#ffffff99]">
                                <span>{isToday(new Date(msg.created_at)) ? format(new Date(msg.created_at), "HH:mm") : format(new Date(msg.created_at), "dd/MM HH:mm")}</span>
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
                      <DropdownMenuItem onClick={handleOpenTemplates} className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                        <FileText className="h-4 w-4 text-[#00a884]" /> Template Meta
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <EmojiPickerButton onEmojiSelect={(emoji) => setNewMessage(prev => prev + emoji)} />

                  <Input
                    ref={inputRef}
                    placeholder="Digite uma mensagem"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    className="flex-1 bg-[#2a3942] border-none text-[#e9edef] placeholder:text-[#8696a0] focus-visible:ring-0 h-10 rounded-lg"
                  />

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

      {/* New Chat Dialog */}
      <Dialog open={showNewChatDialog} onOpenChange={setShowNewChatDialog}>
        <DialogContent className="bg-[#202c33] border-[#3b4a54] text-[#e9edef] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#e9edef] flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-[#00a884]" />
              Nova conversa
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-[#8696a0] mb-1.5 block">Número de WhatsApp</label>
              <Input
                placeholder="Ex: 5511999999999"
                value={newChatPhone}
                onChange={(e) => setNewChatPhone(e.target.value.replace(/\D/g, ''))}
                className="bg-[#2a3942] border-none text-[#e9edef] placeholder:text-[#8696a0] h-11 text-base"
              />
              <p className="text-[10px] text-[#8696a0] mt-1">Digite o número com DDD e código do país (55 para Brasil)</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (!newChatPhone.trim()) { toast.error('Digite um número'); return; }
                  const phone = newChatPhone.startsWith('55') ? newChatPhone : '55' + newChatPhone;
                  setSelectedPhone(phone);
                  loadMessages(phone);
                  setShowNewChatDialog(false);
                  setNewChatPhone("");
                }}
                variant="outline"
                className="flex-1 border-[#3b4a54] text-[#e9edef] hover:bg-[#2a3942] h-10"
              >
                Abrir conversa
              </Button>
              <Button
                onClick={() => {
                  if (!newChatPhone.trim()) { toast.error('Digite um número'); return; }
                  const phone = newChatPhone.startsWith('55') ? newChatPhone : '55' + newChatPhone;
                  setSelectedPhone(phone);
                  loadMessages(phone);
                  setShowNewChatDialog(false);
                  setNewChatPhone("");
                  // Open templates after a short delay to let state update
                  setTimeout(() => handleOpenTemplates(), 300);
                }}
                className="flex-1 bg-[#00a884] hover:bg-[#00a884]/90 text-[#111b21] h-10 gap-2"
              >
                <FileText className="h-4 w-4" />
                Enviar Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="bg-[#202c33] border-[#3b4a54] text-[#e9edef] max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-[#e9edef] flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#00a884]" />
              Templates Meta aprovados
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Buscar template..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className="bg-[#2a3942] border-none text-[#e9edef] placeholder:text-[#8696a0]"
            />
            <ScrollArea className="max-h-[50vh]">
              {isLoadingTemplates ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredTemplates.length === 0 ? (
                <p className="text-center text-[#8696a0] py-8">Nenhum template encontrado</p>
              ) : (
                <div className="space-y-2">
                  {filteredTemplates.map((tmpl, idx) => {
                    const bodyComp = tmpl.components.find(c => c.type === 'BODY');
                    const headerComp = tmpl.components.find(c => c.type === 'HEADER');
                    return (
                      <button
                        key={`${tmpl.name}-${idx}`}
                        onClick={() => handleSelectTemplate(tmpl)}
                        className="w-full text-left p-3 rounded-lg bg-[#111b21] hover:bg-[#2a3942] transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm text-[#e9edef]">{tmpl.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#00a884]/20 text-[#00a884]">
                            {tmpl.category}
                          </span>
                        </div>
                        {headerComp?.text && (
                          <p className="text-xs text-[#00a884] mb-1 font-medium">{headerComp.text}</p>
                        )}
                        {bodyComp?.text && (
                          <p className="text-xs text-[#8696a0] line-clamp-3">{bodyComp.text}</p>
                        )}
                        <p className="text-[10px] text-[#8696a0] mt-1">Idioma: {tmpl.language}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template Params Dialog */}
      <Dialog open={!!selectedTemplate} onOpenChange={(open) => { if (!open) setSelectedTemplate(null); }}>
        <DialogContent className="bg-[#202c33] border-[#3b4a54] text-[#e9edef] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#e9edef]">
              Preencher parâmetros: {selectedTemplate?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedTemplate && (() => {
            const bodyComp = selectedTemplate.components.find(c => c.type === 'BODY');
            const previewText = bodyComp?.text?.replace(/\{\{(\d+)\}\}/g, (_, idx) => {
              const val = templateParamValues[parseInt(idx) - 1];
              return val || `{{${idx}}}`;
            }) || '';
            return (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-[#111b21] text-xs text-[#8696a0] whitespace-pre-wrap">
                  {previewText}
                </div>
                {templateParamValues.map((val, i) => (
                  <div key={i}>
                    <label className="text-xs text-[#8696a0] mb-1 block">
                      Parâmetro {`{{${i + 1}}}`}
                      {bodyComp?.example?.body_text?.[0]?.[i] && (
                        <span className="ml-2 text-[#00a884]">ex: {bodyComp.example.body_text[0][i]}</span>
                      )}
                    </label>
                    <Input
                      value={val}
                      onChange={(e) => {
                        const newVals = [...templateParamValues];
                        newVals[i] = e.target.value;
                        setTemplateParamValues(newVals);
                      }}
                      className="bg-[#2a3942] border-none text-[#e9edef] placeholder:text-[#8696a0]"
                      placeholder={bodyComp?.example?.body_text?.[0]?.[i] || `Valor do parâmetro ${i + 1}`}
                    />
                  </div>
                ))}
                <Button
                  onClick={() => handleSendTemplate(selectedTemplate, templateParamValues)}
                  disabled={templateParamValues.some(v => !v.trim()) || isSending}
                  className="w-full bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                >
                  {isSending ? 'Enviando...' : 'Enviar template'}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
