import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Tag, X, Plus, Mic, Square, ChevronLeft, Image, Paperclip, PhoneOff, HeadphonesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { EmojiPickerButton } from "../EmojiPickerButton";
import { Message, Conversation } from "./ChatTypes";
import { supabase } from "@/integrations/supabase/client";
import { uploadMediaToStorage } from "../MediaAttachmentPicker";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CreateSupportTicketDialog } from "../CreateSupportTicketDialog";
import { MessageStatusIcon } from "./MessageStatusIcon";

interface ChatViewProps {
  messages: Message[];
  conversation: Conversation | null;
  newMessage: string;
  onNewMessageChange: (message: string) => void;
  onSendMessage: () => void;
  onSendAudio?: (audioUrl: string) => void;
  onSendMedia?: (mediaUrl: string, mediaType: string, caption?: string) => void;
  onBack?: () => void;
  onFinish?: () => void;
  isSending: boolean;
  customerInfoPanel?: React.ReactNode;
}

const PREDEFINED_TAGS = [
  "VIP", "Novo", "Recorrente", "Atacado", "Influencer", "Problemático"
];

export function ChatView({
  messages,
  conversation,
  newMessage,
  onNewMessageChange,
  onSendMessage,
  onSendAudio,
  onSendMedia,
  onBack,
  onFinish,
  isSending,
  customerInfoPanel,
}: ChatViewProps) {
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
  const [contactTags, setContactTags] = useState<string[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    await supabase
      .from('chat_contacts')
      .upsert(
        { phone: conversation.phone, tags: newTags },
        { onConflict: 'phone', ignoreDuplicates: false }
      );
  };

  const handleRemoveTag = async (tag: string) => {
    if (!conversation?.phone) return;
    const newTags = customerTags.filter(t => t !== tag);
    setContactTags(newTags);
    await supabase
      .from('chat_contacts')
      .update({ tags: newTags })
      .eq('phone', conversation.phone);
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(t => t.stop());
        
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size === 0) {
          setIsRecording(false);
          setRecordingTime(0);
          return;
        }

        // Upload audio
        const file = new File([audioBlob], `audio-${Date.now()}.webm`, { type: 'audio/webm' });
        const url = await uploadMediaToStorage(file);
        
        if (url && onSendAudio) {
          onSendAudio(url);
        } else if (!url) {
          toast.error('Erro ao enviar áudio');
        }

        setIsRecording(false);
        setRecordingTime(0);
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
  }, [onSendAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      // Clear chunks before stopping so onstop won't upload
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

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onSendMedia) return;
    event.target.value = '';

    if (file.size > 16 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 16MB.');
      return;
    }

    const mediaType = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio' : 'document';

    toast.info('Enviando arquivo...');
    const url = await uploadMediaToStorage(file);
    if (url) {
      onSendMedia(url, mediaType);
    }
  }, [onSendMedia]);

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

      {/* Customer Info Panel */}
      {customerInfoPanel}

      {/* Messages */}
      <ScrollArea className="flex-1 bg-[#e5ddd5] dark:bg-[#0b141a]" style={{ minHeight: 0 }}>
        <div className="space-y-2 p-3 w-full max-w-full overflow-hidden">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] sm:max-w-[75%] rounded-lg px-3 py-2 text-sm overflow-hidden",
                  msg.direction === 'outgoing'
                    ? 'bg-[#dcf8c6] dark:bg-[#005c4b] text-foreground'
                    : 'bg-white dark:bg-[#202c33] text-foreground'
                )}
              >
                {msg.media_url && msg.media_type?.includes('image') && (
                  <img src={msg.media_url} alt="" className="max-w-[200px] max-h-[200px] rounded mb-1 object-cover cursor-pointer" onClick={() => window.open(msg.media_url!, '_blank')} />
                )}
                {msg.media_url && msg.media_type === 'audio' && (
                  <audio src={msg.media_url} controls className="w-full mb-1" />
                )}
                {msg.media_url && msg.media_type === 'video' && (
                  <video src={msg.media_url} controls className="max-w-full rounded mb-1" style={{ maxHeight: 200 }} />
                )}
                {msg.message && <p className="whitespace-pre-wrap break-words overflow-wrap-anywhere" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{msg.message}</p>}
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
                <p className="text-[10px] text-muted-foreground text-right mt-1 flex items-center justify-end gap-0.5">
                  {formatMessageTime(new Date(msg.created_at))}
                  {msg.direction === 'outgoing' && <MessageStatusIcon status={msg.status} />}
                </p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-2 border-t bg-[#f0f0f0] dark:bg-[#202c33] flex items-center gap-2 flex-shrink-0">
        {isRecording ? (
          <>
            <Button
              size="icon"
              variant="ghost"
              onClick={cancelRecording}
              className="h-10 w-10 text-destructive"
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
            >
              <Send className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
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
            <textarea
              placeholder="Digite uma mensagem..."
              value={newMessage}
              onChange={(e) => onNewMessageChange(e.target.value)}
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
              <Button
                size="icon"
                onClick={onSendMessage}
                disabled={isSending}
                className="bg-stage-paid hover:bg-stage-paid/90"
              >
                <Send className="h-4 w-4" />
              </Button>
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
    </div>
  );
}
