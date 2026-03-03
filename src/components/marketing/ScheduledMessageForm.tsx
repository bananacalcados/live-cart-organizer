import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import { CalendarIcon, Sparkles, Loader2, Play, Upload, Link as LinkIcon, Variable, Save, FileText, Mic, Square } from "lucide-react";
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
import { EmojiPickerButton } from "@/components/EmojiPickerButton";

export interface ScheduledMessageData {
  messageType: string;
  messageContent: string;
  mediaUrl: string;
  pollOptions: string[];
  scheduledAt: Date;
  scheduledTime: string;
  sendSpeed: string;
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

export function ScheduledMessageForm({ open, onOpenChange, onSubmit, editingMessage, onUpdate, campaignId }: ScheduledMessageFormProps) {
  const [messageType, setMessageType] = useState("text");
  const [messageContent, setMessageContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaMode, setMediaMode] = useState<"url" | "upload">("url");
  const [pollOptions, setPollOptions] = useState(["", "", ""]);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(new Date());
  const [scheduledTime, setScheduledTime] = useState("12:00");
  const [sendSpeed, setSendSpeed] = useState("normal");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load editing message data
  useEffect(() => {
    if (editingMessage) {
      setMessageType(editingMessage.message_type);
      setMessageContent(editingMessage.message_content || "");
      setMediaUrl(editingMessage.media_url || "");
      setSendSpeed(editingMessage.send_speed || "normal");
      if (editingMessage.poll_options) {
        setPollOptions(Array.isArray(editingMessage.poll_options) ? editingMessage.poll_options : ["", "", ""]);
      }
      const d = new Date(editingMessage.scheduled_at);
      setScheduledDate(d);
      setScheduledTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } else {
      resetForm();
    }
  }, [editingMessage, open]);

  // Load templates
  useEffect(() => {
    if (open) fetchTemplates();
  }, [open]);

  const fetchTemplates = async () => {
    const { data } = await supabase.from('group_message_templates').select('*').order('created_at', { ascending: false });
    setTemplates((data || []) as MessageTemplate[]);
  };

  const resetForm = () => {
    setMessageContent(""); setMediaUrl(""); setAiPrompt("");
    setPollOptions(["", "", ""]); setMessageType("text");
    setMediaMode("url"); setTemplateName("");
  };

  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = messageContent;
    const insert = `{{${varName}}}`;
    setMessageContent(text.substring(0, start) + insert + text.substring(end));
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + insert.length, start + insert.length);
    }, 0);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) { toast.error("Arquivo muito grande (max 16MB)"); return; }
    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `group-messages/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('marketing-attachments').upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
      setMediaUrl(urlData.publicUrl);
      toast.success("Arquivo enviado!");
    } catch { toast.error("Erro no upload"); }
    finally { setIsUploading(false); }
  };

  const loadTemplate = (t: MessageTemplate) => {
    setMessageType(t.message_type);
    setMessageContent(t.message_content || "");
    setMediaUrl(t.media_url || "");
    if (t.poll_options) setPollOptions(Array.isArray(t.poll_options) ? t.poll_options : ["", "", ""]);
    setShowTemplates(false);
    toast.success("Modelo carregado!");
  };

  const saveAsTemplate = async () => {
    if (!templateName.trim()) { toast.error("Nome obrigatório"); return; }
    const { error } = await supabase.from('group_message_templates').insert({
      name: templateName.trim(),
      message_type: messageType,
      message_content: messageContent || null,
      media_url: mediaUrl || null,
      poll_options: messageType === 'poll' ? pollOptions.filter(o => o.trim()) : null,
    });
    if (error) { toast.error("Erro ao salvar modelo"); return; }
    toast.success("Modelo salvo!");
    setShowSaveTemplate(false);
    setTemplateName("");
    fetchTemplates();
  };

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
      if (content) { setMessageContent(content); toast.success("Texto gerado!"); }
      else toast.error("IA não retornou conteúdo");
    } catch { toast.error("Erro ao gerar"); }
    finally { setIsGenerating(false); }
  };

  const handleSubmit = async () => {
    if (!scheduledDate) { toast.error("Selecione uma data"); return; }
    if (!messageContent.trim() && messageType === 'text') { toast.error("Mensagem obrigatória"); return; }
    if (messageType === 'poll' && pollOptions.filter(o => o.trim()).length < 2) {
      toast.error("Enquete precisa de ao menos 2 opções"); return;
    }

    setIsSaving(true);
    try {
      const data: ScheduledMessageData = {
        messageType, messageContent, mediaUrl,
        pollOptions: pollOptions.filter(o => o.trim()),
        scheduledAt: scheduledDate, scheduledTime, sendSpeed,
      };
      if (editingMessage && onUpdate) {
        await onUpdate(editingMessage.id, data);
      } else {
        await onSubmit(data);
      }
      resetForm();
      onOpenChange(false);
    } catch { toast.error("Erro ao salvar"); }
    finally { setIsSaving(false); }
  };

  const acceptTypes: Record<string, string> = {
    image: "image/*",
    video: "video/*",
    audio: "audio/*",
    document: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingMessage ? "Editar Mensagem" : "Agendar Mensagem"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Templates buttons */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowTemplates(!showTemplates)}>
              <FileText className="h-3.5 w-3.5" /> Usar Modelo
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowSaveTemplate(true)}>
              <Save className="h-3.5 w-3.5" /> Salvar como Modelo
            </Button>
          </div>

          {/* Template list */}
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

          {/* Save template dialog */}
          {showSaveTemplate && (
            <div className="border rounded-lg p-3 space-y-2">
              <Input placeholder="Nome do modelo" value={templateName} onChange={e => setTemplateName(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveAsTemplate}>Salvar</Button>
                <Button size="sm" variant="outline" onClick={() => setShowSaveTemplate(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* Type */}
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={messageType} onValueChange={setMessageType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">📝 Texto</SelectItem>
                <SelectItem value="image">🖼️ Imagem</SelectItem>
                <SelectItem value="video">🎬 Vídeo</SelectItem>
                <SelectItem value="audio">🎵 Áudio</SelectItem>
                <SelectItem value="document">📄 Documento</SelectItem>
                <SelectItem value="poll">📊 Enquete</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Media URL or Upload */}
          {messageType !== 'text' && messageType !== 'poll' && (
            <div className="space-y-2">
              <Label className="text-xs">Mídia</Label>
              <div className="flex gap-2 mb-2">
                <Button variant={mediaMode === "url" ? "default" : "outline"} size="sm" className="gap-1"
                  onClick={() => setMediaMode("url")}>
                  <LinkIcon className="h-3.5 w-3.5" /> URL
                </Button>
                <Button variant={mediaMode === "upload" ? "default" : "outline"} size="sm" className="gap-1"
                  onClick={() => setMediaMode("upload")}>
                  <Upload className="h-3.5 w-3.5" /> Upload
                </Button>
              </div>
              {mediaMode === "url" ? (
                <Input placeholder="https://..." value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} />
              ) : (
                <div>
                  <input ref={fileInputRef} type="file" accept={acceptTypes[messageType] || "*/*"}
                    onChange={handleFileUpload} className="hidden" />
                  <Button variant="outline" className="w-full gap-1" onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}>
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {mediaUrl ? "Arquivo enviado ✓" : "Escolher arquivo"}
                  </Button>
                  {mediaUrl && <p className="text-[10px] text-muted-foreground mt-1 truncate">{mediaUrl}</p>}
                </div>
              )}
            </div>
          )}

          {/* Poll options */}
          {messageType === 'poll' && (
            <div className="space-y-2">
              <Label className="text-xs">Opções da Enquete</Label>
              {pollOptions.map((opt, i) => (
                <Input key={i} placeholder={`Opção ${i + 1}`} value={opt}
                  onChange={e => {
                    const next = [...pollOptions];
                    next[i] = e.target.value;
                    setPollOptions(next);
                  }} />
              ))}
              {pollOptions.length < 6 && (
                <Button variant="outline" size="sm" onClick={() => setPollOptions([...pollOptions, ""])}>
                  + Opção
                </Button>
              )}
            </div>
          )}

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

          {/* Message content */}
          <div>
            <Label className="text-xs">{messageType === 'poll' ? 'Pergunta da Enquete' : 'Texto da Mensagem'}</Label>
            <Textarea ref={textareaRef} value={messageContent} onChange={e => setMessageContent(e.target.value)} rows={4}
              placeholder={messageType === 'poll' ? 'Qual sua preferência?' : 'Texto da mensagem...'} />
          </div>

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
                  <Calendar mode="single" selected={scheduledDate} onSelect={setScheduledDate}
                    className={cn("p-3 pointer-events-auto")} />
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
                <SelectItem value="slow">🐢 Lento (8-15s) - Mais seguro</SelectItem>
                <SelectItem value="normal">⚡ Normal (3-8s)</SelectItem>
                <SelectItem value="fast">🚀 Rápido (1-3s) - Risco maior</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isSaving} className="gap-1">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {editingMessage ? "Salvar" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
