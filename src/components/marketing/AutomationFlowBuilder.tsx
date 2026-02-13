import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  Handle,
  Position,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Zap, Plus, Trash2, Save, ArrowLeft,
  MessageSquare, Clock, Users, ShoppingBag, CreditCard,
  FileText, Send, Timer, Loader2, RefreshCw, Tag,
  Brain, Reply, Image, Mic, Smile, Paperclip, PlayCircle,
  TestTube2, StopCircle, Volume2,
} from "lucide-react";
import EmojiPicker from "emoji-picker-react";

// ─── Types ──────────────────────────────────────

interface AutomationFlow {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: any;
  event_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface AutomationStep {
  id: string;
  flow_id: string;
  step_order: number;
  action_type: string;
  action_config: any;
  delay_seconds: number;
}

interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  components: any[];
}

// ─── Trigger / Action config ──────────────────────

const TRIGGER_TYPES = [
  { value: "new_lead", label: "Novo Lead", icon: Users, description: "Quando um lead se cadastra na landing page" },
  { value: "new_order", label: "Novo Pedido", icon: ShoppingBag, description: "Quando um pedido é criado" },
  { value: "stage_change", label: "Mudança de Estágio", icon: RefreshCw, description: "Quando o pedido muda de etapa" },
  { value: "payment_confirmed", label: "Pagamento Confirmado", icon: CreditCard, description: "Quando o pagamento é confirmado" },
];

const ACTION_TYPES = [
  { value: "send_template", label: "Template Meta", icon: FileText, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30", description: "Template oficial aprovado" },
  { value: "send_text", label: "Mensagem Livre", icon: MessageSquare, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30", description: "Texto, emoji, foto, áudio" },
  { value: "wait_for_reply", label: "Aguardar Resposta", icon: Reply, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-900/30", description: "Espera o lead responder" },
  { value: "ai_response", label: "Resposta IA", icon: Brain, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-900/30", description: "IA responde com prompt customizado" },
  { value: "add_tag", label: "Adicionar Tag", icon: Tag, color: "text-pink-600 dark:text-pink-400", bg: "bg-pink-100 dark:bg-pink-900/30", description: "Adiciona tag ao lead" },
  { value: "delay", label: "Aguardar Tempo", icon: Timer, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30", description: "Espera X minutos" },
];

// ─── Custom Nodes ──────────────────────────────────

function TriggerNode({ data }: { data: any }) {
  const trigger = TRIGGER_TYPES.find(t => t.value === data.triggerType);
  const Icon = trigger?.icon || Zap;
  return (
    <div className="bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-xl shadow-lg px-5 py-4 min-w-[220px] border-2 border-violet-400/50">
      <div className="flex items-center gap-2 mb-1">
        <div className="p-1.5 rounded-lg bg-white/20"><Icon className="h-4 w-4" /></div>
        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">Gatilho</span>
      </div>
      <p className="font-bold text-sm">{trigger?.label || data.triggerType}</p>
      {data.campaign_id && <p className="text-[10px] opacity-70 mt-1">Campanha: {data.campaign_id}</p>}
      <Handle type="source" position={Position.Bottom} className="!bg-white !w-3 !h-3 !border-2 !border-violet-400" />
    </div>
  );
}

function ActionNode({ data }: { data: any }) {
  const action = ACTION_TYPES.find(a => a.value === data.actionType);
  const Icon = action?.icon || Send;
  const isWait = data.actionType === "wait_for_reply";
  const isAi = data.actionType === "ai_response";
  const isDelay = data.actionType === "delay";
  const isTag = data.actionType === "add_tag";

  let borderClass = "border-border";
  let bgClass = "bg-card";
  if (isWait) { borderClass = "border-orange-300 dark:border-orange-700"; bgClass = "bg-orange-50 dark:bg-orange-950/30"; }
  if (isAi) { borderClass = "border-purple-300 dark:border-purple-700"; bgClass = "bg-purple-50 dark:bg-purple-950/30"; }
  if (isDelay) { borderClass = "border-amber-300 dark:border-amber-700"; bgClass = "bg-amber-50 dark:bg-amber-950/30"; }
  if (isTag) { borderClass = "border-pink-300 dark:border-pink-700"; bgClass = "bg-pink-50 dark:bg-pink-950/30"; }

  return (
    <div className={`rounded-xl shadow-lg px-5 py-4 min-w-[220px] border-2 ${borderClass} ${bgClass}`}>
      <Handle type="target" position={Position.Top} className="!bg-primary !w-3 !h-3 !border-2 !border-primary/50" />
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-lg ${action?.bg || "bg-primary/10"}`}>
          <Icon className={`h-4 w-4 ${action?.color || "text-primary"}`} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {action?.label || data.actionType}
        </span>
      </div>
      {data.actionType === "send_template" && data.templateName && (
        <p className="text-xs text-foreground mt-1 truncate max-w-[180px]">📋 {data.templateName}</p>
      )}
      {data.actionType === "send_text" && data.message && (
        <p className="text-xs text-foreground mt-1 truncate max-w-[180px]">💬 {data.message.slice(0, 40)}</p>
      )}
      {data.actionType === "send_text" && data.mediaUrl && (
        <p className="text-xs text-muted-foreground mt-0.5">📎 Mídia anexada</p>
      )}
      {isDelay && <p className="text-xs text-foreground mt-1">⏱ {data.minutes || 5} min</p>}
      {isWait && <p className="text-xs text-foreground mt-1">⏳ Aguarda resposta do lead</p>}
      {isAi && <p className="text-xs text-foreground mt-1 truncate max-w-[180px]">🤖 {data.promptPreview || "Prompt configurado"}</p>}
      {isTag && data.tags && <div className="flex flex-wrap gap-1 mt-1">{data.tags.map((t: string) => <Badge key={t} variant="secondary" className="text-[9px] px-1 py-0">{t}</Badge>)}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-3 !h-3 !border-2 !border-primary/50" />
    </div>
  );
}

const nodeTypes = { trigger: TriggerNode, action: ActionNode };

// ─── AI Test Dialog ──────────────────────────────────

function AiTestDialog({ open, onOpenChange, prompt }: { open: boolean; onOpenChange: (o: boolean) => void; prompt: string }) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMessages([]);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);

    try {
      const res = await supabase.functions.invoke("automation-ai-respond", {
        body: { prompt, messages: newMsgs },
      });
      if (res.error) throw new Error(res.error.message);
      const reply = res.data?.reply || "Sem resposta";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (err: any) {
      toast.error(err.message || "Erro ao testar IA");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TestTube2 className="h-5 w-5" />Simular IA da Automação</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground bg-muted p-2 rounded-lg">
          <strong>Prompt:</strong> {prompt.slice(0, 150)}{prompt.length > 150 ? "..." : ""}
        </p>
        <ScrollArea className="flex-1 min-h-[300px] border rounded-lg p-3" ref={scrollRef}>
          <div className="space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Envie uma mensagem como se fosse um lead para testar a IA
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            placeholder="Simule uma mensagem de lead..."
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={loading} size="sm">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Audio Recorder ──────────────────────────────────

function AudioRecorder({ onRecorded }: { onRecorded: (url: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [uploading, setUploading] = useState(false);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        setUploading(true);
        const fileName = `automation-audio-${Date.now()}.webm`;
        const { data, error } = await supabase.storage.from("chat-media").upload(fileName, blob, { contentType: "audio/webm" });
        setUploading(false);
        if (error) { toast.error("Erro ao enviar áudio"); return; }
        const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(fileName);
        onRecorded(urlData.publicUrl);
        toast.success("Áudio gravado!");
      };
      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  };

  const stop = () => {
    mediaRecorder?.stop();
    setRecording(false);
  };

  return (
    <div className="flex items-center gap-2">
      {recording ? (
        <Button variant="destructive" size="sm" onClick={stop} className="gap-1">
          <StopCircle className="h-3.5 w-3.5" />Parar
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={start} disabled={uploading} className="gap-1">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
          Gravar Áudio
        </Button>
      )}
      {recording && <span className="text-xs text-destructive animate-pulse flex items-center gap-1"><Volume2 className="h-3 w-3" />Gravando...</span>}
    </div>
  );
}

// ─── Step Editor Dialog ──────────────────────────────

function StepEditorDialog({
  open,
  onOpenChange,
  step,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  step: AutomationStep | null;
  onSave: (actionType: string, config: any, delaySecs: number) => void;
}) {
  const [actionType, setActionType] = useState("send_template");
  const [config, setConfig] = useState<any>({});
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [aiTestOpen, setAiTestOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step && open) {
      setActionType(step.action_type);
      setConfig(step.action_config || {});
    }
  }, [step, open]);

  useEffect(() => {
    if (open && actionType === "send_template" && templates.length === 0) {
      fetchTemplates();
    }
  }, [open, actionType]);

  const fetchTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await supabase.functions.invoke("meta-whatsapp-get-templates", { body: {} });
      if (res.data?.templates) {
        setTemplates(res.data.templates.filter((t: MetaTemplate) => t.status === "APPROVED"));
      }
    } catch { /* silent */ }
    setLoadingTemplates(false);
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop();
    const fileName = `automation-media-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("chat-media").upload(fileName, file);
    if (error) { toast.error("Erro ao enviar arquivo"); return; }
    const { data } = supabase.storage.from("chat-media").getPublicUrl(fileName);
    const mediaType = file.type.startsWith("image") ? "image" : file.type.startsWith("video") ? "video" : file.type.startsWith("audio") ? "audio" : "document";
    setConfig({ ...config, mediaUrl: data.publicUrl, mediaType });
    toast.success("Arquivo anexado!");
  };

  const addTag = () => {
    if (!tagInput.trim()) return;
    const tags = config.tags || [];
    if (!tags.includes(tagInput.trim())) {
      setConfig({ ...config, tags: [...tags, tagInput.trim()] });
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setConfig({ ...config, tags: (config.tags || []).filter((t: string) => t !== tag) });
  };

  const delaySecs = actionType === "delay" ? (config.minutes || 5) * 60 : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurar Etapa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Ação</Label>
              <Select value={actionType} onValueChange={v => { setActionType(v); setConfig({}); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map(a => (
                    <SelectItem key={a.value} value={a.value}>
                      <span className="flex items-center gap-2">
                        <a.icon className={`h-3.5 w-3.5 ${a.color}`} />{a.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ── SEND TEMPLATE ── */}
            {actionType === "send_template" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Template Aprovado</Label>
                  {loadingTemplates ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando templates...</div>
                  ) : (
                    <Select value={config.templateName || ""} onValueChange={v => {
                      const tpl = templates.find(t => t.name === v);
                      setConfig({ ...config, templateName: v, language: tpl?.language || "pt_BR" });
                    }}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                      <SelectContent>
                        {templates.map(t => (
                          <SelectItem key={t.name} value={t.name}>
                            <span className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[9px]">{t.category}</Badge>
                              {t.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {config.templateName && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs font-medium mb-1">Preview do Template:</p>
                    {(() => {
                      const tpl = templates.find(t => t.name === config.templateName);
                      const body = tpl?.components?.find((c: any) => c.type === "BODY");
                      return <p className="text-xs text-muted-foreground">{body?.text || "—"}</p>;
                    })()}
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={fetchTemplates} className="gap-1">
                  <RefreshCw className="h-3 w-3" />Atualizar lista
                </Button>
              </div>
            )}

            {/* ── SEND TEXT (rich) ── */}
            {actionType === "send_text" && (
              <div className="space-y-3">
                <div className="space-y-1 relative">
                  <Label className="text-xs">Mensagem</Label>
                  <Textarea
                    value={config.message || ""}
                    onChange={e => setConfig({ ...config, message: e.target.value })}
                    placeholder="Olá! Obrigado pelo cadastro 😊"
                    rows={4}
                  />
                  <div className="flex items-center gap-1 mt-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowEmoji(!showEmoji)}>
                      <Smile className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fileInputRef.current?.click()}>
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" className="hidden" onChange={handleMediaUpload} />
                  </div>
                  {showEmoji && (
                    <div className="absolute z-50 bottom-12">
                      <EmojiPicker
                        onEmojiClick={(emoji) => {
                          setConfig({ ...config, message: (config.message || "") + emoji.emoji });
                          setShowEmoji(false);
                        }}
                        width={300}
                        height={350}
                      />
                    </div>
                  )}
                </div>

                {/* Audio recorder */}
                <AudioRecorder onRecorded={(url) => setConfig({ ...config, mediaUrl: url, mediaType: "audio" })} />

                {config.mediaUrl && (
                  <div className="flex items-center gap-2 p-2 bg-muted rounded-lg text-xs">
                    <Paperclip className="h-3.5 w-3.5" />
                    <span className="truncate flex-1">{config.mediaType}: {config.mediaUrl.split('/').pop()}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setConfig({ ...config, mediaUrl: undefined, mediaType: undefined })}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground">
                  Variáveis: {"{{nome}}"}, {"{{telefone}}"}, {"{{email}}"}
                </p>
              </div>
            )}

            {/* ── WAIT FOR REPLY ── */}
            {actionType === "wait_for_reply" && (
              <div className="space-y-3">
                <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg border border-orange-200 dark:border-orange-800">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    <Reply className="h-3.5 w-3.5 inline mr-1" />
                    O fluxo pausa aqui e só continua quando o lead responder. A próxima ação será executada após a resposta.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Timeout (horas)</Label>
                  <Input
                    type="number"
                    value={config.timeoutHours || 24}
                    onChange={e => setConfig({ ...config, timeoutHours: parseInt(e.target.value) || 24 })}
                    className="h-9"
                    min={1}
                  />
                  <p className="text-[10px] text-muted-foreground">Se o lead não responder nesse tempo, o fluxo é cancelado.</p>
                </div>
              </div>
            )}

            {/* ── AI RESPONSE ── */}
            {actionType === "ai_response" && (
              <div className="space-y-3">
                <div className="p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800">
                  <p className="text-xs text-purple-700 dark:text-purple-300">
                    <Brain className="h-3.5 w-3.5 inline mr-1" />
                    A IA responde automaticamente com base no prompt configurado. Ideal para responder dúvidas dos leads.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Prompt da IA</Label>
                  <Textarea
                    value={config.prompt || ""}
                    onChange={e => setConfig({ ...config, prompt: e.target.value })}
                    placeholder="Você é a assistente da Banana Calçados. Responda dúvidas sobre nosso evento de calçados ortopédicos dos dias 19, 20 e 21. Seja simpática e objetiva. Se perguntarem preço, diga que os valores serão revelados no dia do evento..."
                    rows={6}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Máx. de interações por lead</Label>
                  <Input
                    type="number"
                    value={config.maxInteractions || 5}
                    onChange={e => setConfig({ ...config, maxInteractions: parseInt(e.target.value) || 5 })}
                    className="h-9"
                    min={1}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAiTestOpen(true)}
                  disabled={!config.prompt}
                  className="gap-1"
                >
                  <TestTube2 className="h-3.5 w-3.5" />Simular Conversa com IA
                </Button>
              </div>
            )}

            {/* ── ADD TAG ── */}
            {actionType === "add_tag" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tags para adicionar</Label>
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())}
                      placeholder="Ex: vip, engajado, interessado"
                      className="h-9 flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={addTag}>+</Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(config.tags || []).map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                        {tag}
                        <button onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive">×</button>
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Condição (opcional)</Label>
                  <Select value={config.condition || "always"} onValueChange={v => setConfig({ ...config, condition: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">Sempre</SelectItem>
                      <SelectItem value="on_reply">Quando o lead responder</SelectItem>
                      <SelectItem value="on_click">Quando clicar no link</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* ── DELAY ── */}
            {actionType === "delay" && (
              <div className="space-y-1">
                <Label className="text-xs">Tempo de espera (minutos)</Label>
                <Input
                  type="number"
                  value={config.minutes || 5}
                  onChange={e => setConfig({ ...config, minutes: parseInt(e.target.value) || 0 })}
                  className="h-9"
                  min={1}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => { onSave(actionType, config, delaySecs); onOpenChange(false); }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AiTestDialog open={aiTestOpen} onOpenChange={setAiTestOpen} prompt={config.prompt || ""} />
    </>
  );
}

// ─── Flow Editor ──────────────────────────────────

function FlowEditor({
  flow,
  onBack,
  onSave,
}: {
  flow: AutomationFlow;
  onBack: () => void;
  onSave: () => void;
}) {
  const [steps, setSteps] = useState<AutomationStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flowName, setFlowName] = useState(flow.name);
  const [triggerType, setTriggerType] = useState(flow.trigger_type);
  const [triggerConfig, setTriggerConfig] = useState<any>(flow.trigger_config || {});
  const [isActive, setIsActive] = useState(flow.is_active);
  const [editingStep, setEditingStep] = useState<AutomationStep | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => { fetchSteps(); }, [flow.id]);

  const fetchSteps = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("automation_steps")
      .select("*")
      .eq("flow_id", flow.id)
      .order("step_order");
    setSteps((data || []) as AutomationStep[]);
    setLoading(false);
  };

  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [
      {
        id: "trigger",
        type: "trigger",
        position: { x: 250, y: 50 },
        data: { triggerType, ...triggerConfig },
        draggable: true,
      },
    ];
    const edges: Edge[] = [];

    steps.forEach((step, idx) => {
      const nodeId = `step-${step.id}`;
      const cfg = (step.action_config || {}) as any;
      nodes.push({
        id: nodeId,
        type: "action",
        position: { x: 250, y: 180 + idx * 150 },
        data: {
          actionType: step.action_type,
          order: idx + 1,
          delaySeconds: step.delay_seconds,
          minutes: cfg.minutes,
          templateName: cfg.templateName,
          message: cfg.message,
          mediaUrl: cfg.mediaUrl,
          tags: cfg.tags,
          promptPreview: cfg.prompt?.slice(0, 40),
        },
        draggable: true,
      });
      edges.push({
        id: `e-${idx}`,
        source: idx === 0 ? "trigger" : `step-${steps[idx - 1].id}`,
        target: nodeId,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      });
    });
    return { initialNodes: nodes, initialEdges: edges };
  }, [steps, triggerType, triggerConfig]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges(eds => addEdge({ ...conn, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
  }, []);

  const handleNodeClick = useCallback((_: any, node: Node) => {
    if (node.type === "action") {
      const stepId = node.id.replace("step-", "");
      const step = steps.find(s => s.id === stepId);
      if (step) {
        setEditingStep(step);
        setEditDialogOpen(true);
      }
    }
  }, [steps]);

  const addStep = async (actionType: string) => {
    const order = steps.length + 1;
    const defaultConfig: any = actionType === "delay" ? { minutes: 5 } : actionType === "wait_for_reply" ? { timeoutHours: 24 } : actionType === "ai_response" ? { prompt: "", maxInteractions: 5 } : actionType === "add_tag" ? { tags: [], condition: "always" } : {};
    const delaySecs = actionType === "delay" ? 300 : 0;
    const { error } = await supabase.from("automation_steps").insert({
      flow_id: flow.id,
      step_order: order,
      action_type: actionType,
      action_config: defaultConfig,
      delay_seconds: delaySecs,
    });
    if (error) { toast.error("Erro ao adicionar etapa"); return; }
    fetchSteps();
  };

  const handleStepSave = async (actionType: string, config: any, delaySecs: number) => {
    if (!editingStep) return;
    const { error } = await supabase
      .from("automation_steps")
      .update({ action_type: actionType, action_config: config, delay_seconds: delaySecs })
      .eq("id", editingStep.id);
    if (error) { toast.error("Erro ao atualizar"); return; }
    fetchSteps();
  };

  const deleteStep = async (id: string) => {
    await supabase.from("automation_steps").delete().eq("id", id);
    fetchSteps();
  };

  const saveFlow = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("automation_flows")
      .update({ name: flowName, trigger_type: triggerType, trigger_config: triggerConfig, is_active: isActive })
      .eq("id", flow.id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar"); return; }
    toast.success("Automação salva!");
    onSave();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-3 border-b border-border bg-muted/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" />Voltar
        </Button>
        <Input value={flowName} onChange={e => setFlowName(e.target.value)} className="max-w-[250px] h-8 font-semibold" />
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">{isActive ? "Ativa" : "Inativa"}</span>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          <Button size="sm" onClick={saveFlow} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[270px] border-r border-border bg-muted/20 flex flex-col">
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-4">
              {/* Trigger config */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Gatilho</Label>
                <Select value={triggerType} onValueChange={setTriggerType}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  {TRIGGER_TYPES.find(t => t.value === triggerType)?.description}
                </p>
                {triggerType === "new_lead" && (
                  <div className="space-y-1">
                    <Label className="text-xs">ID da Campanha</Label>
                    <Input value={triggerConfig.campaign_id || ""} onChange={e => setTriggerConfig({ ...triggerConfig, campaign_id: e.target.value })} placeholder="banana-verao-2025" className="h-8 text-xs" />
                  </div>
                )}
                {triggerType === "stage_change" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Para estágio</Label>
                    <Input value={triggerConfig.to_stage || ""} onChange={e => setTriggerConfig({ ...triggerConfig, to_stage: e.target.value })} placeholder="confirmed" className="h-8 text-xs" />
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Adicionar Ação</Label>
                {ACTION_TYPES.map(a => {
                  const Icon = a.icon;
                  return (
                    <button key={a.value} onClick={() => addStep(a.value)} className="w-full flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent text-left transition-colors">
                      <div className={`p-1 rounded ${a.bg}`}><Icon className={`h-3.5 w-3.5 ${a.color}`} /></div>
                      <div>
                        <p className="text-xs font-medium">{a.label}</p>
                        <p className="text-[10px] text-muted-foreground">{a.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {steps.length > 0 && (
                <div className="border-t border-border pt-3 space-y-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase">Etapas ({steps.length})</Label>
                  {steps.map(s => {
                    const a = ACTION_TYPES.find(a => a.value === s.action_type);
                    const Icon = a?.icon || Send;
                    return (
                      <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border text-xs">
                        <Icon className={`h-3.5 w-3.5 ${a?.color || "text-primary"} shrink-0`} />
                        <span className="flex-1 truncate">{a?.label || s.action_type}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteStep(s.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Canvas */}
        <div className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              nodeTypes={nodeTypes}
              fitView
              className="bg-muted/10"
            >
              <Controls />
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            </ReactFlow>
          )}
        </div>
      </div>

      <StepEditorDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        step={editingStep}
        onSave={handleStepSave}
      />
    </div>
  );
}

// ─── Main Component: Flow List ──────────────────────

export function AutomationFlowBuilder() {
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlow, setSelectedFlow] = useState<AutomationFlow | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTrigger, setNewTrigger] = useState("new_lead");

  const fetchFlows = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("automation_flows").select("*").order("created_at", { ascending: false });
    setFlows((data || []) as AutomationFlow[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchFlows(); }, [fetchFlows]);

  const createFlow = async () => {
    if (!newName.trim()) { toast.error("Nome é obrigatório"); return; }
    const { data, error } = await supabase.from("automation_flows").insert({ name: newName, trigger_type: newTrigger }).select().single();
    if (error) { toast.error("Erro ao criar"); return; }
    setCreateDialogOpen(false);
    setNewName("");
    fetchFlows();
    setSelectedFlow(data as AutomationFlow);
  };

  const deleteFlow = async (id: string) => {
    await supabase.from("automation_steps").delete().eq("flow_id", id);
    await supabase.from("automation_flows").delete().eq("id", id);
    fetchFlows();
    toast.success("Automação excluída");
  };

  const toggleActive = async (flow: AutomationFlow) => {
    await supabase.from("automation_flows").update({ is_active: !flow.is_active }).eq("id", flow.id);
    fetchFlows();
  };

  if (selectedFlow) {
    return <FlowEditor flow={selectedFlow} onBack={() => { setSelectedFlow(null); fetchFlows(); }} onSave={fetchFlows} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Crie automações de disparo por gatilhos com IA, templates e mensagens ricas.</p>
        <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1"><Plus className="h-3.5 w-3.5" />Nova Automação</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : flows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Zap className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhuma automação criada</p>
            <p className="text-xs mt-1">Crie um fluxo para disparar mensagens automaticamente</p>
            <Button size="sm" className="mt-3 gap-1" onClick={() => setCreateDialogOpen(true)}><Plus className="h-3.5 w-3.5" />Criar primeira automação</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {flows.map(flow => {
            const trigger = TRIGGER_TYPES.find(t => t.value === flow.trigger_type);
            const TriggerIcon = trigger?.icon || Zap;
            return (
              <Card key={flow.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedFlow(flow)}>
                <CardContent className="flex items-center gap-4 py-4">
                  <div className={`p-2.5 rounded-xl ${flow.is_active ? "bg-primary/10" : "bg-muted"}`}>
                    <TriggerIcon className={`h-5 w-5 ${flow.is_active ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{flow.name}</p>
                      <Badge variant={flow.is_active ? "default" : "secondary"} className="text-[10px]">{flow.is_active ? "Ativa" : "Inativa"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{trigger?.label} → {flow.description || "Sem descrição"}</p>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <Switch checked={flow.is_active} onCheckedChange={() => toggleActive(flow)} />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteFlow(flow.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5" />Nova Automação</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Boas-vindas Lead LP" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Gatilho</Label>
              <Select value={newTrigger} onValueChange={setNewTrigger}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{TRIGGER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">{TRIGGER_TYPES.find(t => t.value === newTrigger)?.description}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancelar</Button>
            <Button onClick={createFlow}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
