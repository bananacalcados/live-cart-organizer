import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Sparkles, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface ScheduledMessageFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ScheduledMessageData) => Promise<void>;
}

export interface ScheduledMessageData {
  messageType: string;
  messageContent: string;
  mediaUrl: string;
  pollOptions: string[];
  scheduledAt: Date;
  scheduledTime: string;
  sendSpeed: string;
}

export function ScheduledMessageForm({ open, onOpenChange, onSubmit }: ScheduledMessageFormProps) {
  const [messageType, setMessageType] = useState("text");
  const [messageContent, setMessageContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [pollOptions, setPollOptions] = useState(["", "", ""]);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(new Date());
  const [scheduledTime, setScheduledTime] = useState("12:00");
  const [sendSpeed, setSendSpeed] = useState("normal");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
      await onSubmit({
        messageType,
        messageContent,
        mediaUrl,
        pollOptions: pollOptions.filter(o => o.trim()),
        scheduledAt: scheduledDate,
        scheduledTime,
        sendSpeed,
      });
      // Reset form
      setMessageContent(""); setMediaUrl(""); setAiPrompt("");
      setPollOptions(["", "", ""]); setMessageType("text");
      onOpenChange(false);
    } catch { toast.error("Erro ao salvar"); }
    finally { setIsSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agendar Mensagem</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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

          {/* Media URL */}
          {messageType !== 'text' && messageType !== 'poll' && (
            <div>
              <Label className="text-xs">URL da Mídia</Label>
              <Input placeholder="https://..." value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} />
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

          {/* Message content */}
          <div>
            <Label className="text-xs">{messageType === 'poll' ? 'Pergunta da Enquete' : 'Texto da Mensagem'}</Label>
            <Textarea value={messageContent} onChange={e => setMessageContent(e.target.value)} rows={4}
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
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
