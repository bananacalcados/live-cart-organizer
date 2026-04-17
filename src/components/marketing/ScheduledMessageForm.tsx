import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import {
  CalendarIcon, Sparkles, Loader2, Play, Upload, Link as LinkIcon, Variable, Save, FileText,
  Mic, Square, Send, ShoppingBag, Image as ImageIcon, Trash2, Search, Plus, GripVertical,
  ChevronUp, ChevronDown, Type, BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { WhatsAppFormattingToolbar } from "./WhatsAppFormattingToolbar";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export interface MediaItem {
  url: string;
  caption: string;
}

export interface MessageBlock {
  id: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'poll';
  content: string;
  mediaItems: MediaItem[];
  mediaUrl: string;
  pollOptions: string[];
  pollMaxOptions: number;
}

export interface ScheduledMessageData {
  // Legacy single-message fields (kept for backward compat)
  messageType: string;
  messageContent: string;
  mediaUrl: string;
  mediaItems: MediaItem[];
  pollOptions: string[];
  pollMaxOptions: number;
  scheduledAt: Date;
  scheduledTime: string;
  sendSpeed: string;
  mentionAll: boolean;
  // New multi-block
  blocks?: MessageBlock[];
}

interface EditingMessage {
  id: string;
  message_type: string;
  message_content: string | null;
  media_url: string | null;
  poll_options: any;
  scheduled_at: string;
  send_speed: string;
}

interface MessageTemplate {
  id: string;
  name: string;
  message_type: string;
  message_content: string | null;
  media_url: string | null;
  poll_options: any;
}

interface ScheduledMessageFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ScheduledMessageData) => Promise<void>;
  onSendNow?: (data: ScheduledMessageData) => Promise<void>;
  editingMessage?: EditingMessage | null;
  onUpdate?: (id: string, data: ScheduledMessageData) => Promise<void>;
  campaignId?: string;
}

const VARIABLES = [
  { name: "link_live", label: "Link da Live" },
  { name: "nome_grupo", label: "Nome do Grupo" },
  { name: "data_hoje", label: "Data de Hoje" },
  { name: "horario", label: "Horário Atual" },
];

const BLOCK_TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  text: { icon: "📝", label: "Texto" },
  image: { icon: "🖼️", label: "Imagem" },
  video: { icon: "🎬", label: "Vídeo" },
  audio: { icon: "🎵", label: "Áudio" },
  document: { icon: "📄", label: "Documento" },
  poll: { icon: "📊", label: "Enquete" },
};

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function createBlock(type: MessageBlock['type']): MessageBlock {
  return {
    id: generateId(),
    type,
    content: '',
    mediaItems: [],
    mediaUrl: '',
    pollOptions: type === 'poll' ? ['', ''] : [],
    pollMaxOptions: 1,
  };
}

// ─── Individual Block Editor ───
function BlockEditor({
  block, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast, onOpenShopify,
}: {
  block: MessageBlock;
  onChange: (b: MessageBlock) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  onOpenShopify: (blockId: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  // Audio recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);

  const multiMediaTypes = ['image', 'video', 'document'];
  const isMultiMedia = multiMediaTypes.includes(block.type);

  const acceptTypes: Record<string, string> = {
    image: "image/*",
    video: "video/*",
    audio: "audio/*",
    document: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip",
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const { normalizeImageOrientation } = await import('@/lib/imageOrientation');

    if (block.type === 'audio') {
      // Single audio
      const file = files[0];
      const { getMaxSizeForType, getMaxSizeLabel, getMediaTypeLabel } = await import('@/constants/mediaLimits');
      if (file.size > getMaxSizeForType(file.type)) { toast.error(`${getMediaTypeLabel(file.type)} muito grande. O limite é ${getMaxSizeLabel(file.type)}.`); return; }
      setIsUploading(true);
      try {
        const ext = file.name.split('.').pop();
        const path = `group-messages/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from('marketing-attachments').upload(path, file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
        onChange({ ...block, mediaUrl: urlData.publicUrl });
        toast.success("Arquivo enviado!");
      } catch { toast.error("Erro no upload"); }
      finally { setIsUploading(false); }
    } else {
      // Multi media
      const remaining = 10 - block.mediaItems.length;
      if (files.length > remaining) { toast.error(`Máximo ${remaining} arquivo(s) restante(s)`); return; }
      setIsUploading(true);
      try {
        const newItems: MediaItem[] = [];
        for (const rawFile of Array.from(files)) {
          const { getMaxSizeForType, getMaxSizeLabel, getMediaTypeLabel } = await import('@/constants/mediaLimits');
          // Normaliza EXIF para imagens (corrige fotos deitadas vindas de celulares)
          const file = await normalizeImageOrientation(rawFile);
          if (file.size > getMaxSizeForType(file.type)) { toast.error(`${file.name}: ${getMediaTypeLabel(file.type)} muito grande. O limite é ${getMaxSizeLabel(file.type)}.`); continue; }
          const ext = file.name.split('.').pop();
          const path = `group-messages/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error } = await supabase.storage.from('marketing-attachments').upload(path, file, { contentType: file.type });
          if (error) continue;
          const { data: urlData } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
          newItems.push({ url: urlData.publicUrl, caption: '' });
        }
        onChange({ ...block, mediaItems: [...block.mediaItems, ...newItems] });
        if (newItems.length) toast.success(`${newItems.length} arquivo(s) enviado(s)!`);
      } catch { toast.error("Erro no upload"); }
      finally { setIsUploading(false); if (e.target) e.target.value = ''; }
    }
  };

  const addUrl = () => {
    if (!urlInput.trim()) return;
    onChange({ ...block, mediaItems: [...block.mediaItems, { url: urlInput.trim(), caption: '' }] });
    setUrlInput('');
  };

  const updateCaption = (idx: number, caption: string) => {
    const next = [...block.mediaItems];
    next[idx] = { ...next[idx], caption };
    onChange({ ...block, mediaItems: next });
  };

  const removeItem = (idx: number) => {
    onChange({ ...block, mediaItems: block.mediaItems.filter((_, i) => i !== idx) });
  };

  // Audio recording
  const startRecording = useCallback(async () => {
    try {
      const { getAudioMimeType, getAudioExtension, getAudioContentType } = await import('@/lib/audioRecorder');
      const mimeType = getAudioMimeType();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const ct = getAudioContentType(mimeType);
        const blob = new Blob(audioChunksRef.current, { type: ct });
        if (blob.size === 0) return;
        const previewUrl = URL.createObjectURL(blob);
        setAudioPreviewUrl(previewUrl);
        toast.success("Áudio gravado!");
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { toast.error("Permissão de microfone negada"); }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
  }, []);

  const confirmAudio = async () => {
    if (!audioPreviewUrl) return;
    setIsUploading(true);
    try {
      const resp = await fetch(audioPreviewUrl);
      const blob = await resp.blob();
      const path = `group-messages/audio-${Date.now()}.webm`;
      const { error } = await supabase.storage.from('marketing-attachments').upload(path, blob);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
      onChange({ ...block, mediaUrl: urlData.publicUrl });
      URL.revokeObjectURL(audioPreviewUrl);
      setAudioPreviewUrl(null);
      toast.success("Áudio confirmado!");
    } catch { toast.error("Erro ao enviar áudio"); }
    finally { setIsUploading(false); }
  };

  const formatRecTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const typeInfo = BLOCK_TYPE_LABELS[block.type];

  return (
    <div className="border rounded-lg bg-card relative group">
      {/* Header with drag handle and controls */}
      <div className="flex items-center gap-1 p-2 border-b bg-muted/30 rounded-t-lg">
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
        <span className="text-xs font-medium flex-1">{typeInfo.icon} {typeInfo.label}</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveUp} disabled={isFirst}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMoveDown} disabled={isLast}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {/* ── TEXT BLOCK ── */}
        {block.type === 'text' && (
          <>
            <Textarea
              ref={textareaRef}
              value={block.content}
              onChange={e => onChange({ ...block, content: e.target.value })}
              rows={4}
              placeholder="Escreva a sua mensagem... (use Enter para quebra de linha)"
            />
            <WhatsAppFormattingToolbar value={block.content} onChange={val => onChange({ ...block, content: val })} textareaRef={textareaRef} />
            <Button variant="outline" size="sm" className="gap-1" onClick={() => onOpenShopify(block.id)}>
              <ShoppingBag className="h-3.5 w-3.5" /> Produto Shopify
            </Button>
          </>
        )}

        {/* ── IMAGE / VIDEO / DOCUMENT BLOCK ── */}
        {isMultiMedia && (
          <>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="gap-1"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || block.mediaItems.length >= 10}>
                {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload
              </Button>
              {block.type === 'image' && (
                <Button variant="outline" size="sm" className="gap-1" onClick={() => onOpenShopify(block.id)}
                  disabled={block.mediaItems.length >= 10}>
                  <ShoppingBag className="h-3.5 w-3.5" /> Shopify
                </Button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept={acceptTypes[block.type]} multiple
              onChange={handleFileUpload} className="hidden" />

            {/* URL add */}
            <div className="flex gap-2">
              <Input placeholder="Ou cole URL..." value={urlInput} onChange={e => setUrlInput(e.target.value)} className="flex-1 text-xs" />
              <Button variant="outline" size="sm" disabled={!urlInput.trim() || block.mediaItems.length >= 10} onClick={addUrl}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Items list */}
            {block.mediaItems.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {block.mediaItems.map((item, i) => (
                  <div key={i} className="flex gap-2 items-start border rounded p-2">
                    <div className="w-14 h-14 bg-muted rounded shrink-0 overflow-hidden flex items-center justify-center">
                      {block.type === 'image' ? (
                        <img src={item.url} alt="" className="w-full h-full object-cover" />
                      ) : block.type === 'video' ? (
                        <video src={item.url} className="w-full h-full object-cover" />
                      ) : (
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <Textarea placeholder="Legenda..." value={item.caption}
                        onChange={e => updateCaption(i, e.target.value)} rows={2} className="text-xs" />
                      <WhatsAppFormattingToolbar value={item.caption} onChange={val => updateCaption(i, val)} />
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeItem(i)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">{block.mediaItems.length}/10 arquivos</p>
          </>
        )}

        {/* ── AUDIO BLOCK ── */}
        {block.type === 'audio' && (
          <>
            {!block.mediaUrl && !audioPreviewUrl && !isRecording && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Upload
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={startRecording}>
                  <Mic className="h-3.5 w-3.5" /> Gravar
                </Button>
                <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
              </div>
            )}
            {isRecording && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-destructive font-medium animate-pulse">● {formatRecTime(recordingTime)}</span>
                <Button variant="destructive" size="sm" onClick={stopRecording} className="gap-1">
                  <Square className="h-3 w-3" /> Parar
                </Button>
              </div>
            )}
            {audioPreviewUrl && (
              <div className="space-y-2">
                <audio src={audioPreviewUrl} controls className="w-full h-10" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={confirmAudio} disabled={isUploading} className="gap-1 flex-1">
                    {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Confirmar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => { URL.revokeObjectURL(audioPreviewUrl); setAudioPreviewUrl(null); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
            {block.mediaUrl && !audioPreviewUrl && (
              <div className="flex items-center gap-2">
                <audio src={block.mediaUrl} controls className="flex-1 h-8" />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange({ ...block, mediaUrl: '' })}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            )}
            {/* URL input */}
            {!block.mediaUrl && !audioPreviewUrl && !isRecording && (
              <Input placeholder="Ou cole URL do áudio..." value={block.mediaUrl}
                onChange={e => onChange({ ...block, mediaUrl: e.target.value })} className="text-xs" />
            )}
          </>
        )}

        {/* ── POLL BLOCK ── */}
        {block.type === 'poll' && (
          <>
            <Textarea
              value={block.content}
              onChange={e => onChange({ ...block, content: e.target.value })}
              rows={2}
              placeholder="Pergunta da enquete..."
              className="text-sm"
            />
            <div className="space-y-1">
              {block.pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input placeholder={`Opção ${i + 1}`} value={opt}
                    onChange={e => {
                      const next = [...block.pollOptions];
                      next[i] = e.target.value;
                      onChange({ ...block, pollOptions: next });
                    }} className="text-xs" />
                  {block.pollOptions.length > 2 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => onChange({ ...block, pollOptions: block.pollOptions.filter((_, idx) => idx !== i) })}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
              {block.pollOptions.length < 6 && (
                <Button variant="outline" size="sm" className="text-xs" onClick={() => onChange({ ...block, pollOptions: [...block.pollOptions, ''] })}>
                  + Opção
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between pt-1 border-t">
              <Label className="text-xs">Múltiplas respostas</Label>
              <Switch checked={block.pollMaxOptions === 0} onCheckedChange={v => onChange({ ...block, pollMaxOptions: v ? 0 : 1 })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Composer ───
export function ScheduledMessageForm({ open, onOpenChange, onSubmit, onSendNow, editingMessage, onUpdate, campaignId }: ScheduledMessageFormProps) {
  const [blocks, setBlocks] = useState<MessageBlock[]>([createBlock('text')]);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(new Date());
  const [scheduledTime, setScheduledTime] = useState("12:00");
  const [sendSpeed, setSendSpeed] = useState("normal");
  const [mentionAll, setMentionAll] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  // Templates
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  // Shopify
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [shopifySearch, setShopifySearch] = useState("");
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [showShopifyPicker, setShowShopifyPicker] = useState(false);
  const [shopifySendMode, setShopifySendMode] = useState<"photo_only" | "link">("photo_only");
  const [shopifyTargetBlockId, setShopifyTargetBlockId] = useState<string | null>(null);

  // Load editing message (legacy single → one block)
  useEffect(() => {
    if (editingMessage) {
      const b = createBlock(editingMessage.message_type as MessageBlock['type']);
      b.content = editingMessage.message_content || '';
      // For image/video/document types, load media_url into mediaItems array
      const multiMediaTypes = ['image', 'video', 'document'];
      if (multiMediaTypes.includes(editingMessage.message_type) && editingMessage.media_url) {
        b.mediaItems = [{ url: editingMessage.media_url, caption: editingMessage.message_content || '' }];
        b.content = ''; // caption is stored in mediaItems
      }
      b.mediaUrl = editingMessage.media_url || '';
      if (editingMessage.poll_options) {
        b.pollOptions = Array.isArray(editingMessage.poll_options) ? editingMessage.poll_options : ['', ''];
      }
      setBlocks([b]);
      setSendSpeed(editingMessage.send_speed || 'normal');
      const d = new Date(editingMessage.scheduled_at);
      setScheduledDate(d);
      setScheduledTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } else {
      resetForm();
    }
  }, [editingMessage, open]);

  useEffect(() => { if (open) fetchTemplates(); }, [open]);

  const fetchTemplates = async () => {
    const { data } = await supabase.from('group_message_templates').select('*').order('created_at', { ascending: false });
    setTemplates((data || []) as MessageTemplate[]);
  };

  const resetForm = () => {
    setBlocks([createBlock('text')]);
    setAiPrompt('');
    setTemplateName('');
    setMentionAll(false);
    setScheduledDate(new Date());
    setScheduledTime('12:00');
    setSendSpeed('normal');
  };

  const addBlock = (type: MessageBlock['type']) => {
    setBlocks(prev => [...prev, createBlock(type)]);
  };

  const updateBlock = (id: string, updated: MessageBlock) => {
    setBlocks(prev => prev.map(b => b.id === id ? updated : b));
  };

  const removeBlock = (id: string) => {
    setBlocks(prev => prev.length > 1 ? prev.filter(b => b.id !== id) : prev);
  };

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    setBlocks(prev => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  // Build submit data from blocks
  const buildData = (dateOverride?: Date, timeOverride?: string): ScheduledMessageData => {
    const first = blocks[0];
    return {
      messageType: first.type,
      messageContent: first.content,
      mediaUrl: first.mediaUrl,
      mediaItems: first.mediaItems,
      pollOptions: first.pollOptions.filter(o => o.trim()),
      pollMaxOptions: first.pollMaxOptions,
      scheduledAt: dateOverride || scheduledDate || new Date(),
      scheduledTime: timeOverride || scheduledTime,
      sendSpeed,
      mentionAll,
      blocks,
    };
  };

  const validate = (): boolean => {
    for (const b of blocks) {
      if (b.type === 'text' && !b.content.trim()) { toast.error("Bloco de texto vazio"); return false; }
      if (['image', 'video', 'document'].includes(b.type) && b.mediaItems.length === 0) {
        toast.error(`Bloco de ${BLOCK_TYPE_LABELS[b.type].label} sem arquivos`); return false;
      }
      if (b.type === 'audio' && !b.mediaUrl) { toast.error("Bloco de áudio sem arquivo"); return false; }
      if (b.type === 'poll' && b.pollOptions.filter(o => o.trim()).length < 2) {
        toast.error("Enquete precisa de ao menos 2 opções"); return false;
      }
    }
    if (!scheduledDate) { toast.error("Selecione uma data"); return false; }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      await onSubmit(buildData());
      resetForm();
      onOpenChange(false);
    } catch { toast.error("Erro ao salvar"); }
    finally { setIsSaving(false); }
  };

  const handleSendNow = async () => {
    if (!onSendNow || !validate()) return;
    setIsSaving(true);
    try {
      await onSendNow(buildData(new Date(), format(new Date(), 'HH:mm')));
      resetForm();
      onOpenChange(false);
    } catch { toast.error("Erro ao enviar"); }
    finally { setIsSaving(false); }
  };

  const handleUpdate = async () => {
    if (!editingMessage || !onUpdate || !validate()) return;
    setIsSaving(true);
    try {
      await onUpdate(editingMessage.id, buildData());
      resetForm();
      onOpenChange(false);
    } catch { toast.error("Erro ao salvar"); }
    finally { setIsSaving(false); }
  };

  // AI
  const generateAI = async () => {
    if (!aiPrompt.trim()) { toast.error("Insira um prompt"); return; }
    setIsGenerating(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-marketing-strategy`, {
        method: 'POST',
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Gere uma mensagem para grupo WhatsApp VIP. Engajante, com emojis, máx 500 chars. Texto simples. Briefing: ${aiPrompt}`,
          mode: 'quick_copy',
        }),
      });
      const data = await res.json();
      const content = typeof data.strategy === 'string' ? data.strategy : (data.copy || '');
      if (content) {
        // Insert into first text block or create one
        const textBlockIdx = blocks.findIndex(b => b.type === 'text');
        if (textBlockIdx >= 0) {
          updateBlock(blocks[textBlockIdx].id, { ...blocks[textBlockIdx], content });
        } else {
          const nb = createBlock('text');
          nb.content = content;
          setBlocks(prev => [nb, ...prev]);
        }
        toast.success("Texto gerado!");
      } else toast.error("IA não retornou conteúdo");
    } catch { toast.error("Erro ao gerar"); }
    finally { setIsGenerating(false); }
  };

  // Templates
  const loadTemplate = (t: MessageTemplate) => {
    const b = createBlock(t.message_type as MessageBlock['type']);
    b.content = t.message_content || '';
    b.mediaUrl = t.media_url || '';
    if (t.poll_options) b.pollOptions = Array.isArray(t.poll_options) ? t.poll_options : ['', ''];
    setBlocks([b]);
    setShowTemplates(false);
    toast.success("Modelo carregado!");
  };

  const saveAsTemplate = async () => {
    if (!templateName.trim()) { toast.error("Nome obrigatório"); return; }
    const first = blocks[0];
    const { error } = await supabase.from('group_message_templates').insert({
      name: templateName.trim(),
      message_type: first.type,
      message_content: first.content || null,
      media_url: first.mediaUrl || null,
      poll_options: first.type === 'poll' ? first.pollOptions.filter(o => o.trim()) : null,
    });
    if (error) { toast.error("Erro ao salvar modelo"); return; }
    toast.success("Modelo salvo!");
    setShowSaveTemplate(false);
    setTemplateName("");
    fetchTemplates();
  };

  // Shopify
  const openShopifyPicker = (blockId: string) => {
    setShopifyTargetBlockId(blockId);
    setShowShopifyPicker(true);
    loadShopifyProducts();
  };

  const loadShopifyProducts = async (query?: string) => {
    setIsLoadingProducts(true);
    try { setShopifyProducts(await fetchProducts(50, query || undefined)); }
    catch { toast.error("Erro ao carregar produtos"); }
    finally { setIsLoadingProducts(false); }
  };

  const selectShopifyProduct = (product: ShopifyProduct, imageUrl: string) => {
    const targetBlock = blocks.find(b => b.id === shopifyTargetBlockId);
    if (!targetBlock) return;

    if (shopifySendMode === 'photo_only') {
      if (targetBlock.type === 'image') {
        updateBlock(targetBlock.id, { ...targetBlock, mediaItems: [...targetBlock.mediaItems, { url: imageUrl, caption: '' }] });
      } else if (targetBlock.type === 'text') {
        // Add a new image block
        const nb = createBlock('image');
        nb.mediaItems = [{ url: imageUrl, caption: '' }];
        setBlocks(prev => [...prev, nb]);
      }
    } else {
      const handle = product.node.handle;
      const link = `https://bananabrasil.com.br/products/${handle}`;
      if (targetBlock.type === 'text') {
        updateBlock(targetBlock.id, { ...targetBlock, content: targetBlock.content ? `${targetBlock.content}\n${link}` : link });
      }
    }
    setShowShopifyPicker(false);
    toast.success(shopifySendMode === 'photo_only' ? "Foto adicionada!" : "Link inserido!");
  };

  // Variables - insert into first text block
  const insertVariable = (varName: string) => {
    const textBlock = blocks.find(b => b.type === 'text');
    if (!textBlock) {
      const nb = createBlock('text');
      nb.content = `{{${varName}}}`;
      setBlocks(prev => [nb, ...prev]);
    } else {
      updateBlock(textBlock.id, { ...textBlock, content: textBlock.content + `{{${varName}}}` });
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingMessage ? "Editar Mensagem" : "Enviar Mensagem"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Templates */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowTemplates(!showTemplates)}>
              <FileText className="h-3.5 w-3.5" /> Usar Modelo
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowSaveTemplate(true)}>
              <Save className="h-3.5 w-3.5" /> Salvar como Modelo
            </Button>
          </div>

          {showTemplates && templates.length > 0 && (
            <div className="border rounded-lg p-2 space-y-1 max-h-32 overflow-y-auto">
              {templates.map(t => (
                <button key={t.id} onClick={() => loadTemplate(t)}
                  className="w-full text-left text-xs p-2 rounded hover:bg-muted transition-colors">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-muted-foreground ml-2">({t.message_type})</span>
                </button>
              ))}
            </div>
          )}

          {showSaveTemplate && (
            <div className="border rounded-lg p-3 space-y-2">
              <Input placeholder="Nome do modelo" value={templateName} onChange={e => setTemplateName(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveAsTemplate}>Salvar</Button>
                <Button size="sm" variant="outline" onClick={() => setShowSaveTemplate(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* ── BLOCKS ── */}
          <div className="space-y-2">
            {blocks.map((block, idx) => (
              <BlockEditor
                key={block.id}
                block={block}
                onChange={updated => updateBlock(block.id, updated)}
                onRemove={() => removeBlock(block.id)}
                onMoveUp={() => moveBlock(idx, -1)}
                onMoveDown={() => moveBlock(idx, 1)}
                isFirst={idx === 0}
                isLast={idx === blocks.length - 1}
                onOpenShopify={openShopifyPicker}
              />
            ))}
          </div>

          {/* Add block buttons */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-muted-foreground self-center mr-1">+ Adicionar:</span>
            {Object.entries(BLOCK_TYPE_LABELS).map(([type, info]) => (
              <Button key={type} variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2"
                onClick={() => addBlock(type as MessageBlock['type'])}>
                {info.icon} {info.label}
              </Button>
            ))}
          </div>

          <Separator />

          {/* AI */}
          <Card className="border-dashed">
            <CardContent className="p-3 space-y-2">
              <Label className="text-xs flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-primary" /> Gerar com IA</Label>
              <Textarea placeholder="Descreva o que quer..." value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2} />
              <Button variant="outline" size="sm" onClick={generateAI} disabled={isGenerating} className="gap-1">
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Gerar
              </Button>
            </CardContent>
          </Card>

          {/* Variables */}
          <div>
            <Label className="text-xs flex items-center gap-1 mb-1">
              <Variable className="h-3.5 w-3.5" /> Inserir Variável
            </Label>
            <div className="flex flex-wrap gap-1">
              {VARIABLES.map(v => (
                <Button key={v.name} variant="outline" size="sm" className="text-[10px] h-6 px-2"
                  onClick={() => insertVariable(v.name)}>
                  {`{{${v.name}}}`}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Date & Time */}
          <div className="flex gap-3">
            <div className="flex-1">
              <Label className="text-xs">Data</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !scheduledDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {scheduledDate ? format(scheduledDate, "dd/MM/yyyy") : "Selecionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={scheduledDate} onSelect={setScheduledDate} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div className="w-28">
              <Label className="text-xs">Horário</Label>
              <Input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
            </div>
          </div>

          {/* Speed */}
          <div>
            <Label className="text-xs">Velocidade de Envio</Label>
            <Select value={sendSpeed} onValueChange={setSendSpeed}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="slow">🐢 Lento (8-15s)</SelectItem>
                <SelectItem value="normal">⚡ Normal (3-8s)</SelectItem>
                <SelectItem value="fast">🚀 Rápido (1-3s)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mention All */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="text-xs font-medium">📢 Marcar todos os participantes</Label>
              <p className="text-[10px] text-muted-foreground">Todos receberão notificação da mensagem</p>
            </div>
            <Switch checked={mentionAll} onCheckedChange={setMentionAll} />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {!editingMessage && onSendNow && (
            <Button variant="secondary" onClick={handleSendNow} disabled={isSaving} className="gap-1">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar Agora
            </Button>
          )}
          <Button onClick={editingMessage ? handleUpdate : handleSubmit} disabled={isSaving} className="gap-1">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {editingMessage ? "Salvar" : "Enviar Mensagem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Shopify Picker */}
    <Dialog open={showShopifyPicker} onOpenChange={setShowShopifyPicker}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" /> Selecionar Produto da Shopify
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={shopifySendMode === "photo_only" ? "default" : "outline"} size="sm" className="gap-1"
              onClick={() => setShopifySendMode("photo_only")}>
              <ImageIcon className="h-3.5 w-3.5" /> Apenas Foto
            </Button>
            <Button variant={shopifySendMode === "link" ? "default" : "outline"} size="sm" className="gap-1"
              onClick={() => setShopifySendMode("link")}>
              <LinkIcon className="h-3.5 w-3.5" /> Link do Produto
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar produto..." value={shopifySearch}
              onChange={e => setShopifySearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadShopifyProducts(shopifySearch); }}
              className="pl-9" />
          </div>
          <Button variant="outline" size="sm" onClick={() => loadShopifyProducts(shopifySearch)} disabled={isLoadingProducts}>
            {isLoadingProducts ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Buscar
          </Button>
          <ScrollArea className="h-[400px]">
            {isLoadingProducts ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : shopifyProducts.length === 0 ? (
              <p className="text-sm text-center text-muted-foreground py-8">Nenhum produto encontrado</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {shopifyProducts.map(p => {
                  const images = p.node.images.edges;
                  const mainImage = images[0]?.node.url;
                  return (
                    <Card key={p.node.id} className="overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">
                      <div className="space-y-2">
                        {mainImage && <img src={mainImage} alt={p.node.title} className="w-full h-32 object-cover" />}
                        <div className="p-2">
                          <p className="text-xs font-medium truncate">{p.node.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            R$ {parseFloat(p.node.priceRange.minVariantPrice.amount).toFixed(2)}
                          </p>
                          {images.length > 1 && shopifySendMode === 'photo_only' && (
                            <div className="flex gap-1 mt-1 overflow-x-auto">
                              {images.map((img, idx) => (
                                <img key={idx} src={img.node.url} alt=""
                                  className="h-10 w-10 rounded object-cover cursor-pointer border-2 border-transparent hover:border-primary transition-colors shrink-0"
                                  onClick={(e) => { e.stopPropagation(); selectShopifyProduct(p, img.node.url); }} />
                              ))}
                            </div>
                          )}
                          {(images.length <= 1 || shopifySendMode === 'link') && (
                            <Button size="sm" variant="outline" className="w-full mt-2 text-xs gap-1"
                              onClick={() => selectShopifyProduct(p, mainImage || '')}>
                              {shopifySendMode === 'photo_only' ? 'Usar Foto' : 'Inserir Link'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
