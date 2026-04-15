import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useZapi } from '@/hooks/useZapi';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Send, Mic, X, Square, ArrowLeft, Paperclip, Image } from 'lucide-react';
import { EmojiPickerButton } from '../EmojiPickerButton';
import { uploadMediaToStorage } from '../MediaAttachmentPicker';
import { WhatsAppNumberSelector } from '../WhatsAppNumberSelector';
import { useWhatsAppNumberStore } from '@/stores/whatsappNumberStore';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MessageStatusIcon } from '../chat/MessageStatusIcon';
import { WhatsAppMediaAttachment } from '../chat/WhatsAppMediaAttachment';

interface Message {
  id: string;
  phone: string;
  message: string;
  direction: 'incoming' | 'outgoing';
  message_id: string | null;
  status: string | null;
  created_at: string;
  media_type?: string;
  media_url?: string;
}

interface SupportWhatsAppChatProps {
  phone: string;
  customerName: string;
  ticketSubject: string;
  onClose: () => void;
}

export function SupportWhatsAppChat({ phone, customerName, ticketSubject, onClose }: SupportWhatsAppChatProps) {
  const currentUserId = useCurrentUserId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { sendMessage, sendMedia, isLoading: isSending } = useZapi();
  const { selectedNumberId, fetchNumbers } = useWhatsAppNumberStore();

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  const rawPhone = phone.replace(/\D/g, '');
  const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone;
  const phoneWithoutCountry = rawPhone.startsWith('55') ? rawPhone.slice(2) : rawPhone;
  const phoneWithout9 = phoneWithoutCountry.length === 11 && phoneWithoutCountry.charAt(2) === '9'
    ? phoneWithoutCountry.slice(0, 2) + phoneWithoutCountry.slice(3) : null;
  const phoneVariations = [normalizedPhone, rawPhone, phoneWithoutCountry, phoneWithout9, phoneWithout9 ? '55' + phoneWithout9 : null].filter(Boolean) as string[];

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .in('phone', phoneVariations)
      .order('created_at', { ascending: true });
    setMessages((data as Message[]) || []);
    setIsLoading(false);
  }, [normalizedPhone]);

  useEffect(() => {
    loadMessages();
    const channel = supabase
      .channel(`support-whatsapp-${normalizedPhone}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
        const newMsg = payload.new as Message;
        if (!phoneVariations.includes(newMsg.phone)) return;
        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [normalizedPhone, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (isSending || !newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage('');

    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, phone: normalizedPhone, message: text, direction: 'outgoing', message_id: null, status: 'sending', created_at: new Date().toISOString() }]);

    const result = await sendMessage(phone, text);
    if (result.success) {
      await supabase.from('whatsapp_messages').insert({ phone: normalizedPhone, message: text, direction: 'outgoing', status: 'sent', sender_user_id: currentUserId || null });
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } else {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    const { getMaxSizeForType, getMaxSizeLabel, getMediaTypeLabel } = await import('@/constants/mediaLimits');
    if (file.size > getMaxSizeForType(file.type)) { toast.error(`${getMediaTypeLabel(file.type)} muito grande. O limite é ${getMaxSizeLabel(file.type)}.`); return; }
    const mediaType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
    toast.info('Enviando arquivo...');
    const url = await uploadMediaToStorage(file);
    if (url) {
      const result = await sendMedia(phone, url, mediaType as any);
      if (result.success) {
        await supabase.from('whatsapp_messages').insert({ phone: normalizedPhone, message: `[${mediaType}]`, direction: 'outgoing', status: 'sent', media_type: mediaType, media_url: url, sender_user_id: currentUserId || null });
        loadMessages();
      }
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const { getAudioMimeType, getAudioExtension, getAudioContentType } = await import('@/lib/audioRecorder');
      const mimeType = getAudioMimeType();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const ct = getAudioContentType(mimeType);
        const ext = getAudioExtension(mimeType);
        const blob = new Blob(audioChunksRef.current, { type: ct });
        if (blob.size === 0) { setIsRecording(false); setRecordingTime(0); return; }
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: ct });
        const url = await uploadMediaToStorage(file);
        if (url) {
          const result = await sendMedia(phone, url, 'audio');
          if (result.success) {
            await supabase.from('whatsapp_messages').insert({ phone: normalizedPhone, message: '[audio]', direction: 'outgoing', status: 'sent', media_type: 'audio', media_url: url, sender_user_id: currentUserId || null });
            loadMessages();
          }
        }
        setIsRecording(false); setRecordingTime(0);
      };
      recorder.start();
      setIsRecording(true); setRecordingTime(0);
      timerRef.current = window.setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch { toast.error('Não foi possível acessar o microfone.'); }
  }, [phone, normalizedPhone, sendMedia, loadMessages]);

  const stopRecording = useCallback(() => { mediaRecorderRef.current?.state === 'recording' && mediaRecorderRef.current.stop(); }, []);
  const cancelRecording = useCallback(() => {
    audioChunksRef.current = [];
    mediaRecorderRef.current?.state === 'recording' && mediaRecorderRef.current.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false); setRecordingTime(0);
  }, []);

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#075e54] dark:bg-[#1f2c34] text-white">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{customerName}</p>
          <p className="text-[10px] opacity-80 truncate">{ticketSubject} · {phone}</p>
        </div>
        <WhatsAppNumberSelector />
        
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3 bg-[#e5ddd5] dark:bg-[#0b141a]" style={{ minHeight: 0 }}>
        <div className="space-y-2">
          {isLoading ? (
            <p className="text-xs text-center text-muted-foreground py-8">Carregando...</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-center text-muted-foreground py-8">Nenhuma mensagem ainda</p>
          ) : messages.map(msg => (
            <div key={msg.id} className={cn('flex', msg.direction === 'outgoing' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-lg px-3 py-2 text-sm', msg.direction === 'outgoing' ? 'bg-[#dcf8c6] dark:bg-[#005c4b] text-foreground' : 'bg-white dark:bg-[#202c33] text-foreground')}>
                <WhatsAppMediaAttachment
                  mediaUrl={msg.media_url}
                  mediaType={msg.media_type}
                  message={msg.message}
                  direction={msg.direction}
                  imageClassName="max-w-full rounded mb-1"
                  imageStyle={{ maxHeight: 200 }}
                  videoClassName="max-w-full rounded mb-1"
                  videoStyle={{ maxHeight: 200 }}
                  audioClassName="w-full mb-1"
                  pdfClassName="w-full h-64 rounded-md border border-border bg-background mb-2"
                />
                {msg.message && <p className="whitespace-pre-wrap break-words">{msg.message}</p>}
                <p className="text-[10px] text-muted-foreground text-right mt-1 flex items-center justify-end gap-0.5">
                  {format(new Date(msg.created_at), 'HH:mm', { locale: ptBR })}
                  {msg.direction === 'outgoing' && <MessageStatusIcon status={msg.status} />}
                </p>
              </div>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-2 border-t bg-[#f0f0f0] dark:bg-[#202c33] flex items-center gap-2">
        <input ref={imageInputRef} type="file" accept="image/*,video/*,application/*" className="hidden" onChange={handleFileSelect} />
        {isRecording ? (
          <>
            <Button size="icon" variant="ghost" onClick={cancelRecording} className="h-9 w-9 text-destructive"><X className="h-4 w-4" /></Button>
            <div className="flex-1 flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
              <span className="text-xs font-medium text-destructive">{Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
            </div>
            <Button size="icon" onClick={stopRecording} className="h-9 w-9 bg-green-600 hover:bg-green-700"><Send className="h-3.5 w-3.5" /></Button>
          </>
        ) : (
          <>
            <EmojiPickerButton onEmojiSelect={(e) => { setNewMessage(prev => prev + e); inputRef.current?.focus(); }} />
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => imageInputRef.current?.click()}>
              <Paperclip className="h-4 w-4 text-muted-foreground" />
            </Button>
            <textarea
              ref={inputRef as any}
              placeholder="Mensagem..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              className="flex-1 bg-white dark:bg-[#2a3942] text-sm rounded-md border border-input px-3 py-2 resize-none min-h-[36px] max-h-[100px] overflow-y-auto"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 100) + 'px';
              }}
            />
            {newMessage.trim() ? (
              <Button size="icon" onClick={handleSend} disabled={isSending} className="h-9 w-9 bg-green-600 hover:bg-green-700"><Send className="h-3.5 w-3.5" /></Button>
            ) : (
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={startRecording}><Mic className="h-4 w-4 text-muted-foreground" /></Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
