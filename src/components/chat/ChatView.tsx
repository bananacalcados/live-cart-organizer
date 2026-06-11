import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Send, Tag, X, Plus, Mic, Square, ChevronLeft, Image, Paperclip, PhoneOff, HeadphonesIcon, Trash2, Pencil, MoreVertical, Clock, Reply, Play, Pause, Ban, ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QuotedMessagePreview, QuotedMessageData } from "./QuotedMessagePreview";
import { QuotedMessageBubble } from "./QuotedMessageBubble";
import { useStatusQuotes } from "@/hooks/chat/useStatusQuotes";
import { StatusViewerDialog, StatusViewerData } from "./StatusViewerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { EmojiPickerButton } from "../EmojiPickerButton";
import { Message, Conversation } from "./ChatTypes";
import { supabase } from "@/integrations/supabase/client";
import { uploadMediaToStorage } from "../MediaAttachmentPicker";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { CreateSupportTicketDialog } from "../CreateSupportTicketDialog";
import { MessageStatusIcon } from "./MessageStatusIcon";
import { WhatsAppMediaAttachment } from "./WhatsAppMediaAttachment";
import { InstagramReferralCard } from "./InstagramReferralCard";
import { QuickReplyPicker } from "./QuickReplyPicker";
import { ScheduleMessageDialog } from "./ScheduleMessageDialog";
import { AiTransferBanner } from "./AiTransferBanner";
import { ChatExtraSender } from "./ChatExtraSender";
import { SpellSuggestionBar } from "./SpellSuggestionBar";
import { ComposerRuleBar } from "./ComposerRuleBar";
import { useSpellAssist } from "@/hooks/useSpellAssist";
import { useComposerNudges } from "@/hooks/useComposerNudges";
import { capitalizeSentences } from "@/lib/spellAssist/capitalize";
import { applySuggestion } from "@/lib/spellAssist/dictionary";

/** Format a raw BR phone (digits only) for friendly display in group sender labels. */
function formatPhoneDisplay(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (!d) return raw;
  // 55 + DDD(2) + number(8/9)
  const local = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d;
}


interface ChatViewProps {
  messages: Message[];
  conversation: Conversation | null;
  newMessage: string;
  onNewMessageChange: (message: string) => void;
  onSendMessage: () => void;
  onSendAudio?: (audioUrl: string) => void;
  onSendMedia?: (mediaUrl: string, mediaType: string, caption?: string) => void;
  onDeleteMessage?: (msg: Message) => Promise<void>;
  onEditMessage?: (msg: Message, newText: string) => Promise<void>;
  onBack?: () => void;
  onFinish?: () => void;
  isSending: boolean;
  customerInfoPanel?: React.ReactNode;
  quotedMessage?: QuotedMessageData | null;
  onQuoteMessage?: (data: QuotedMessageData) => void;
  onCancelQuote?: () => void;
  /** Recarrega o histórico após envio de contato/localização/enquete (WaSender). */
  onExtraSent?: () => void;
  /** Esconde a barra de tags interna (quando o cabeçalho externo já gerencia tags). */
  hideTagsBar?: boolean;
}

const PREDEFINED_TAGS = [
  "VIP", "Novo", "Recorrente", "Atacado", "Influencer", "Problemático"
];

function getDateLabel(date: Date): string {
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  return format(date, "EEEE, d 'de' MMMM", { locale: ptBR });
}

export function ChatView({
  messages,
  conversation,
  newMessage,
  onNewMessageChange,
  onSendMessage,
  onSendAudio,
  onSendMedia,
  onDeleteMessage,
  onEditMessage,
  onBack,
  onFinish,
  isSending,
  customerInfoPanel,
  quotedMessage,
  onQuoteMessage,
  onCancelQuote,
  onExtraSent,
}: ChatViewProps) {
  const { suggestions: spellSuggestions, dismiss: dismissSpell, addToDictionary: addSpellWord } =
    useSpellAssist(newMessage);
  const { nudges: composerNudges, dismiss: dismissNudge } = useComposerNudges(newMessage, {
    isFinished: conversation?.isFinished,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newTag, setNewTag] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const recordingMimeRef = useRef<string>("");
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const audioPreviewBlobRef = useRef<Blob | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [audioPreviewPlaying, setAudioPreviewPlaying] = useState(false);
  const [sendingAudio, setSendingAudio] = useState(false);
  const [contactTags, setContactTags] = useState<string[]>([]);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});

  // Miniaturas de STATUS citados (status não pertence à conversa, lookup global).
  const statusQuotes = useStatusQuotes(messages as any);
  const [statusViewer, setStatusViewer] = useState<StatusViewerData | null>(null);



  // ---- Bloqueio nativo de contato (Z-API / WaSender / Meta) ----
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);

  /** Instância vinculada à conversa: usa a da conversa ou a última mensagem trocada. */
  const blockNumberId = useMemo(() => {
    if (conversation?.whatsapp_number_id) return conversation.whatsapp_number_id;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.whatsapp_number_id) return messages[i].whatsapp_number_id as string;
    }
    return null;
  }, [conversation?.whatsapp_number_id, messages]);

  // Carrega o estado de bloqueio ao abrir a conversa
  useEffect(() => {
    let cancelled = false;
    const phone = conversation?.phone;
    if (!phone || conversation?.isGroup) {
      setIsBlocked(false);
      return;
    }
    (async () => {
      let digits = phone.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 11) digits = "55" + digits;
      let query = supabase.from("blocked_contacts").select("id").eq("phone", digits);
      if (blockNumberId) query = query.eq("whatsapp_number_id", blockNumberId);
      const { data } = await query.limit(1);
      if (!cancelled) setIsBlocked((data?.length ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation?.phone, conversation?.isGroup, blockNumberId]);

  const handleToggleBlock = useCallback(async () => {
    const phone = conversation?.phone;
    if (!phone) return;
    if (!blockNumberId) {
      toast.error("Não foi possível identificar a instância desta conversa para bloquear.");
      return;
    }
    const action = isBlocked ? "unblock" : "block";
    setBlockLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("whatsapp-block-contact", {
        body: {
          phone,
          whatsapp_number_id: blockNumberId,
          action,
          blocked_by: userData?.user?.id ?? null,
        },
      });
      if (error) throw error;
      if (data?.success === false || data?.error) throw new Error(data?.error || "Falha no bloqueio");
      setIsBlocked(action === "block");
      toast.success(action === "block" ? "Contato bloqueado no WhatsApp" : "Contato desbloqueado");
    } catch (err) {
      console.error("[ChatView] toggle block failed:", err);
      toast.error(
        `Não foi possível ${action === "block" ? "bloquear" : "desbloquear"} o contato. ${
          err instanceof Error ? err.message : ""
        }`,
      );
    } finally {
      setBlockLoading(false);
      setShowBlockConfirm(false);
    }
  }, [conversation?.phone, blockNumberId, isBlocked]);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load profiles for sender names
  useEffect(() => {
    const loadProfiles = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name');
      if (data) {
        const map: Record<string, string> = {};
        for (const p of data) {
          if (p.user_id && p.display_name) map[p.user_id] = p.display_name;
        }
        setProfilesMap(map);
      }
    };
    loadProfiles();
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const element = document.getElementById(`msg-${messageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('bg-[#2a3942]/50');
      setTimeout(() => element.classList.remove('bg-[#2a3942]/50'), 2000);
    }
  }, []);

  const handleReplyToMsg = useCallback((msg: Message) => {
    if (!onQuoteMessage) return;
    onQuoteMessage({
      message_id: msg.message_id || '',
      message: msg.message || '',
      sender_name: (msg as any).sender_name || undefined,
      direction: msg.direction,
      media_type: msg.media_type || undefined,
    });
  }, [onQuoteMessage]);

  const handleTouchStart = useCallback((msg: Message) => {
    if (!onQuoteMessage) return;
    const timer = setTimeout(() => handleReplyToMsg(msg), 500);
    longPressTimerRef.current = timer;
  }, [onQuoteMessage, handleReplyToMsg]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Auto-scroll to the latest message. Quando troca de conversa rola instantâneo
  // (para já abrir na mensagem mais recente), e em novas mensagens rola suave.
  const conversationScrollKey = `${conversation?.phone ?? ''}|${conversation?.whatsapp_number_id ?? ''}`;
  const prevScrollKeyRef = useRef(conversationScrollKey);

  useEffect(() => {
    if (messages.length === 0) return;
    const isNewConversation = prevScrollKeyRef.current !== conversationScrollKey;
    prevScrollKeyRef.current = conversationScrollKey;
    const behavior: ScrollBehavior = isNewConversation ? 'auto' : 'smooth';
    // Dois rAF garantem que o layout/imagens já posicionaram antes de rolar.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      });
    });
  }, [messages, conversationScrollKey]);

  // Load tags from chat_contacts when conversation changes
  useEffect(() => {
    if (!conversation?.phone || conversation.isGroup) {
      setContactTags([]);
      return;
    }
    const loadTags = async () => {
      const { data } = await supabase
        .from('chat_contacts')
        .select('tags')
        .eq('phone', conversation.phone)
        .maybeSingle();
      setContactTags((data as any)?.tags || []);
    };
    loadTags();
  }, [conversation?.phone]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const formatMessageTime = (date: Date) => {
    return format(date, 'HH:mm', { locale: ptBR });
  };

  const formatRecordingTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const customerTags = contactTags;

  const handleAddTag = async (tag: string) => {
    if (!conversation?.phone || !tag.trim()) return;
    const trimmed = tag.trim();
    if (customerTags.includes(trimmed)) return;
    const newTags = [...customerTags, trimmed];
    setContactTags(newTags);
    setNewTag("");
    
    try {
      const { error } = await supabase
        .from('chat_contacts')
        .upsert(
          { phone: conversation.phone, tags: newTags, updated_at: new Date().toISOString() },
          { onConflict: 'phone', ignoreDuplicates: false }
        );
      if (error) {
        console.error('Erro ao salvar tag:', error);
        toast.error('Erro ao salvar tag');
        // Revert optimistic update
        setContactTags(customerTags.filter(t => t !== trimmed));
      }
    } catch (err) {
      console.error('Erro ao salvar tag:', err);
      toast.error('Erro ao salvar tag');
      setContactTags(customerTags.filter(t => t !== trimmed));
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!conversation?.phone) return;
    const newTags = customerTags.filter(t => t !== tag);
    setContactTags(newTags);
    try {
      const { error } = await supabase
        .from('chat_contacts')
        .update({ tags: newTags, updated_at: new Date().toISOString() })
        .eq('phone', conversation.phone);
      if (error) {
        console.error('Erro ao remover tag:', error);
        toast.error('Erro ao remover tag');
        setContactTags([...newTags, tag]);
      }
    } catch (err) {
      console.error('Erro ao remover tag:', err);
      setContactTags([...newTags, tag]);
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const { getAudioMimeType } = await import('@/lib/audioRecorder');
      const mimeType = getAudioMimeType();
      recordingMimeRef.current = mimeType;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      cancelledRef.current = false;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const wasCancelled = cancelledRef.current;
        setIsRecording(false);
        setRecordingTime(0);

        if (wasCancelled) {
          audioChunksRef.current = [];
          return;
        }

        const { getAudioContentType } = await import('@/lib/audioRecorder');
        const ct = getAudioContentType(recordingMimeRef.current);
        const audioBlob = new Blob(audioChunksRef.current, { type: ct });
        if (audioBlob.size === 0) return;

        audioPreviewBlobRef.current = audioBlob;
        const url = URL.createObjectURL(audioBlob);
        setAudioPreviewUrl(url);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast.error('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      cancelledRef.current = false;
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      cancelledRef.current = true;
      audioChunksRef.current = [];
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const discardAudioPreview = useCallback(() => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    audioPreviewBlobRef.current = null;
    setAudioPreviewUrl(null);
    setAudioPreviewPlaying(false);
  }, [audioPreviewUrl]);

  const toggleAudioPreviewPlay = useCallback(() => {
    if (!audioPreviewRef.current) return;
    if (audioPreviewPlaying) {
      audioPreviewRef.current.pause();
      setAudioPreviewPlaying(false);
    } else {
      audioPreviewRef.current.play();
      setAudioPreviewPlaying(true);
    }
  }, [audioPreviewPlaying]);

  const sendAudioPreview = useCallback(async () => {
    const blob = audioPreviewBlobRef.current;
    if (!blob || !onSendAudio) return;
    setSendingAudio(true);
    try {
      const { getAudioExtension, getAudioContentType } = await import('@/lib/audioRecorder');
      const mime = recordingMimeRef.current;
      const ct = getAudioContentType(mime);
      const ext = getAudioExtension(mime);
      const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: ct });
      const url = await uploadMediaToStorage(file);
      if (url) {
        onSendAudio(url);
        discardAudioPreview();
      } else {
        toast.error('Erro ao enviar áudio');
      }
    } finally {
      setSendingAudio(false);
    }
  }, [onSendAudio, discardAudioPreview]);

  const formatPreviewTime = formatRecordingTime;

  const [pendingMediaFile, setPendingMediaFile] = useState<File | null>(null);
  const [pendingMediaPreviewUrl, setPendingMediaPreviewUrl] = useState<string | null>(null);
  const [pendingMediaCaption, setPendingMediaCaption] = useState("");
  const [sendingMedia, setSendingMedia] = useState(false);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onSendMedia) return;
    event.target.value = '';

    const { getMaxSizeForType, getMaxSizeLabel, getMediaTypeLabel } = await import('@/constants/mediaLimits');
    if (file.size > getMaxSizeForType(file.type)) {
      toast.error(`${getMediaTypeLabel(file.type)} muito grande. O limite é ${getMaxSizeLabel(file.type)}.`);
      return;
    }

    setPendingMediaFile(file);
    setPendingMediaPreviewUrl(URL.createObjectURL(file));
    setPendingMediaCaption("");
  }, [onSendMedia]);

  const cancelPendingMedia = useCallback(() => {
    if (pendingMediaPreviewUrl) URL.revokeObjectURL(pendingMediaPreviewUrl);
    setPendingMediaPreviewUrl(null);
    setPendingMediaFile(null);
    setPendingMediaCaption("");
  }, [pendingMediaPreviewUrl]);

  const confirmSendPendingMedia = useCallback(async () => {
    if (!pendingMediaFile || !onSendMedia) return;
    const file = pendingMediaFile;
    const caption = pendingMediaCaption.trim();
    setSendingMedia(true);
    try {
      const mediaType = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('video/') ? 'video'
        : file.type.startsWith('audio/') ? 'audio' : 'document';
      const url = await uploadMediaToStorage(file);
      if (url) {
        onSendMedia(url, mediaType, caption || undefined);
        cancelPendingMedia();
      } else {
        toast.error('Erro ao enviar arquivo');
      }
    } finally {
      setSendingMedia(false);
    }
  }, [pendingMediaFile, pendingMediaCaption, onSendMedia, cancelPendingMedia]);

  // Helper to check if sender changed from previous message
  const isSenderChange = useCallback((msg: Message, prevMsg: Message | null): boolean => {
    if (!prevMsg) return true;
    if (msg.direction !== prevMsg.direction) return true;
    if (msg.direction === 'outgoing') {
      return (msg as any).sender_user_id !== (prevMsg as any).sender_user_id;
    }
    // Incoming: in groups, different participants must be distinguished
    return ((msg as any).sender_name || '') !== ((prevMsg as any).sender_name || '')
      || ((msg as any).sender_phone || '') !== ((prevMsg as any).sender_phone || '');
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      {/* Back button bar */}
      {onBack && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-7 px-2 text-xs gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </Button>
          {conversation && (
            <span className="text-xs text-muted-foreground truncate flex-1">
              {conversation.customerName || conversation.phone}
            </span>
          )}
          <CreateSupportTicketDialog
            phone={conversation?.phone}
            customerName={conversation?.customerName}
          />
          {onFinish && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onFinish}
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              Finalizar
            </Button>
          )}
          {conversation && !conversation.isGroup && (
            <Button
              variant="ghost"
              size="sm"
              disabled={blockLoading}
              onClick={() => (isBlocked ? handleToggleBlock() : setShowBlockConfirm(true))}
              className={cn(
                "h-7 px-2 text-xs gap-1",
                isBlocked
                  ? "text-emerald-600 hover:text-emerald-700"
                  : "text-muted-foreground hover:text-destructive",
              )}
              title={isBlocked ? "Desbloquear contato no WhatsApp" : "Bloquear contato no WhatsApp"}
            >
              {isBlocked ? (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Desbloquear
                </>
              ) : (
                <>
                  <Ban className="h-3.5 w-3.5" />
                  Bloquear
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Tags bar */}
      {conversation && !conversation.isGroup && (
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center gap-2 flex-wrap flex-shrink-0">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {/* Event tags */}
          {conversation.eventNames?.map(name => (
            <Badge key={`event-${name}`} variant="default" className="text-[10px] gap-1 bg-primary/80">
              📌 {name}
            </Badge>
          ))}
          {customerTags.map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1">
              {tag}
              <button onClick={() => handleRemoveTag(tag)} className="hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Tag
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start">
              <div className="space-y-2">
                <div className="flex gap-1">
                  <Input
                    placeholder="Nova tag..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    className="h-7 text-xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag(newTag)}
                  />
                  <Button size="sm" className="h-7" onClick={() => handleAddTag(newTag)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {PREDEFINED_TAGS.filter(t => !customerTags.includes(t)).map(tag => (
                    <Badge 
                      key={tag} 
                      variant="outline" 
                      className="text-xs cursor-pointer hover:bg-secondary"
                      onClick={() => handleAddTag(tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* AI Transfer banner */}
      {conversation && !conversation.isGroup && (
        <AiTransferBanner phone={conversation.phone} />
      )}

      {/* Customer Info Panel */}
      {customerInfoPanel}

      {/* Messages */}
      <ScrollArea
        className="flex-1 bg-[#d9d2c4] dark:bg-[#0b141a]"
        style={{
          minHeight: 0,
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'><g fill='none' stroke='%23000' stroke-opacity='0.07' stroke-width='1.2'><circle cx='30' cy='40' r='10'/><path d='M70 30 q10 -10 20 0 t20 0'/><path d='M150 25 l8 0 l4 8 l-4 8 l-8 0 l-4 -8 z'/><path d='M180 60 q8 8 0 16 q-8 -8 0 -16'/><circle cx='40' cy='110' r='6'/><path d='M85 100 l14 0 l-7 12 z'/><path d='M130 95 q12 8 0 20'/><path d='M175 110 l10 -10 l10 10 l-10 10 z'/><circle cx='30' cy='180' r='8'/><path d='M70 175 q10 10 20 0'/><path d='M125 175 l14 0 l-7 14 z'/><path d='M170 170 q10 10 0 20 q-10 -10 0 -20'/></g></svg>\")",
          backgroundRepeat: "repeat",
          backgroundSize: "220px 220px",
        }}
      >
        <div className="p-3 w-full max-w-full overflow-hidden">
          {messages.map((msg, idx) => {
            const isOutgoing = msg.direction === 'outgoing';
            // Delete is always available for outgoing msgs (with fallback to local DB removal when Z-API can't)
            // Block only error/failed states; allow sent, delivered, read, played, pending, undefined, etc.
            const canDelete = isOutgoing && !!onDeleteMessage && msg.status !== 'error' && msg.status !== 'failed';
            const canEdit = isOutgoing && msg.message_id && onEditMessage && msg.media_type === 'text' && (msg.status === 'sent' || msg.status === 'delivered');
            const isEditing = editingMsgId === msg.id;
            const msgAge = Date.now() - new Date(msg.created_at).getTime();
            // Edit window stays 15min (WhatsApp limit). Delete is always allowed (falls back to local removal).
            const withinEditWindow = msgAge < 15 * 60 * 1000;
            // Delete-for-everyone WhatsApp window is ~7min. After that, only local removal works.
            const withinWhatsAppDeleteWindow = !!msg.message_id && msgAge < 7 * 60 * 1000;

            const quotedMsgId = (msg as any).quoted_message_id;
            const quotedOriginal = quotedMsgId ? messages.find(m => m.message_id === quotedMsgId) : null;
            const quotedStatus = quotedMsgId && !quotedOriginal ? statusQuotes[quotedMsgId] : null;

            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const msgDate = new Date(msg.created_at);
            const prevDate = prevMsg ? new Date(prevMsg.created_at) : null;
            const showDateSeparator = !prevDate || !isSameDay(msgDate, prevDate);
            const showSenderName = isSenderChange(msg, prevMsg) || showDateSeparator;

            // Determine spacing
            const sameDirection = prevMsg && msg.direction === prevMsg.direction && !showDateSeparator;

            // Sender name resolution
            let senderLabel: string | null = null;
            if (showSenderName) {
              if (isOutgoing) {
                const isAuto = msg.message?.startsWith('[AUTO] ');
                const msgSenderName = (msg as any).sender_name;
                const suid = (msg as any).sender_user_id;
                // Prioritize sender_name (set by POS with seller name) over profilesMap lookup
                senderLabel = msgSenderName || (suid ? (profilesMap[suid] || 'Atendente') : (isAuto ? 'Auto' : 'Sistema'));
              } else if (conversation?.isGroup) {
                // In groups, always show who is talking: name + phone when available
                const gName = (msg as any).sender_name || null;
                const gPhone = (msg as any).sender_phone || null;
                if (gName && gPhone) senderLabel = `${gName} • ${formatPhoneDisplay(gPhone)}`;
                else senderLabel = gName || (gPhone ? formatPhoneDisplay(gPhone) : 'Participante');
              } else {
                senderLabel = (msg as any).sender_name || conversation?.customerName || msg.phone || null;
              }
            }

            return (
            <div key={msg.id}>
              {/* Date separator */}
              {showDateSeparator && (
                <div className="flex items-center justify-center my-3">
                  <span className="bg-[#1a2228] text-[#8696a0] text-[11px] px-3 py-1 rounded-full">
                    {getDateLabel(msgDate)}
                  </span>
                </div>
              )}
              <div
                id={`msg-${msg.message_id}`}
                className={cn(
                  "flex group transition-colors duration-500",
                  isOutgoing ? 'justify-end' : 'justify-start',
                  sameDirection ? 'mt-[2px]' : 'mt-2'
                )}
                onTouchStart={() => handleTouchStart(msg)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
              >
                <div className={cn("relative max-w-[85%] sm:max-w-[75%]", isOutgoing && "flex items-start gap-1")}>
                  {/* Reply button (hover, desktop) */}
                  {onQuoteMessage && msg.message_id && (
                    <button
                      className={cn(
                        "opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10 mt-1 shrink-0",
                        isOutgoing ? "order-first" : "order-last"
                      )}
                      onClick={() => handleReplyToMsg(msg)}
                      title="Responder"
                    >
                      <Reply className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                  {/* Dropdown menu for outgoing messages */}
                  {isOutgoing && (canDelete || (canEdit && withinEditWindow)) && !isEditing && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="opacity-60 hover:opacity-100 transition-opacity h-7 w-7 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/15 dark:bg-white/10 dark:hover:bg-white/20 mt-1 shrink-0">
                          <MoreVertical className="h-4 w-4 text-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        {canEdit && withinEditWindow && (
                          <DropdownMenuItem
                            onClick={() => { setEditingMsgId(msg.id); setEditingText(msg.message || ''); }}
                            className="gap-2 text-xs"
                          >
                            <Pencil className="h-3 w-3" /> Editar
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem
                            onClick={async () => {
                              const confirmMsg = withinWhatsAppDeleteWindow
                                ? 'Apagar para todos? A mensagem será removida também do WhatsApp do cliente.'
                                : 'Esta mensagem só pode ser apagada do seu sistema (passou do prazo de ~7min do WhatsApp). O cliente continuará vendo no celular dele. Continuar?';
                              if (!confirm(confirmMsg)) return;
                              setActionLoading(true);
                              try {
                                await onDeleteMessage!(msg);
                              } catch {
                                toast.error('Erro ao apagar mensagem');
                              } finally {
                                setActionLoading(false);
                              }
                            }}
                            className="gap-2 text-xs text-destructive flex-col items-start"
                          >
                            <div className="flex items-center gap-2">
                              <Trash2 className="h-3 w-3" />
                              <span>{withinWhatsAppDeleteWindow ? 'Apagar para todos' : 'Apagar só pra mim'}</span>
                            </div>
                            {!withinWhatsAppDeleteWindow && (
                              <span className="text-[10px] text-muted-foreground font-normal pl-5">
                                Prazo de ~7min expirou
                              </span>
                            )}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {(() => {
                    const isAuto = msg.message?.startsWith('[AUTO] ');
                    const displayMsg = isAuto ? msg.message.replace(/^\[AUTO\] /, '') : msg.message;
                    return (
                  <div
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-sm overflow-hidden",
                      isOutgoing
                        ? 'bg-[#dcf8c6] dark:bg-[#005c4b] text-foreground'
                        : 'bg-white dark:bg-[#202c33] text-foreground',
                      isAuto && 'opacity-80 border border-dashed border-[#2a3942]'
                    )}
                  >
                    {/* Sender name */}
                    {showSenderName && senderLabel && (
                      <p className={cn(
                        "text-[11px] font-medium mb-0.5",
                        isOutgoing ? 'text-[#7c57d1]' : 'text-[#00a884]'
                      )}>
                        {senderLabel}
                      </p>
                    )}
                    {isAuto && (
                      <p className="text-amber-400 text-[10px] mb-0.5">🤖 Automática</p>
                    )}
                    {quotedOriginal && (
                      <QuotedMessageBubble
                        originalMessage={quotedOriginal.message}
                        originalDirection={quotedOriginal.direction}
                        originalSenderName={(quotedOriginal as any).sender_name}
                        originalMediaType={quotedOriginal.media_type}
                        contactName={conversation?.customerName}
                        onClick={() => scrollToMessage(quotedOriginal.message_id || '')}
                      />
                    )}
                    {quotedStatus && (
                      <QuotedMessageBubble
                        isStatus
                        originalMessage={quotedStatus.caption || quotedStatus.text_content}
                        originalMediaType={quotedStatus.type}
                        thumbnailUrl={quotedStatus.media_url}
                        onClick={() =>
                          setStatusViewer({
                            type: quotedStatus.type,
                            mediaUrl: quotedStatus.media_url,
                            caption: quotedStatus.caption || quotedStatus.text_content,
                          })
                        }
                      />
                    )}
                    <InstagramReferralCard referral={msg.referral} />
                    <WhatsAppMediaAttachment
                      mediaUrl={msg.media_url}
                      mediaType={msg.media_type}
                      message={msg.message}
                      direction={msg.direction}
                      imageClassName="max-w-[200px] max-h-[200px] rounded mb-1 object-cover cursor-pointer"
                      videoClassName="max-w-full rounded mb-1"
                      videoStyle={{ maxHeight: 200 }}
                      audioClassName="w-full mb-1"
                      pdfClassName="w-full h-64 rounded-md border border-border bg-background mb-2"
                    />
                    {isEditing ? (
                      <div className="space-y-1">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="w-full bg-white/80 dark:bg-black/20 rounded border border-input px-2 py-1 text-sm resize-none min-h-[40px]"
                          autoFocus
                          rows={2}
                        />
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditingMsgId(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-6 px-2 text-xs bg-[#00a884] hover:bg-[#00a884]/90 text-white"
                            disabled={actionLoading || !editingText.trim()}
                            onClick={async () => {
                              setActionLoading(true);
                              try {
                                await onEditMessage!(msg, editingText.trim());
                                setEditingMsgId(null);
                                toast.success('Mensagem editada!');
                              } catch {
                                toast.error('Erro ao editar mensagem');
                              } finally {
                                setActionLoading(false);
                              }
                            }}
                          >
                            Salvar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      displayMsg && <p className="whitespace-pre-wrap break-words overflow-wrap-anywhere" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{displayMsg}</p>
                    )}
                    {msg.status === 'failed' && (msg as any).error_message && (
                      <div className="mt-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 rounded text-[10px] text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                        ⚠️ {(msg as any).error_message}
                      </div>
                    )}
                    {msg.status === 'failed' && !(msg as any).error_message && (
                      <div className="mt-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 rounded text-[10px] text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                        ⚠️ Mensagem não entregue
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground text-right mt-0.5 flex items-center justify-end gap-0.5">
                      {formatMessageTime(new Date(msg.created_at))}
                      {isOutgoing && <MessageStatusIcon status={msg.status} />}
                    </p>
                  </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Quoted message preview */}
      {quotedMessage && onCancelQuote && (
        <QuotedMessagePreview
          quoted={quotedMessage}
          contactName={conversation?.customerName}
          onCancel={onCancelQuote}
        />
      )}

      <ComposerRuleBar nudges={composerNudges} onDismiss={dismissNudge} />

      <SpellSuggestionBar
        suggestions={spellSuggestions}
        onApply={(m, replacement) => onNewMessageChange(applySuggestion(newMessage, m, replacement))}
        onDismiss={dismissSpell}
        onAddToDictionary={addSpellWord}
      />

      {/* Input */}
      <div className="p-2 border-t bg-[#f0f0f0] dark:bg-[#202c33] flex items-center gap-2 flex-shrink-0">
        {audioPreviewUrl ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              onClick={discardAudioPreview}
              className="h-10 w-10 text-destructive"
              disabled={sendingAudio}
              title="Descartar áudio"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={toggleAudioPreviewPlay}
              className="h-10 w-10"
              title={audioPreviewPlaying ? "Pausar" : "Ouvir"}
            >
              {audioPreviewPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <audio
              ref={audioPreviewRef}
              src={audioPreviewUrl}
              onEnded={() => setAudioPreviewPlaying(false)}
              className="hidden"
            />
            <div className="flex-1 text-xs text-muted-foreground">
              Áudio pronto — ouça antes de enviar
            </div>
            <Button
              size="icon"
              onClick={sendAudioPreview}
              disabled={sendingAudio}
              className="h-10 w-10 bg-stage-paid hover:bg-stage-paid/90"
              title="Enviar áudio"
            >
              <Send className="h-4 w-4" />
            </Button>
          </>
        ) : isRecording ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              onClick={cancelRecording}
              className="h-10 w-10 text-destructive"
              title="Cancelar gravação"
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="flex-1 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
              <span className="text-sm font-medium text-destructive">
                {formatRecordingTime(recordingTime)}
              </span>
              <span className="text-xs text-muted-foreground">Gravando...</span>
            </div>
            <Button
              size="icon"
              onClick={stopRecording}
              className="h-10 w-10 bg-stage-paid hover:bg-stage-paid/90"
              title="Parar e ouvir"
            >
              <Square className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <QuickReplyPicker onSelect={(text) => onNewMessageChange(text)} />
            <EmojiPickerButton 
              onEmojiSelect={(emoji) => onNewMessageChange(newMessage + emoji)} 
            />
            {onSendMedia && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10">
                    <Paperclip className="h-5 w-5 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start" side="top">
                  <div className="flex gap-1">
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                    <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => imageInputRef.current?.click()}>
                      <Image className="h-4 w-4" /> Foto
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => videoInputRef.current?.click()}>
                      <Image className="h-4 w-4" /> Vídeo
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => fileInputRef.current?.click()}>
                      <Paperclip className="h-4 w-4" /> Arquivo
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {conversation && (
              <ChatExtraSender
                phone={conversation.phone}
                whatsappNumberId={conversation.whatsapp_number_id}
                onSent={onExtraSent}
              />
            )}
            <textarea
              placeholder="Digite uma mensagem..."
              value={newMessage}
              onChange={(e) => onNewMessageChange(capitalizeSentences(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSendMessage();
                }
              }}
              rows={1}
              className="flex-1 bg-white dark:bg-[#2a3942] rounded-md border border-input px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none min-h-[40px] max-h-[120px] overflow-y-auto"
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 120) + 'px';
              }}
            />
            {newMessage.trim() ? (
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 shrink-0"
                  title="Agendar mensagem"
                  onClick={() => setShowScheduleDialog(true)}
                >
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button
                  size="icon"
                  onClick={onSendMessage}
                  disabled={isSending}
                  className="bg-stage-paid hover:bg-stage-paid/90"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                size="icon"
                onClick={startRecording}
                variant="ghost"
                className="h-10 w-10"
              >
                <Mic className="h-5 w-5 text-muted-foreground" />
              </Button>
            )}
          </>
        )}
      </div>
      {conversation && (
        <ScheduleMessageDialog
          open={showScheduleDialog}
          onOpenChange={setShowScheduleDialog}
          phone={conversation.phone}
          message={newMessage}
          whatsappNumberId={conversation.whatsapp_number_id}
          onScheduled={() => onNewMessageChange("")}
        />
      )}

      <Dialog open={!!pendingMediaPreviewUrl} onOpenChange={(o) => { if (!o && !sendingMedia) cancelPendingMedia(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar envio</DialogTitle>
          </DialogHeader>
          {pendingMediaFile && pendingMediaPreviewUrl && (
            <div className="space-y-3">
              {pendingMediaFile.type.startsWith('image/') ? (
                <img src={pendingMediaPreviewUrl} alt="Preview" className="max-h-80 w-full object-contain rounded border" />
              ) : pendingMediaFile.type.startsWith('video/') ? (
                <video src={pendingMediaPreviewUrl} controls className="max-h-80 w-full rounded border" />
              ) : pendingMediaFile.type.startsWith('audio/') ? (
                <audio src={pendingMediaPreviewUrl} controls className="w-full" />
              ) : (
                <div className="p-4 border rounded text-sm text-muted-foreground">
                  📎 {pendingMediaFile.name} ({(pendingMediaFile.size / 1024).toFixed(0)} KB)
                </div>
              )}
              <Textarea
                placeholder="Adicionar uma legenda (opcional)..."
                value={pendingMediaCaption}
                onChange={(e) => setPendingMediaCaption(e.target.value)}
                rows={2}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={cancelPendingMedia} disabled={sendingMedia}>
              Cancelar
            </Button>
            <Button onClick={confirmSendPendingMedia} disabled={sendingMedia} className="bg-stage-paid hover:bg-stage-paid/90">
              <Send className="h-4 w-4 mr-2" />
              {sendingMedia ? 'Enviando...' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showBlockConfirm} onOpenChange={setShowBlockConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bloquear contato no WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso aciona o bloqueio nativo do WhatsApp para{" "}
              <strong>{conversation?.customerName || conversation?.phone}</strong>. Você não
              conseguirá mais enviar nem receber mensagens dessa pessoa nesta instância até
              desbloqueá-la.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={blockLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleToggleBlock();
              }}
              disabled={blockLoading}
              className="bg-destructive hover:bg-destructive/90"
            >
              {blockLoading ? "Bloqueando..." : "Bloquear"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StatusViewerDialog data={statusViewer} onOpenChange={(o) => !o && setStatusViewer(null)} />
    </div>
  );
}
