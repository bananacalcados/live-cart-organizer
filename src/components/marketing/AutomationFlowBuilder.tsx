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
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
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
  TestTube2, StopCircle, Volume2, GitBranch, AlertTriangle,
  ShoppingCart, Sparkles, Package, ExternalLink, LayoutGrid,
  ChevronDown, ChevronUp, Filter, MapPin,
  Bookmark, Gift, Copy, Search, Monitor,
} from "lucide-react";
import EmojiPicker from "emoji-picker-react";
import { fetchProducts, type ShopifyProduct } from "@/lib/shopify";
import { ImageCropDialog } from "@/components/ImageCropDialog";

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
  use_jess_agent?: boolean;
  jess_campaign_name?: string | null;
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
  { value: "mass_audience", label: "Disparo por Audiência", icon: Users, description: "Selecione leads, clientes CRM ou segmentos RFM para disparo em massa" },
  { value: "new_lead", label: "Novo Lead", icon: Users, description: "Quando um lead se cadastra na landing page" },
  { value: "incoming_message", label: "Mensagem Recebida", icon: MessageSquare, description: "Quando um cliente manda mensagem (com proteção anti-conflito)" },
  { value: "new_order", label: "Novo Pedido", icon: ShoppingBag, description: "Quando um pedido é criado no CRM" },
  { value: "stage_change", label: "Mudança de Estágio", icon: RefreshCw, description: "Quando o pedido muda de etapa" },
  { value: "payment_confirmed", label: "Pagamento Confirmado", icon: CreditCard, description: "Quando o pagamento é confirmado" },
  { value: "shopify_purchase", label: "Compra Shopify", icon: ShoppingCart, description: "Quando alguém finaliza uma compra na Shopify" },
  { value: "pos_sale_completed", label: "Venda Loja Física (POS)", icon: ShoppingBag, description: "Quando uma venda é concluída na loja física (cashback, reativação)" },
  { value: "yampi_abandoned_cart", label: "Carrinho Abandonado (Yampi)", icon: Package, description: "Quando um carrinho é abandonado na Yampi" },
  { value: "event_lead_captured", label: "Lead Capturado (LP/Typebot do Evento)", icon: Users, description: "Quando alguém se cadastra em uma LP ou Typebot de um evento. Variáveis extras: {{link_indicacao}}, {{link_grupo_vip}}, {{nome_indicador}}" },
  { value: "event_referral_milestone_3", label: "3 Indicações Atingidas (Evento)", icon: Gift, description: "Quando um lead indica 3 amigos e libera o prêmio" },
];

const ACTION_TYPES = [
  { value: "send_template", label: "Template Meta", icon: FileText, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30", description: "Template oficial aprovado" },
  { value: "send_text", label: "Mensagem Livre", icon: MessageSquare, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30", description: "Texto, emoji, foto, áudio" },
  { value: "ai_crosssell", label: "Cross-sell IA", icon: Sparkles, color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-900/30", description: "IA sugere produto + link Yampi direto" },
  { value: "wait_for_reply", label: "Aguardar Resposta", icon: Reply, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-900/30", description: "Espera o lead responder (com bifurcação)" },
  { value: "ai_response", label: "Resposta IA", icon: Brain, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-900/30", description: "IA responde com prompt customizado" },
  { value: "add_tag", label: "Adicionar Tag", icon: Tag, color: "text-pink-600 dark:text-pink-400", bg: "bg-pink-100 dark:bg-pink-900/30", description: "Adiciona tag ao lead" },
  { value: "delay", label: "Aguardar Tempo", icon: Timer, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30", description: "Espera tempo configurável" },
];

// Customer data variables for template mapping
const CUSTOMER_VARIABLES = [
  { value: "{{nome}}", label: "Nome do Cliente" },
  { value: "{{telefone}}", label: "Telefone" },
  { value: "{{email}}", label: "E-mail" },
  { value: "{{instagram}}", label: "Instagram" },
  { value: "{{cidade}}", label: "Cidade" },
  { value: "{{pedido_total}}", label: "Total do Pedido" },
  { value: "{{produtos}}", label: "Lista de Produtos" },
  { value: "{{link_carrinho}}", label: "Link do Carrinho" },
  { value: "{{cupom}}", label: "Código do Cupom" },
  { value: "{{numero_pedido}}", label: "Número do Pedido" },
  { value: "{{codigo_rastreio}}", label: "Código de Rastreio" },
  { value: "{{transportadora}}", label: "Transportadora" },
  { value: "{{nome_cliente}}", label: "🛍️ POS: Nome do Cliente" },
  { value: "{{primeiro_nome}}", label: "🛍️ POS: Primeiro Nome" },
  { value: "{{nome_vendedora}}", label: "🛍️ POS: Nome da Vendedora" },
  { value: "{{loja}}", label: "🛍️ POS: Loja" },
  { value: "{{valor_compra}}", label: "🛍️ POS: Valor da Compra" },
  { value: "{{valor_cashback}}", label: "🛍️ POS: Valor do Cashback" },
  { value: "{{codigo_cashback}}", label: "🛍️ POS: Código do Cashback" },
  { value: "{{compra_minima}}", label: "🛍️ POS: Compra Mínima Cashback" },
  { value: "{{validade_cashback}}", label: "🛍️ POS: Validade do Cashback" },
];

// Dynamic field options (pulled from lead/customer data at send time)
const DYNAMIC_FIELD_OPTIONS = [
  { value: "__first_name__", label: "👤 Primeiro Nome", description: "Extrai o primeiro nome do lead/cliente" },
  { value: "__full_name__", label: "👤 Nome Completo", description: "Nome completo do lead/cliente" },
  { value: "__phone__", label: "📱 Telefone", description: "Número de telefone" },
  { value: "__email__", label: "📧 E-mail", description: "E-mail do lead/cliente" },
  { value: "__city__", label: "🏙️ Cidade", description: "Cidade do cliente" },
  { value: "__state__", label: "📍 Estado", description: "Estado/UF do cliente" },
  { value: "__rfm_segment__", label: "📊 Segmento RFM", description: "Segmento RFM (Campeão, Em Risco, etc.)" },
  { value: "__instagram__", label: "📸 Instagram", description: "Handle do Instagram" },
  { value: "__last_purchase__", label: "🛍️ Última Compra", description: "Data da última compra" },
];

// ─── Custom Nodes ──────────────────────────────────

function TriggerNode({ data }: { data: any }) {
  const trigger = TRIGGER_TYPES.find(t => t.value === data.triggerType);
  const Icon = trigger?.icon || Zap;
  const isMassAudience = data.triggerType === "mass_audience";
  const source = data.audience_source;
  return (
    <div className="bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-xl shadow-lg px-5 py-4 min-w-[220px] border-2 border-violet-400/50">
      <div className="flex items-center gap-2 mb-1">
        <div className="p-1.5 rounded-lg bg-white/20"><Icon className="h-4 w-4" /></div>
        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">Gatilho</span>
      </div>
      <p className="font-bold text-sm">{trigger?.label || data.triggerType}</p>
      {isMassAudience && source && (
        <p className="text-[10px] opacity-80 mt-0.5">
          {source === "rfm" ? "📊 Clientes RFM" : source === "leads" ? "📋 Leads" : source === "crm" ? "👥 CRM" : "📋+📊 Leads + RFM"}
          {data.audience_rfm_segments?.length > 0 && ` · ${data.audience_rfm_segments.length} seg.`}
          {data.audience_states?.length > 0 && ` · ${data.audience_states.join(",")}`}
          {data.audience_campaigns?.length > 0 && ` · ${data.audience_campaigns.length} camp.`}
          {data.audience_rfm_preset_keys?.length > 0 && ` · 🔖 ${data.audience_rfm_preset_keys.length} filtro(s)`}
          {data.audience_cooldown_days > 0 && ` · ⏱ cooldown ${data.audience_cooldown_days}d`}
        </p>
      )}
      {!isMassAudience && data.campaign_id && <p className="text-[10px] opacity-70 mt-1">Campanha: {data.campaign_id}</p>}
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
  const isCrossSell = data.actionType === "ai_crosssell";
  const isTemplate = data.actionType === "send_template";
  const isSendText = data.actionType === "send_text";
  const quickReplyButtons: string[] = data.quickReplyButtons || [];
  const interactiveButtons: string[] = data.interactiveButtons || [];
  const branchButtons: string[] = isTemplate ? quickReplyButtons : (isSendText ? interactiveButtons : []);
  const hasButtonBranches = branchButtons.length > 0;

  let borderClass = "border-border";
  let bgClass = "bg-card";
  if (isWait) { borderClass = "border-orange-300 dark:border-orange-700"; bgClass = "bg-orange-50 dark:bg-orange-950/30"; }
  if (isAi) { borderClass = "border-purple-300 dark:border-purple-700"; bgClass = "bg-purple-50 dark:bg-purple-950/30"; }
  if (isDelay) { borderClass = "border-amber-300 dark:border-amber-700"; bgClass = "bg-amber-50 dark:bg-amber-950/30"; }
  if (isTag) { borderClass = "border-pink-300 dark:border-pink-700"; bgClass = "bg-pink-50 dark:bg-pink-950/30"; }
  if (isCrossSell) { borderClass = "border-yellow-300 dark:border-yellow-700"; bgClass = "bg-yellow-50 dark:bg-yellow-950/30"; }

  return (
    <div className={`rounded-xl shadow-lg px-5 py-4 min-w-[220px] border-2 ${borderClass} ${bgClass} group relative`}>
      <Handle type="target" position={Position.Top} className="!bg-primary !w-3 !h-3 !border-2 !border-primary/50" />
      {data.onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
          className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:scale-110"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-lg ${action?.bg || "bg-primary/10"}`}>
          <Icon className={`h-4 w-4 ${action?.color || "text-primary"}`} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {action?.label || data.actionType}
        </span>
      </div>
      {isTemplate && data.templateName && (
        <p className="text-xs text-foreground mt-1 truncate max-w-[180px]">📋 {data.templateName}</p>
      )}
      {isTemplate && data.headerMediaUrl && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-0.5">📎 Header com mídia</p>
      )}
      {isTemplate && data.carouselCards && Object.keys(data.carouselCards).length > 0 && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-0.5"><LayoutGrid className="h-2.5 w-2.5" />Carrossel: {Object.keys(data.carouselCards).length} cards</p>
      )}
      {isTemplate && data.templateVars && Object.keys(data.templateVars).length > 0 && (
        <p className="text-[10px] text-muted-foreground">📝 {Object.keys(data.templateVars).length} variáveis</p>
      )}
      {data.actionType === "send_text" && data.message && (
        <p className="text-xs text-foreground mt-1 truncate max-w-[180px]">💬 {data.message.slice(0, 40)}</p>
      )}
      {data.actionType === "send_text" && data.mediaUrl && (
        <p className="text-xs text-muted-foreground mt-0.5">📎 Mídia anexada</p>
      )}
      {isDelay && (
        <div className="mt-1">
          <p className="text-xs text-foreground">⏱ {data.delayValue || data.minutes || 5} {data.delayUnit === "hours" ? "hora(s)" : data.delayUnit === "days" ? "dia(s)" : "min"}</p>
          {data.hasDeadline && data.deadline && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5">🚫 Limite: {new Date(data.deadline).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          )}
        </div>
      )}
      {isWait && (
        <div className="mt-1">
          <p className="text-xs text-foreground">⏳ Aguarda resposta</p>
          {data.timeoutAction && data.timeoutAction !== "cancel" && (
            <p className="text-[10px] text-orange-500 flex items-center gap-0.5"><GitBranch className="h-2.5 w-2.5" />Bifurcação: {data.timeoutAction === "send_template" ? "Template" : data.timeoutAction === "send_text" ? "Mensagem" : data.timeoutAction === "add_tag" ? "Tag" : "Cancelar"}</p>
          )}
        </div>
      )}
      {isAi && <p className="text-xs text-foreground mt-1 truncate max-w-[180px]">🤖 {data.promptPreview || "Prompt configurado"}</p>}
      {isCrossSell && (
        <div className="mt-1">
          <p className="text-xs text-foreground">✨ Cross-sell IA</p>
          {data.productPool && <p className="text-[10px] text-muted-foreground">{data.productPool.length} produto(s) no pool</p>}
        </div>
      )}
      {isTag && data.tags && <div className="flex flex-wrap gap-1 mt-1">{data.tags.map((t: string) => <Badge key={t} variant="secondary" className="text-[9px] px-1 py-0">{t}</Badge>)}</div>}
      
      {/* Button branches: show each quick reply as a labeled output handle on the RIGHT side aligned with its row */}
      {hasButtonBranches ? (
        <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1"><GitBranch className="h-2.5 w-2.5" />Caminhos por botão:</p>
          {branchButtons.map((btnText, i) => (
            <div key={i} className="relative flex items-center justify-between gap-1 pr-2">
              <Badge variant="outline" className="text-[9px]">↩️ {btnText}</Badge>
              <Handle
                type="source"
                position={Position.Right}
                id={`btn-${i}`}
                className="!bg-blue-500 !w-3 !h-3 !border-2 !border-blue-300"
                style={{ top: "50%" }}
              />
            </div>
          ))}
          {isTemplate && (
            <div className="relative flex items-center justify-between gap-1 pr-2">
              <Badge variant="secondary" className="text-[9px]">⏳ Sem resposta</Badge>
              <Handle
                type="source"
                position={Position.Right}
                id="btn-timeout"
                className="!bg-orange-500 !w-3 !h-3 !border-2 !border-orange-300"
                style={{ top: "50%" }}
              />
            </div>
          )}
        </div>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-primary !w-3 !h-3 !border-2 !border-primary/50" />
      )}
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
      const { getAudioMimeType, getAudioExtension, getAudioContentType } = await import('@/lib/audioRecorder');
      const mimeType = getAudioMimeType();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const ct = getAudioContentType(mimeType);
        const ext = getAudioExtension(mimeType);
        const blob = new Blob(chunks, { type: ct });
        setUploading(true);
        const fileName = `automation-audio-${Date.now()}.${ext}`;
        const { data, error } = await supabase.storage.from("chat-media").upload(fileName, blob, { contentType: ct });
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

// ─── AI Instance Multi-Selector ──────────────────────

function AiInstanceSelector({ config, setConfig, whatsappNumbers, loadingNumbers }: {
  config: any;
  setConfig: (c: any) => void;
  whatsappNumbers: any[];
  loadingNumbers: boolean;
}) {
  const selectedIds: string[] = config.whatsappNumberIds || (config.whatsappNumberId ? [config.whatsappNumberId] : []);
  const includeZapi = config.includeZapi || false;

  const allInstances = [
    { id: 'zapi', label: 'Z-API', type: 'zapi' as const },
    ...whatsappNumbers.map(n => ({ id: n.id, label: n.label || n.phone_display, type: 'meta' as const })),
  ];

  const toggleInstance = (id: string) => {
    if (id === 'zapi') {
      setConfig({ ...config, includeZapi: !includeZapi });
      return;
    }
    const current = [...selectedIds];
    const idx = current.indexOf(id);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(id);
    setConfig({ ...config, whatsappNumberIds: current, whatsappNumberId: current[0] || null });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">Instâncias WhatsApp (para enviar resposta)</Label>
      {loadingNumbers ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando...</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {allInstances.map(inst => {
            const isSelected = inst.id === 'zapi' ? includeZapi : selectedIds.includes(inst.id);
            return (
              <Badge
                key={inst.id}
                variant={isSelected ? "default" : "outline"}
                className="cursor-pointer text-[10px] px-2 py-0.5"
                onClick={() => toggleInstance(inst.id)}
              >
                {inst.type === 'zapi' ? '📱' : '☁️'} {inst.label}
              </Badge>
            );
          })}
        </div>
      )}
      {(selectedIds.length > 0 || includeZapi) && (
        <p className="text-[10px] text-muted-foreground">
          {(includeZapi ? 1 : 0) + selectedIds.length} instância(s) selecionada(s) — a IA responderá pela mesma instância que recebeu a mensagem
        </p>
      )}
    </div>
  );
}

// ─── Step Editor Dialog ──────────────────────────────

function StepEditorDialog({
  open,
  onOpenChange,
  step,
  allSteps = [],
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  step: AutomationStep | null;
  allSteps?: AutomationStep[];
  onSave: (actionType: string, config: any, delaySecs: number) => void;
}) {
  const [actionType, setActionType] = useState("send_template");
  const [config, setConfig] = useState<any>({});
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [expandedCarouselCard, setExpandedCarouselCard] = useState<number | null>(0);
  const [aiTestOpen, setAiTestOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headerFileRef = useRef<HTMLInputElement>(null);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const cardFileRef = useRef<HTMLInputElement>(null);
  const [uploadingCard, setUploadingCard] = useState<number | null>(null);
  const [pcUploadTargetCard, setPcUploadTargetCard] = useState<number | null>(null);
  const [showShopifyPicker, setShowShopifyPicker] = useState(false);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProduct[]>([]);
  const [shopifySearch, setShopifySearch] = useState("");
  const [loadingShopify, setLoadingShopify] = useState(false);
  const [shopifyTargetCard, setShopifyTargetCard] = useState<number | null>(null);
  // Image cropper (1:1 thumbnail) state
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropTargetCard, setCropTargetCard] = useState<number | null>(null);
  const [cropUploading, setCropUploading] = useState(false);
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);

  useEffect(() => {
    if (open) {
      loadWhatsappNumbers();
    }
  }, [open]);

  const loadWhatsappNumbers = async () => {
    setLoadingNumbers(true);
    const { data } = await supabase
      .from('whatsapp_numbers_safe')
      .select('id, label, phone_display, provider, is_default')
      .eq('is_active', true)
      .eq('provider', 'meta');
    setWhatsappNumbers(data || []);
    setLoadingNumbers(false);
  };

  useEffect(() => {
    if (step && open) {
      setActionType(step.action_type);
      setConfig(step.action_config || {});
    }
  }, [step, open]);

  useEffect(() => {
    if (open && actionType === "send_template" && config.whatsappNumberId) {
      fetchTemplates(config.whatsappNumberId);
    }
  }, [open, actionType, config.whatsappNumberId]);

  const fetchTemplates = async (numberId?: string) => {
    const nId = numberId || config.whatsappNumberId;
    if (!nId) return;
    setLoadingTemplates(true);
    setTemplates([]);
    try {
      const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-whatsapp-get-templates`);
      url.searchParams.set('whatsappNumberId', nId);
      const fetchRes = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      const data = await fetchRes.json();
      if (data?.templates) {
        setTemplates(data.templates.filter((t: MetaTemplate) => t.status === "APPROVED"));
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

  // ── Carousel card image: upload from PC → open cropper first ──
  const handleCardImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const cardIdx = pcUploadTargetCard;
    e.target.value = "";
    if (!file || cardIdx === null) return;
    setCropTargetCard(cardIdx);
    setCropSrc(URL.createObjectURL(file));
    setCropOpen(true);
  };

  const triggerCardPcUpload = (cardIdx: number) => {
    setPcUploadTargetCard(cardIdx);
    setTimeout(() => cardFileRef.current?.click(), 0);
  };

  // ── Carousel card image: pick from Shopify ──
  const loadShopifyProducts = async (query?: string) => {
    setLoadingShopify(true);
    try { setShopifyProducts(await fetchProducts(50, query || undefined)); }
    catch { toast.error("Erro ao carregar produtos da Shopify"); }
    setLoadingShopify(false);
  };

  const openShopifyForCard = (cardIdx: number) => {
    setShopifyTargetCard(cardIdx);
    setShowShopifyPicker(true);
    if (shopifyProducts.length === 0) loadShopifyProducts();
  };

  // Shopify image chosen → open cropper (don't set headerUrl directly).
  const selectShopifyImage = (imageUrl: string) => {
    if (shopifyTargetCard === null) return;
    setShowShopifyPicker(false);
    setCropTargetCard(shopifyTargetCard);
    setCropSrc(imageUrl);
    setCropOpen(true);
  };

  // Cropper confirmed → upload the 1:1 blob and set the card header.
  const applyCroppedImage = async (blob: Blob) => {
    const cardIdx = cropTargetCard;
    if (cardIdx === null) return;
    setCropUploading(true);
    try {
      const fileName = `template-card-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from("chat-media")
        .upload(fileName, blob, { contentType: "image/jpeg" });
      if (error) { toast.error("Erro ao enviar imagem"); return; }
      const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(fileName);
      const cc = config.carouselCards || {};
      const cardConf = cc[cardIdx] || {};
      setConfig({ ...config, carouselCards: { ...cc, [cardIdx]: { ...cardConf, headerUrl: urlData.publicUrl } } });
      toast.success("Imagem ajustada e enviada!");
      setCropOpen(false);
      setCropSrc(null);
      setCropTargetCard(null);
    } finally {
      setCropUploading(false);
    }
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

  const delaySecs = actionType === "delay" ? (() => {
    const val = config.delayValue || config.minutes || 5;
    const unit = config.delayUnit || "minutes";
    return unit === "days" ? val * 86400 : unit === "hours" ? val * 3600 : val * 60;
  })() : 0;

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
                  <Label className="text-xs">Número WhatsApp (Meta)</Label>
                  {loadingNumbers ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando números...</div>
                  ) : (
                    <Select value={config.whatsappNumberId || ""} onValueChange={v => {
                      setConfig({ ...config, whatsappNumberId: v, templateName: "", language: "" });
                      setTemplates([]);
                      fetchTemplates(v);
                    }}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o número" /></SelectTrigger>
                      <SelectContent>
                        {whatsappNumbers.map(n => (
                          <SelectItem key={n.id} value={n.id}>
                            <span className="flex items-center gap-2">
                              {n.label} {n.phone_display && <span className="text-muted-foreground text-[10px]">({n.phone_display})</span>}
                              {n.is_default && <Badge variant="secondary" className="text-[9px] px-1 py-0">Padrão</Badge>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {config.whatsappNumberId && (
                  <div className="space-y-1">
                    <Label className="text-xs">Template Aprovado</Label>
                    {loadingTemplates ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando templates...</div>
                    ) : templates.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">Nenhum template aprovado encontrado para este número.</p>
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
                )}

                {!config.whatsappNumberId && (
                  <p className="text-xs text-muted-foreground">Selecione um número WhatsApp para ver os templates aprovados.</p>
                )}

                {config.templateName && (
                  <div className="space-y-3">
                    {/* Template Preview */}
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-xs font-medium mb-1">Preview do Template:</p>
                      {(() => {
                        const tpl = templates.find(t => t.name === config.templateName);
                        const body = tpl?.components?.find((c: any) => c.type === "BODY");
                        const header = tpl?.components?.find((c: any) => c.type === "HEADER");
                        const carousel = tpl?.components?.find((c: any) => c.type === "CAROUSEL");
                        const buttons = tpl?.components?.find((c: any) => c.type === "BUTTONS");
                        return (
                          <div className="space-y-1.5">
                            {header && (
                              <p className="text-[10px] text-muted-foreground">
                                📎 Header: {header.format || "TEXT"} {header.text && `— ${header.text}`}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{body?.text || "—"}</p>
                            {carousel && (
                              <Badge variant="secondary" className="text-[9px] gap-1">
                                <LayoutGrid className="h-2.5 w-2.5" />
                                Carrossel — {carousel.cards?.length || 0} cards
                              </Badge>
                            )}
                            {buttons && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {buttons.buttons?.map((b: any, i: number) => (
                                  <Badge key={i} variant="outline" className="text-[9px]">
                                    {b.type === "URL" ? "🔗" : b.type === "QUICK_REPLY" ? "↩️" : "📞"} {b.text}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {/* Carousel card buttons (buttons live inside each card) */}
                            {carousel && (() => {
                              const cardBtns = carousel.cards?.[0]?.components?.find((c: any) => c.type === "BUTTONS");
                              if (!cardBtns?.buttons?.length) return null;
                              return (
                                <div className="mt-1 space-y-0.5">
                                  <p className="text-[9px] text-muted-foreground">Botões dos cards:</p>
                                  <div className="flex flex-wrap gap-1">
                                    {cardBtns.buttons.map((b: any, i: number) => (
                                      <Badge key={i} variant="outline" className="text-[9px]">
                                        {b.type === "URL" ? "🔗" : b.type === "QUICK_REPLY" ? "↩️" : "📞"} {b.text}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                          </div>
                        );
                      })()}
                    </div>

                    {/* HEADER variable mapping (for image/video/document headers) */}
                    {(() => {
                      const tpl = templates.find(t => t.name === config.templateName);
                      const header = tpl?.components?.find((c: any) => c.type === "HEADER");
                      if (!header || header.format === "TEXT") return null;
                      const headerType = (header.format || "").toLowerCase();
                      const handleHeaderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingHeader(true);
                        const ext = file.name.split('.').pop();
                        const fileName = `template-header-${Date.now()}.${ext}`;
                        const { error } = await supabase.storage.from("chat-media").upload(fileName, file);
                        if (error) { toast.error("Erro ao enviar arquivo"); setUploadingHeader(false); return; }
                        const { data: urlData } = supabase.storage.from("chat-media").getPublicUrl(fileName);
                        setConfig({ ...config, headerMediaUrl: urlData.publicUrl });
                        toast.success("Arquivo enviado!");
                        setUploadingHeader(false);
                      };
                      return (
                        <div className="space-y-2 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30">
                          <Label className="text-xs font-semibold flex items-center gap-1">
                            <Image className="h-3.5 w-3.5" />
                            Header ({header.format})
                          </Label>
                          <div className="flex gap-1.5">
                            <Input
                              value={config.headerMediaUrl || ""}
                              onChange={e => setConfig({ ...config, headerMediaUrl: e.target.value })}
                              placeholder={`URL da ${headerType === "image" ? "imagem" : headerType === "video" ? "vídeo" : "documento"}...`}
                              className="h-8 text-xs flex-1"
                            />
                            <input ref={headerFileRef} type="file" className="hidden" accept={headerType === "image" ? "image/*" : headerType === "video" ? "video/*" : "*/*"} onChange={handleHeaderUpload} />
                            <Button variant="outline" size="sm" className="h-8 px-2 text-[10px] gap-1 shrink-0" onClick={() => headerFileRef.current?.click()} disabled={uploadingHeader}>
                              {uploadingHeader ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                              Upload
                            </Button>
                          </div>
                          {config.headerMediaUrl && headerType === "image" && (
                            <img src={config.headerMediaUrl} alt="Header preview" className="max-h-24 rounded object-cover" />
                          )}
                        </div>
                      );
                    })()}

                    {/* Body Variable Mapping */}
                    {(() => {
                      const tpl = templates.find(t => t.name === config.templateName);
                      const body = tpl?.components?.find((c: any) => c.type === "BODY");
                      const bodyText = body?.text || "";
                      const varMatches = bodyText.match(/\{\{\d+\}\}/g) || [];
                      const uniqueVars = [...new Set(varMatches)].sort();
                      if (uniqueVars.length === 0) return null;
                      
                       const templateVars = config.templateVars || {};
                      
                      return (
                        <div className="space-y-2 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
                          <Label className="text-xs font-semibold flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" />
                            Variáveis do Body ({uniqueVars.length})
                          </Label>
                          <p className="text-[10px] text-muted-foreground">
                            Mapeie cada variável para dados dinâmicos do lead/cliente ou texto fixo.
                          </p>
                          {uniqueVars.map((v: string) => {
                            const varNum = v.replace(/\{\{|\}\}/g, "");
                            const currentVal = templateVars[varNum] || "";
                            const isDynamic = DYNAMIC_FIELD_OPTIONS.some(df => df.value === currentVal);
                            const isLegacy = CUSTOMER_VARIABLES.some(cv => cv.value === currentVal);
                            const isCustom = !isDynamic && !isLegacy;
                            return (
                              <div key={v} className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">{v}</Label>
                                <div className="flex gap-1.5">
                                  <Select
                                    value={isDynamic ? currentVal : isLegacy ? currentVal : "_custom"}
                                    onValueChange={val => {
                                      if (val === "_custom") {
                                        setConfig({ ...config, templateVars: { ...templateVars, [varNum]: "" } });
                                      } else {
                                        setConfig({ ...config, templateVars: { ...templateVars, [varNum]: val } });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="_custom">✏️ Texto fixo</SelectItem>
                                      {DYNAMIC_FIELD_OPTIONS.map(df => (
                                        <SelectItem key={df.value} value={df.value}>
                                          <span className="text-xs">{df.label}</span>
                                        </SelectItem>
                                      ))}
                                      {CUSTOMER_VARIABLES.map(cv => (
                                        <SelectItem key={cv.value} value={cv.value}>
                                          <span className="text-xs">📋 {cv.label}</span>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                {isDynamic && (
                                  <p className="text-[10px] text-blue-600 dark:text-blue-400">
                                    🔄 {DYNAMIC_FIELD_OPTIONS.find(df => df.value === currentVal)?.description}
                                  </p>
                                )}
                                {isCustom && (
                                  <Input
                                    value={currentVal}
                                    onChange={e => setConfig({ ...config, templateVars: { ...templateVars, [varNum]: e.target.value } })}
                                    placeholder="Digite o valor fixo..."
                                    className="h-8 text-xs"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* CAROUSEL card-by-card configuration */}
                    {(() => {
                      const tpl = templates.find(t => t.name === config.templateName);
                      const carousel = tpl?.components?.find((c: any) => c.type === "CAROUSEL");
                      if (!carousel || !carousel.cards?.length) return null;

                      const carouselConfig = config.carouselCards || {};

                      return (
                        <div className="space-y-2 p-3 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30">
                          <Label className="text-xs font-semibold flex items-center gap-1">
                            <LayoutGrid className="h-3.5 w-3.5" />
                            Carrossel — {carousel.cards.length} Cards
                          </Label>
                          <p className="text-[10px] text-muted-foreground">
                            Configure a mídia do header, variáveis e botões de cada card.
                          </p>
                          
                          {carousel.cards.map((card: any, cardIdx: number) => {
                            const cardHeader = card.components?.find((c: any) => c.type === "HEADER");
                            const cardBody = card.components?.find((c: any) => c.type === "BODY");
                            const cardButtons = card.components?.find((c: any) => c.type === "BUTTONS");
                            const cardConf = carouselConfig[cardIdx] || {};
                            const isExpanded = expandedCarouselCard === cardIdx;

                            // Detect body variables in this card
                            const cardBodyText = cardBody?.text || "";
                            const cardVarMatches = cardBodyText.match(/\{\{\d+\}\}/g) || [];
                            const cardUniqueVars = [...new Set(cardVarMatches)].sort();

                            // Detect URL buttons with variables
                            const urlButtons = cardButtons?.buttons?.filter((b: any) => b.type === "URL") || [];

                            return (
                              <div key={cardIdx} className="border rounded-lg overflow-hidden border-border">
                                <button
                                  type="button"
                                  className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-left"
                                  onClick={() => setExpandedCarouselCard(isExpanded ? null : cardIdx)}
                                >
                                  <span className="text-xs font-medium">Card {cardIdx + 1}</span>
                                  <div className="flex items-center gap-2">
                                    {cardHeader && <Badge variant="outline" className="text-[8px] px-1">{cardHeader.format || "IMG"}</Badge>}
                                    {cardUniqueVars.length > 0 && <Badge variant="outline" className="text-[8px] px-1">{cardUniqueVars.length} var</Badge>}
                                    {urlButtons.length > 0 && <Badge variant="outline" className="text-[8px] px-1">{urlButtons.length} btn</Badge>}
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  </div>
                                </button>
                                
                                {isExpanded && (
                                  <div className="p-3 space-y-3">
                                    {/* Card Header (image/video URL) */}
                                    {cardHeader && (cardHeader.format === "IMAGE" || cardHeader.format === "VIDEO") && (
                                      <div className="space-y-1.5">
                                        <Label className="text-[11px]">
                                          {cardHeader.format === "IMAGE" ? "🖼️ Imagem do card" : "🎬 Vídeo do card"}
                                        </Label>
                                        <Input
                                          value={cardConf.headerUrl || ""}
                                          onChange={e => setConfig({
                                            ...config,
                                            carouselCards: { ...carouselConfig, [cardIdx]: { ...cardConf, headerUrl: e.target.value } }
                                          })}
                                          placeholder={`URL da ${cardHeader.format === "IMAGE" ? "imagem" : "vídeo"} ou suba abaixo...`}
                                          className="h-8 text-xs"
                                        />
                                        <div className="flex gap-1.5">
                                          <Button
                                            type="button" variant="outline" size="sm"
                                            className="h-8 px-2 text-[10px] gap-1 flex-1"
                                            onClick={() => triggerCardPcUpload(cardIdx)}
                                            disabled={uploadingCard === cardIdx}
                                          >
                                            {uploadingCard === cardIdx ? <Loader2 className="h-3 w-3 animate-spin" /> : <Monitor className="h-3 w-3" />}
                                            Subir do PC
                                          </Button>
                                          {cardHeader.format === "IMAGE" && (
                                            <Button
                                              type="button" variant="outline" size="sm"
                                              className="h-8 px-2 text-[10px] gap-1 flex-1"
                                              onClick={() => openShopifyForCard(cardIdx)}
                                            >
                                              <ShoppingBag className="h-3 w-3" />
                                              Subir do site
                                            </Button>
                                          )}
                                        </div>
                                        {cardConf.headerUrl && cardHeader.format === "IMAGE" && (
                                          <img src={cardConf.headerUrl} alt="Card preview" className="max-h-24 rounded object-cover border border-border" />
                                        )}
                                      </div>
                                    )}


                                    {/* Card Body Preview */}
                                    {cardBody?.text && (
                                      <div className="p-2 bg-muted rounded text-[10px] text-muted-foreground whitespace-pre-wrap">
                                        {cardBody.text}
                                      </div>
                                    )}

                                    {/* Card Body Variables */}
                                    {cardUniqueVars.length > 0 && (
                                      <div className="space-y-1.5">
                                        <Label className="text-[11px] font-medium">Variáveis do card</Label>
                                        {cardUniqueVars.map((v: string) => {
                                          const varNum = v.replace(/\{\{|\}\}/g, "");
                                          const cardVars = cardConf.bodyVars || {};
                                          const currentVal = cardVars[varNum] || "";
                                          return (
                                            <div key={v} className="space-y-0.5">
                                              <Label className="text-[10px] text-muted-foreground">{v}</Label>
                                              <div className="flex gap-1">
                                                <Select
                                                  value={DYNAMIC_FIELD_OPTIONS.some(df => df.value === currentVal) ? currentVal : CUSTOMER_VARIABLES.some(cv => cv.value === currentVal) ? currentVal : "_custom"}
                                                  onValueChange={val => {
                                                    const newVars = { ...cardVars, [varNum]: val === "_custom" ? "" : val };
                                                    setConfig({
                                                      ...config,
                                                      carouselCards: { ...carouselConfig, [cardIdx]: { ...cardConf, bodyVars: newVars } }
                                                    });
                                                  }}
                                                >
                                                  <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue placeholder="..." /></SelectTrigger>
                                                  <SelectContent>
                                                    <SelectItem value="_custom">✏️ Fixo</SelectItem>
                                                    {DYNAMIC_FIELD_OPTIONS.map(df => (
                                                      <SelectItem key={df.value} value={df.value}>
                                                        <span className="text-[11px]">{df.label}</span>
                                                      </SelectItem>
                                                    ))}
                                                    {CUSTOMER_VARIABLES.map(cv => (
                                                      <SelectItem key={cv.value} value={cv.value}>
                                                        <span className="text-[11px]">📋 {cv.label}</span>
                                                      </SelectItem>
                                                    ))}
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                              {DYNAMIC_FIELD_OPTIONS.some(df => df.value === currentVal) && (
                                                <p className="text-[9px] text-blue-600 dark:text-blue-400">
                                                  🔄 {DYNAMIC_FIELD_OPTIONS.find(df => df.value === currentVal)?.description}
                                                </p>
                                              )}
                                              {!DYNAMIC_FIELD_OPTIONS.some(df => df.value === currentVal) && !CUSTOMER_VARIABLES.some(cv => cv.value === currentVal) && (
                                                <Input
                                                  value={currentVal}
                                                  onChange={e => {
                                                    const newVars = { ...cardVars, [varNum]: e.target.value };
                                                    setConfig({
                                                      ...config,
                                                      carouselCards: { ...carouselConfig, [cardIdx]: { ...cardConf, bodyVars: newVars } }
                                                    });
                                                  }}
                                                  placeholder="Valor fixo..."
                                                  className="h-7 text-[11px]"
                                                />
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Card Buttons */}
                                    {urlButtons.length > 0 && (
                                      <div className="space-y-1.5">
                                        <Label className="text-[11px] font-medium">Botões URL</Label>
                                        {urlButtons.map((btn: any, btnIdx: number) => {
                                          const btnVarMatch = btn.url?.match(/\{\{\d+\}\}/);
                                          const cardBtnVars = cardConf.buttonVars || {};
                                          return (
                                            <div key={btnIdx} className="space-y-0.5">
                                              <Label className="text-[10px] text-muted-foreground">
                                                🔗 {btn.text} {btn.url && <span className="opacity-60">({btn.url})</span>}
                                              </Label>
                                              {btnVarMatch && (
                                                <Input
                                                  value={cardBtnVars[btnIdx] || ""}
                                                  onChange={e => {
                                                    const newBtnVars = { ...cardBtnVars, [btnIdx]: e.target.value };
                                                    setConfig({
                                                      ...config,
                                                      carouselCards: { ...carouselConfig, [cardIdx]: { ...cardConf, buttonVars: newBtnVars } }
                                                    });
                                                  }}
                                                  placeholder="Sufixo da URL (ex: produto-123)"
                                                  className="h-7 text-[11px]"
                                                />
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Top-level Button variables (non-carousel templates) */}
                    {(() => {
                      const tpl = templates.find(t => t.name === config.templateName);
                      const carousel = tpl?.components?.find((c: any) => c.type === "CAROUSEL");
                      if (carousel) return null; // handled above
                      const buttons = tpl?.components?.find((c: any) => c.type === "BUTTONS");
                      if (!buttons?.buttons?.length) return null;
                      const urlButtons = buttons.buttons.filter((b: any) => b.type === "URL" && b.url?.includes("{{"));
                      if (urlButtons.length === 0) return null;

                      const buttonVars = config.buttonVars || {};
                      return (
                        <div className="space-y-2 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
                          <Label className="text-xs font-semibold flex items-center gap-1">
                            <ExternalLink className="h-3.5 w-3.5" />
                            Botões URL com variável
                          </Label>
                          {urlButtons.map((btn: any, i: number) => (
                            <div key={i} className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">🔗 {btn.text} — {btn.url}</Label>
                              <Input
                                value={buttonVars[i] || ""}
                                onChange={e => setConfig({ ...config, buttonVars: { ...buttonVars, [i]: e.target.value } })}
                                placeholder="Sufixo da URL dinâmica..."
                                className="h-8 text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* QUICK_REPLY button branching */}
                    {(() => {
                      const tpl = templates.find(t => t.name === config.templateName);
                      const buttons = tpl?.components?.find((c: any) => c.type === "BUTTONS");
                      if (!buttons?.buttons?.length) return null;
                      const quickReplies = buttons.buttons.filter((b: any) => b.type === "QUICK_REPLY");
                      if (quickReplies.length === 0) return null;

                      // Auto-save quick reply button texts to config
                      const currentQr = config.quickReplyButtons || [];
                      const qrTexts = quickReplies.map((b: any) => b.text);
                      if (JSON.stringify(currentQr) !== JSON.stringify(qrTexts)) {
                        setTimeout(() => setConfig({ ...config, quickReplyButtons: qrTexts }), 0);
                      }

                      return (
                        <div className="space-y-2 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
                          <Label className="text-xs font-semibold flex items-center gap-1">
                            <GitBranch className="h-3.5 w-3.5" />
                            Botões Quick Reply — Bifurcação
                          </Label>
                          <p className="text-[10px] text-muted-foreground">
                            Este template tem {quickReplies.length} botão(ões) de resposta rápida. 
                            Você pode configurar caminhos diferentes no fluxo para cada botão clicado. 
                            Conecte as setas no canvas para definir os caminhos.
                          </p>
                          <div className="space-y-2">
                            {quickReplies.map((btn: any, i: number) => {
                              const handleId = `btn-${i}`;
                              const branches = config.buttonBranches || {};
                              const currentTarget = branches[handleId] || "";
                              const otherSteps = (allSteps || []).filter(s => s.id !== step?.id);
                              return (
                                <div key={i} className="flex items-center gap-2 p-2 bg-card rounded border border-border">
                                  <Badge variant="outline" className="text-[10px] whitespace-nowrap">↩️ {btn.text}</Badge>
                                  <span className="text-[10px] text-muted-foreground">→</span>
                                  <Select
                                    value={currentTarget || "__none__"}
                                    onValueChange={v => {
                                      const next = { ...(config.buttonBranches || {}) };
                                      if (v === "__none__") delete next[handleId];
                                      else next[handleId] = v;
                                      setConfig({ ...config, buttonBranches: next });
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Próxima etapa..." /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">— Continuar fluxo padrão —</SelectItem>
                                      {otherSteps.map((s, idx) => {
                                        const c = (s.action_config || {}) as any;
                                        const label = c.templateName || c.message?.slice(0, 30) || c.tags?.join(",") || s.action_type;
                                        return <SelectItem key={s.id} value={s.id}>#{idx + 1} {s.action_type} · {label}</SelectItem>;
                                      })}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })}
                            <div className="flex items-center gap-2 p-2 bg-card rounded border border-orange-200 dark:border-orange-800">
                              <Badge variant="secondary" className="text-[10px] whitespace-nowrap">⏳ Sem resposta</Badge>
                              <span className="text-[10px] text-muted-foreground">→</span>
                              <Select
                                value={(config.buttonBranches || {})["btn-timeout"] || "__none__"}
                                onValueChange={v => {
                                  const next = { ...(config.buttonBranches || {}) };
                                  if (v === "__none__") delete next["btn-timeout"];
                                  else next["btn-timeout"] = v;
                                  setConfig({ ...config, buttonBranches: next });
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Etapa de timeout..." /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— Encerrar fluxo —</SelectItem>
                                  {(allSteps || []).filter(s => s.id !== step?.id).map((s, idx) => {
                                    const c = (s.action_config || {}) as any;
                                    const label = c.templateName || c.message?.slice(0, 30) || c.tags?.join(",") || s.action_type;
                                    return <SelectItem key={s.id} value={s.id}>#{idx + 1} {s.action_type} · {label}</SelectItem>;
                                  })}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <p className="text-[10px] text-blue-600 dark:text-blue-400">
                            💡 Selecione a próxima etapa para cada botão. Crie as etapas antes (ex: "Mensagem Livre" com PDF) e depois associe-as aqui.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => fetchTemplates()} className="gap-1" disabled={!config.whatsappNumberId}>
                  <RefreshCw className="h-3 w-3" />Atualizar lista
                </Button>
              </div>
            )}

            {/* ── SEND TEXT (rich, multi-block + interactive buttons) ── */}
            {actionType === "send_text" && (() => {
              // Migrate legacy single-message format into blocks[] on first edit
              const blocks: any[] = Array.isArray(config.blocks) && config.blocks.length > 0
                ? config.blocks
                : [
                    ...(config.message ? [{ type: "text", message: config.message }] : []),
                    ...(config.mediaUrl ? [{ type: config.mediaType || "document", mediaUrl: config.mediaUrl, mediaType: config.mediaType }] : []),
                  ];
              const interactiveButtons: string[] = config.interactiveButtons || [];

              const updateBlock = (idx: number, patch: any) => {
                const next = blocks.map((b, i) => i === idx ? { ...b, ...patch } : b);
                setConfig({ ...config, blocks: next, message: undefined, mediaUrl: undefined, mediaType: undefined });
              };
              const removeBlock = (idx: number) => {
                const next = blocks.filter((_, i) => i !== idx);
                setConfig({ ...config, blocks: next, message: undefined, mediaUrl: undefined, mediaType: undefined });
              };
              const addBlock = (type: string) => {
                const next = [...blocks, type === "text" ? { type: "text", message: "" } : { type, mediaUrl: "", mediaType: type }];
                setConfig({ ...config, blocks: next, message: undefined, mediaUrl: undefined, mediaType: undefined });
              };
              const moveBlock = (idx: number, dir: -1 | 1) => {
                const ni = idx + dir;
                if (ni < 0 || ni >= blocks.length) return;
                const next = [...blocks];
                [next[idx], next[ni]] = [next[ni], next[idx]];
                setConfig({ ...config, blocks: next, message: undefined, mediaUrl: undefined, mediaType: undefined });
              };
              const uploadForBlock = async (idx: number, file: File) => {
                const ext = file.name.split('.').pop();
                const fileName = `automation-media-${Date.now()}.${ext}`;
                const { error } = await supabase.storage.from("chat-media").upload(fileName, file);
                if (error) { toast.error("Erro ao enviar arquivo"); return; }
                const { data } = supabase.storage.from("chat-media").getPublicUrl(fileName);
                const mt = file.type.startsWith("image") ? "image" : file.type.startsWith("video") ? "video" : file.type.startsWith("audio") ? "audio" : "document";
                updateBlock(idx, { mediaUrl: data.publicUrl, mediaType: mt, type: mt });
                toast.success("Anexo carregado");
              };

              const setBtns = (btns: string[]) => setConfig({ ...config, interactiveButtons: btns });

              return (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> Blocos de mensagem</Label>
                    {blocks.length === 0 && (
                      <p className="text-[11px] text-muted-foreground italic">Nenhum bloco. Adicione abaixo.</p>
                    )}
                    {blocks.map((blk, idx) => (
                      <div key={idx} className="border border-border rounded-lg p-2 bg-muted/30 space-y-2 relative">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px]">
                            {blk.type === "text" ? "💬 Texto" : blk.type === "image" ? "🖼️ Imagem" : blk.type === "video" ? "🎬 Vídeo" : blk.type === "audio" ? "🎵 Áudio" : "📎 Documento"} · #{idx + 1}
                          </Badge>
                          <div className="flex items-center gap-0.5">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveBlock(idx, -1)} disabled={idx === 0}><ChevronUp className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveBlock(idx, 1)} disabled={idx === blocks.length - 1}><ChevronDown className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeBlock(idx)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                          </div>
                        </div>

                        {(blk.type === "text" || blk.message !== undefined) && (
                          <Textarea
                            value={blk.message || ""}
                            onChange={e => updateBlock(idx, { message: e.target.value })}
                            placeholder={blk.type === "text" ? "Digite a mensagem..." : "Legenda (opcional)"}
                            rows={3}
                            className="text-xs"
                          />
                        )}

                        {blk.type !== "text" && (
                          <div className="space-y-1">
                            {blk.mediaUrl ? (
                              <div className="flex items-center gap-2 p-2 bg-background rounded text-xs">
                                <Paperclip className="h-3.5 w-3.5" />
                                <span className="truncate flex-1">{blk.mediaUrl.split('/').pop()}</span>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateBlock(idx, { mediaUrl: "" })}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            ) : (
                              <label className="flex items-center justify-center gap-2 p-3 border border-dashed border-border rounded text-xs cursor-pointer hover:bg-background">
                                <Paperclip className="h-3.5 w-3.5" /> Selecionar arquivo
                                <input type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadForBlock(idx, f); }} />
                              </label>
                            )}
                            <Textarea
                              value={blk.message || ""}
                              onChange={e => updateBlock(idx, { message: e.target.value })}
                              placeholder="Legenda (opcional)"
                              rows={2}
                              className="text-xs"
                            />
                          </div>
                        )}
                      </div>
                    ))}

                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addBlock("text")}><Plus className="h-3 w-3 mr-1" />Texto</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addBlock("image")}><Image className="h-3 w-3 mr-1" />Imagem</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addBlock("video")}><PlayCircle className="h-3 w-3 mr-1" />Vídeo</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addBlock("document")}><FileText className="h-3 w-3 mr-1" />PDF/Doc</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addBlock("audio")}><Mic className="h-3 w-3 mr-1" />Áudio</Button>
                    </div>
                  </div>

                  {/* Interactive buttons */}
                  <div className="space-y-2 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5 text-blue-500" />
                      Botões de resposta rápida (Meta interactive — máx 3)
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      Quando definidos, o último bloco de TEXTO é enviado como mensagem interactive com estes botões. Cada botão habilita uma saída de bifurcação no fluxo.
                    </p>
                    {[0, 1, 2].map(i => (
                      <div key={i} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] w-12 justify-center">btn-{i}</Badge>
                        <Input
                          value={interactiveButtons[i] || ""}
                          onChange={e => {
                            const next = [...interactiveButtons];
                            next[i] = e.target.value.slice(0, 20);
                            // trim trailing empties
                            while (next.length > 0 && !next[next.length - 1]) next.pop();
                            setBtns(next);
                          }}
                          placeholder={`Texto botão ${i + 1} (até 20 chars)`}
                          maxLength={20}
                          className="h-8 text-xs"
                        />
                      </div>
                    ))}
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Variáveis: {"{{nome}}"}, {"{{telefone}}"}, {"{{email}}"}
                  </p>
                </div>
              );
            })()}

            {/* ── WAIT FOR REPLY (with bifurcation) ── */}
            {actionType === "wait_for_reply" && (
              <div className="space-y-3">
                <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg border border-orange-200 dark:border-orange-800">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    <Reply className="h-3.5 w-3.5 inline mr-1" />
                    O fluxo pausa aqui e só continua quando o lead responder. Se não responder no tempo definido, a ação de timeout será executada.
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
                </div>

                {/* Bifurcation: what to do on no reply */}
                <div className="space-y-2 p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <GitBranch className="h-3.5 w-3.5 text-orange-500" />
                    Se não responder (bifurcação)
                  </Label>
                  <Select value={config.timeoutAction || "cancel"} onValueChange={v => setConfig({ ...config, timeoutAction: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cancel">❌ Cancelar fluxo</SelectItem>
                      <SelectItem value="send_template">📋 Enviar Template Meta</SelectItem>
                      <SelectItem value="send_text">💬 Enviar Mensagem Livre</SelectItem>
                      <SelectItem value="add_tag">🏷️ Adicionar Tag</SelectItem>
                      <SelectItem value="continue">▶️ Continuar para próxima ação</SelectItem>
                    </SelectContent>
                  </Select>

                  {config.timeoutAction === "send_text" && (
                    <div className="space-y-1">
                      <Label className="text-[11px]">Mensagem de follow-up</Label>
                      <Textarea
                        value={config.timeoutMessage || ""}
                        onChange={e => setConfig({ ...config, timeoutMessage: e.target.value })}
                        placeholder="Oi! Vi que não respondeu ainda 😊 Posso te ajudar?"
                        rows={3}
                        className="text-xs"
                      />
                      <div className="flex flex-wrap gap-1">
                        {CUSTOMER_VARIABLES.slice(0, 4).map(v => (
                          <Badge key={v.value} variant="outline" className="text-[9px] cursor-pointer hover:bg-secondary" onClick={() => setConfig({ ...config, timeoutMessage: (config.timeoutMessage || "") + " " + v.value })}>
                            {v.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {config.timeoutAction === "send_template" && (
                    <div className="space-y-1">
                      <Label className="text-[11px]">Nome do template</Label>
                      <Input
                        value={config.timeoutTemplateName || ""}
                        onChange={e => setConfig({ ...config, timeoutTemplateName: e.target.value })}
                        placeholder="Nome do template aprovado"
                        className="h-8 text-xs"
                      />
                    </div>
                  )}

                  {config.timeoutAction === "add_tag" && (
                    <div className="space-y-1">
                      <Label className="text-[11px]">Tag a adicionar</Label>
                      <Input
                        value={config.timeoutTag || ""}
                        onChange={e => setConfig({ ...config, timeoutTag: e.target.value })}
                        placeholder="Ex: nao-respondeu"
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── AI CROSS-SELL ── */}
            {actionType === "ai_crosssell" && (
              <div className="space-y-3">
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">
                    <Sparkles className="h-3.5 w-3.5 inline mr-1" />
                    A IA analisa os produtos comprados e sugere itens complementares do pool definido. Pergunta a variante ao cliente e envia link de checkout Yampi direto.
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Prompt de Cross-sell</Label>
                  <Textarea
                    value={config.crosssellPrompt || ""}
                    onChange={e => setConfig({ ...config, crosssellPrompt: e.target.value })}
                    placeholder={"Você é consultora da Banana Calçados. O cliente acabou de comprar {{produtos_comprados}}. Sugira UM produto complementar do catálogo disponível, explicando por que combina. Seja simpática e use emojis. Quando confirmar interesse, pergunte o tamanho/numeração."}
                    rows={5}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Pool de Produtos (handle Shopify, um por linha)</Label>
                  <Textarea
                    value={(config.productPool || []).join("\n")}
                    onChange={e => setConfig({ ...config, productPool: e.target.value.split("\n").filter((l: string) => l.trim()) })}
                    placeholder={"sandalia-rasteira-conforto\nsapatilha-malu-couro\nbolsa-transversal-mini"}
                    rows={4}
                  />
                  <p className="text-[10px] text-muted-foreground">A IA escolherá o melhor produto para cada cliente.</p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Mensagem de introdução</Label>
                  <Textarea
                    value={config.crosssellIntro || ""}
                    onChange={e => setConfig({ ...config, crosssellIntro: e.target.value })}
                    placeholder={"Oi {{nome}}! 😊 Vi que você acabou de comprar com a gente. Tenho uma sugestão especial..."}
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Máx. interações</Label>
                    <Input type="number" value={config.maxInteractions || 5} onChange={e => setConfig({ ...config, maxInteractions: parseInt(e.target.value) || 5 })} className="h-9" min={1} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Desconto (%)</Label>
                    <Input type="number" value={config.discountPercent || 0} onChange={e => setConfig({ ...config, discountPercent: parseInt(e.target.value) || 0 })} className="h-9" min={0} max={100} />
                  </div>
                </div>

                <div className="p-2 bg-muted rounded-lg space-y-1">
                  <p className="text-[10px] font-medium">Fluxo automático:</p>
                  <ol className="text-[10px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                    <li>Envia mensagem de introdução</li>
                    <li>IA sugere produto complementar do pool</li>
                    <li>Se aceitar, IA pergunta variante (numeração/cor)</li>
                    <li>Gera link Yampi de checkout direto e envia</li>
                  </ol>
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
                <AiInstanceSelector config={config} setConfig={setConfig} whatsappNumbers={whatsappNumbers} loadingNumbers={loadingNumbers} />
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

            {/* ── DELAY (minutes / hours / days) ── */}
            {actionType === "delay" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Tempo de espera</Label>
                    <Input
                      type="number"
                      value={config.delayValue || config.minutes || 5}
                      onChange={e => setConfig({ ...config, delayValue: parseInt(e.target.value) || 1, minutes: undefined })}
                      className="h-9"
                      min={1}
                    />
                  </div>
                  <div className="w-[130px] space-y-1">
                    <Label className="text-xs">Unidade</Label>
                    <Select value={config.delayUnit || "minutes"} onValueChange={v => setConfig({ ...config, delayUnit: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">Minutos</SelectItem>
                        <SelectItem value="hours">Horas</SelectItem>
                        <SelectItem value="days">Dias</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {(() => {
                    const val = config.delayValue || config.minutes || 5;
                    const unit = config.delayUnit || "minutes";
                    const totalMin = unit === "days" ? val * 1440 : unit === "hours" ? val * 60 : val;
                    return `= ${totalMin} minutos no total`;
                  })()}
                </p>

                {/* Deadline / Data Limite */}
                <div className="space-y-2 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      Data limite (não enviar após)
                    </Label>
                    <Switch
                      checked={!!config.hasDeadline}
                      onCheckedChange={v => setConfig({ ...config, hasDeadline: v, deadline: v ? config.deadline : undefined, deadlineAction: v ? (config.deadlineAction || "skip") : undefined })}
                    />
                  </div>
                  {config.hasDeadline && (
                    <>
                      <p className="text-[10px] text-muted-foreground">
                        Se o tempo de espera terminar após essa data, a mensagem seguinte <strong>não será enviada</strong>.
                      </p>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Data e hora limite</Label>
                        <Input
                          type="datetime-local"
                          value={config.deadline || ""}
                          onChange={e => setConfig({ ...config, deadline: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">O que fazer se ultrapassar a data</Label>
                        <Select value={config.deadlineAction || "skip"} onValueChange={v => setConfig({ ...config, deadlineAction: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">⏭️ Pular esta etapa e continuar</SelectItem>
                            <SelectItem value="cancel">🛑 Cancelar todo o fluxo</SelectItem>
                            <SelectItem value="add_tag">🏷️ Adicionar tag e parar</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {config.deadlineAction === "add_tag" && (
                        <div className="space-y-1">
                          <Label className="text-[11px]">Tag</Label>
                          <Input
                            value={config.deadlineTag || ""}
                            onChange={e => setConfig({ ...config, deadlineTag: e.target.value })}
                            placeholder="Ex: fora-do-prazo"
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
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

      {/* Hidden file input for carousel card image upload from PC */}
      <input
        ref={cardFileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleCardImageUpload}
      />

      {/* Human image cropper for the 1:1 WhatsApp carousel thumbnail */}
      <ImageCropDialog
        open={cropOpen}
        imageSrc={cropSrc}
        aspect={1}
        loading={cropUploading}
        onCancel={() => { setCropOpen(false); setCropSrc(null); setCropTargetCard(null); }}
        onConfirm={applyCroppedImage}
      />


      {/* Shopify product picker for carousel card image */}
      <Dialog open={showShopifyPicker} onOpenChange={setShowShopifyPicker}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" /> Escolher foto de produto da Shopify
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar produto..."
                  value={shopifySearch}
                  onChange={e => setShopifySearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') loadShopifyProducts(shopifySearch); }}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => loadShopifyProducts(shopifySearch)} disabled={loadingShopify}>
                {loadingShopify ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Buscar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Clique em uma foto do produto para usá-la na imagem do card.</p>
            <ScrollArea className="h-[400px]">
              {loadingShopify ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : shopifyProducts.length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-8">Nenhum produto encontrado</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {shopifyProducts.map(p => {
                    const images = p.node.images.edges;
                    const mainImage = images[0]?.node.url;
                    return (
                      <Card key={p.node.id} className="overflow-hidden">
                        <div className="space-y-2">
                          {mainImage && (
                            <img
                              src={mainImage}
                              alt={p.node.title}
                              className="w-full h-32 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => selectShopifyImage(mainImage)}
                            />
                          )}
                          <div className="p-2">
                            <p className="text-xs font-medium truncate">{p.node.title}</p>
                            <p className="text-[10px] text-muted-foreground">
                              R$ {parseFloat(p.node.priceRange.minVariantPrice.amount).toFixed(2)}
                            </p>
                            {images.length > 1 && (
                              <div className="flex gap-1 mt-1 overflow-x-auto">
                                {images.map((img, idx) => (
                                  <img
                                    key={idx}
                                    src={img.node.url}
                                    alt=""
                                    className="h-10 w-10 rounded object-cover cursor-pointer border-2 border-transparent hover:border-primary transition-colors shrink-0"
                                    onClick={() => selectShopifyImage(img.node.url)}
                                  />
                                ))}
                              </div>
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

// ─── New Lead Campaign Selector ──────────────────

function NewLeadCampaignSelector({ triggerConfig, onChange }: { triggerConfig: any; onChange: (c: any) => void }) {
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const selectedTags: string[] = triggerConfig.campaign_tags || [];

  useEffect(() => {
    supabase.from("lp_leads").select("campaign_tag").then(({ data }) => {
      if (data) {
        const unique = [...new Set(data.map((d: any) => d.campaign_tag))].filter(Boolean).sort();
        setCampaigns(unique as string[]);
      }
    });
  }, []);

  const toggle = (tag: string) => {
    const current = [...selectedTags];
    const idx = current.indexOf(tag);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(tag);
    onChange({ ...triggerConfig, campaign_tags: current });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">Campanhas (vazio = todas)</Label>
      <div className="flex flex-wrap gap-1.5">
        {campaigns.map(tag => (
          <Badge
            key={tag}
            variant={selectedTags.includes(tag) ? "default" : "outline"}
            className="cursor-pointer text-[10px] px-2 py-0.5"
            onClick={() => toggle(tag)}
          >
            {tag}
          </Badge>
        ))}
        {campaigns.length === 0 && <span className="text-[10px] text-muted-foreground">Nenhuma campanha encontrada</span>}
      </div>
      {selectedTags.length > 0 && (
        <p className="text-[10px] text-muted-foreground">{selectedTags.length} campanha(s) selecionada(s)</p>
      )}
    </div>
  );
}

// ─── Mass Audience Config (full trigger config for mass_audience) ──────────

function MassAudienceConfig({ triggerConfig, onChange }: { triggerConfig: any; onChange: (c: any) => void }) {
  const [campaigns, setCampaigns] = useState<{ tag: string; count: number }[]>([]);
  const [rfmSegments, setRfmSegments] = useState<{ segment: string; count: number }[]>([]);
  const [states, setStates] = useState<{ state: string; count: number }[]>([]);
  const [cities, setCities] = useState<{ city: string; count: number }[]>([]);
  const [regionTypes, setRegionTypes] = useState<{ region: string; count: number }[]>([]);
  const [genders, setGenders] = useState<{ gender: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCityFilter, setShowCityFilter] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [savedPresets, setSavedPresets] = useState<{ id: string; key: string; value: any }[]>([]);

  const audienceSource: string = triggerConfig.audience_source || "rfm"; // "leads" | "rfm" | "both" | "crm"
  const selectedCampaigns: string[] = triggerConfig.audience_campaigns || [];
  const selectedRfmSegments: string[] = triggerConfig.audience_rfm_segments || [];
  const selectedStates: string[] = triggerConfig.audience_states || [];
  const selectedCities: string[] = triggerConfig.audience_cities || [];
  const selectedRegions: string[] = triggerConfig.audience_regions || [];
  const selectedGenders: string[] = triggerConfig.audience_genders || [];
  const rfmSelectAll: boolean = triggerConfig.audience_rfm_all ?? false;

  const selectedPresetKeys: string[] = triggerConfig.audience_rfm_preset_keys || [];

  useEffect(() => { loadAll(); }, []);

  const fetchAllRows = async (table: string, column: string): Promise<any[]> => {
    const allData: any[] = [];
    const pageSize = 1000;
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await (supabase as any).from(table).select(column).range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) { hasMore = false; break; }
      allData.push(...data);
      if (data.length < pageSize) hasMore = false;
      else from += pageSize;
    }
    return allData;
  };

  const loadAll = async () => {
    setLoading(true);
    const [campaignsData, rfmData, statesData, citiesData, regionsData, gendersData, presetsRes] = await Promise.all([
      fetchAllRows("lp_leads", "campaign_tag"),
      fetchAllRows("crm_customers_v", "rfm_segment"),
      fetchAllRows("crm_customers_v", "state"),
      fetchAllRows("crm_customers_v", "city"),
      fetchAllRows("crm_customers_v", "region_type"),
      fetchAllRows("crm_customers_v", "gender"),
      supabase.from("app_settings").select("id,key,value").like("key", "rfm_filter_preset_%").order("created_at", { ascending: true }),
    ]);

    setSavedPresets((presetsRes.data || []) as any[]);

    // Campaigns
    {
      const counts: Record<string, number> = {};
      campaignsData.forEach((d: any) => { if (d.campaign_tag) counts[d.campaign_tag] = (counts[d.campaign_tag] || 0) + 1; });
      setCampaigns(Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
    }

    // RFM
    {
      const counts: Record<string, number> = {};
      rfmData.forEach((d: any) => { if (d.rfm_segment) counts[d.rfm_segment] = (counts[d.rfm_segment] || 0) + 1; });
      setRfmSegments(Object.entries(counts).map(([segment, count]) => ({ segment, count })).sort((a, b) => b.count - a.count));
    }

    // States
    {
      const counts: Record<string, number> = {};
      statesData.forEach((d: any) => { const s = d.state?.trim(); if (s && s.length === 2 && s !== '0') counts[s] = (counts[s] || 0) + 1; });
      setStates(Object.entries(counts).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count));
    }

    // Cities
    {
      const counts: Record<string, number> = {};
      citiesData.forEach((d: any) => { const c = d.city?.trim(); if (c) counts[c] = (counts[c] || 0) + 1; });
      setCities(Object.entries(counts).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count));
    }

    // Regions
    {
      const counts: Record<string, number> = {};
      regionsData.forEach((d: any) => { if (d.region_type) counts[d.region_type] = (counts[d.region_type] || 0) + 1; });
      setRegionTypes(Object.entries(counts).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count));
    }

    // Genders
    {
      const counts: Record<string, number> = {};
      gendersData.forEach((d: any) => { const g = d.gender?.trim(); if (g) counts[g] = (counts[g] || 0) + 1; });
      setGenders(Object.entries(counts).map(([gender, count]) => ({ gender, count })).sort((a, b) => b.count - a.count));
    }

    setLoading(false);
  };

  const toggleArray = (key: string, value: string) => {
    const current: string[] = triggerConfig[key] || [];
    const idx = current.indexOf(value);
    const updated = idx >= 0 ? current.filter(v => v !== value) : [...current, value];
    onChange({ ...triggerConfig, [key]: updated });
  };

  const filteredCities = cities.filter(c => 
    !citySearch || c.city.toLowerCase().includes(citySearch.toLowerCase())
  ).slice(0, 30);

  const regionLabels: Record<string, string> = { local: "🏪 Loja Física", online: "🌐 Online", unknown: "❓ Desconhecido" };
  const genderLabels: Record<string, string> = { male: "♂️ Masculino", female: "♀️ Feminino", other: "⚧ Outro" };

  // Compute estimated audience count
  const estimatedLeadsCount = useMemo(() => {
    if (audienceSource !== "leads" && audienceSource !== "both") return 0;
    if (selectedCampaigns.length === 0) return campaigns.reduce((sum, c) => sum + c.count, 0);
    return campaigns.filter(c => selectedCampaigns.includes(c.tag)).reduce((sum, c) => sum + c.count, 0);
  }, [audienceSource, selectedCampaigns, campaigns]);

  const estimatedRfmCount = useMemo(() => {
    if (audienceSource !== "rfm" && audienceSource !== "both") return 0;
    if (rfmSelectAll) return rfmSegments.reduce((sum, s) => sum + s.count, 0);
    if (selectedRfmSegments.length === 0) return 0;
    return rfmSegments.filter(s => selectedRfmSegments.includes(s.segment)).reduce((sum, s) => sum + s.count, 0);
  }, [audienceSource, rfmSelectAll, selectedRfmSegments, rfmSegments]);

  const totalEstimated = estimatedLeadsCount + estimatedRfmCount;

  if (loading) {
    return (
      <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800">
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />Carregando dados da base...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          Fonte de Audiência
        </Label>
        {totalEstimated > 0 && (
          <Badge className="text-[10px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white">
            ~{totalEstimated.toLocaleString("pt-BR")} destinatário(s)
          </Badge>
        )}
      </div>

      <Select value={audienceSource} onValueChange={v => onChange({ ...triggerConfig, audience_source: v })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="rfm">📊 Clientes da Matriz RFM</SelectItem>
          <SelectItem value="leads">📋 Leads de Campanhas</SelectItem>
          <SelectItem value="crm">👥 Clientes do CRM</SelectItem>
          <SelectItem value="both">📋+📊 Leads + RFM</SelectItem>
        </SelectContent>
      </Select>

      {/* ── LEADS CONFIG ── */}
      {(audienceSource === "leads" || audienceSource === "both") && (
        <div className="space-y-1.5 p-2 rounded-lg bg-card border border-border">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-medium">📋 Leads por Campanha</Label>
            {estimatedLeadsCount > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                {estimatedLeadsCount.toLocaleString("pt-BR")} lead(s)
              </Badge>
            )}
          </div>
          {campaigns.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Nenhuma campanha encontrada</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {campaigns.map(c => (
                <Badge
                  key={c.tag}
                  variant={selectedCampaigns.includes(c.tag) ? "default" : "outline"}
                  className="cursor-pointer text-[10px] px-2 py-0.5"
                  onClick={() => toggleArray("audience_campaigns", c.tag)}
                >
                  {c.tag} ({c.count})
                </Badge>
              ))}
            </div>
          )}
          {selectedCampaigns.length > 0 && (
            <p className="text-[10px] text-indigo-600 dark:text-indigo-400">
              {selectedCampaigns.length} campanha(s) · <strong>{estimatedLeadsCount.toLocaleString("pt-BR")} lead(s)</strong>
            </p>
          )}
        </div>
      )}

      {/* ── CRM CUSTOMERS CONFIG ── */}
      {audienceSource === "crm" && (
        <div className="space-y-1.5 p-2 rounded-lg bg-card border border-border">
          <Label className="text-[11px] font-medium">👥 Clientes do CRM</Label>
          <p className="text-[10px] text-muted-foreground">
            Todos os clientes cadastrados na base de clientes serão incluídos. Use tags para filtrar (em breve).
          </p>
          <div className="flex items-center gap-2">
            <Switch
              checked={triggerConfig.crm_include_all ?? true}
              onCheckedChange={v => onChange({ ...triggerConfig, crm_include_all: v })}
            />
            <Label className="text-[11px]">Incluir todos os clientes com WhatsApp</Label>
          </div>
        </div>
      )}

      {/* ── RFM CONFIG ── */}
      {(audienceSource === "rfm" || audienceSource === "both") && (
        <div className="space-y-2 p-2 rounded-lg bg-card border border-border">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-medium">📊 Segmentação da Matriz RFM</Label>
            {estimatedRfmCount > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                {estimatedRfmCount.toLocaleString("pt-BR")} cliente(s)
              </Badge>
            )}
          </div>

          {/* All or segments */}
          <div className="flex items-center gap-2">
            <Switch
              checked={rfmSelectAll}
              onCheckedChange={v => onChange({ ...triggerConfig, audience_rfm_all: v, audience_rfm_segments: v ? [] : selectedRfmSegments })}
            />
            <Label className="text-[11px]">Todos os clientes da matriz</Label>
          </div>

          {!rfmSelectAll && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Segmentos RFM</Label>
              <div className="flex flex-wrap gap-1">
                {rfmSegments.map(s => (
                  <Badge
                    key={s.segment}
                    variant={selectedRfmSegments.includes(s.segment) ? "default" : "outline"}
                    className="cursor-pointer text-[10px] px-2 py-0.5"
                    onClick={() => toggleArray("audience_rfm_segments", s.segment)}
                  >
                    {s.segment} ({s.count})
                  </Badge>
                ))}
              </div>
              {selectedRfmSegments.length > 0 && (
                <p className="text-[10px] text-indigo-600 dark:text-indigo-400">{selectedRfmSegments.length} segmento(s)</p>
              )}
            </div>
          )}

          {/* Region filter */}
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Tipo de Cliente</Label>
            <div className="flex flex-wrap gap-1">
              {regionTypes.map(r => (
                <Badge
                  key={r.region}
                  variant={selectedRegions.includes(r.region) ? "default" : "outline"}
                  className="cursor-pointer text-[10px] px-2 py-0.5"
                  onClick={() => toggleArray("audience_regions", r.region)}
                >
                  {regionLabels[r.region] || r.region} ({r.count})
                </Badge>
              ))}
            </div>
          </div>

          {/* State filter */}
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Estado (UF)</Label>
            <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto">
              {states.map(s => (
                <Badge
                  key={s.state}
                  variant={selectedStates.includes(s.state) ? "default" : "outline"}
                  className="cursor-pointer text-[9px] px-1.5 py-0"
                  onClick={() => toggleArray("audience_states", s.state)}
                >
                  {s.state} ({s.count})
                </Badge>
              ))}
            </div>
            {selectedStates.length > 0 && (
              <p className="text-[10px] text-indigo-600 dark:text-indigo-400">{selectedStates.length} estado(s)</p>
            )}
          </div>

          {/* City filter */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">Cidade</Label>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setShowCityFilter(!showCityFilter)}>
                {showCityFilter ? "Ocultar" : "Filtrar cidades"}
              </Button>
            </div>
            {showCityFilter && (
              <div className="space-y-1">
                <Input
                  value={citySearch}
                  onChange={e => setCitySearch(e.target.value)}
                  placeholder="Buscar cidade..."
                  className="h-7 text-[11px]"
                />
                <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto">
                  {filteredCities.map(c => (
                    <Badge
                      key={c.city}
                      variant={selectedCities.includes(c.city) ? "default" : "outline"}
                      className="cursor-pointer text-[9px] px-1.5 py-0"
                      onClick={() => toggleArray("audience_cities", c.city)}
                    >
                      {c.city} ({c.count})
                    </Badge>
                  ))}
                  {filteredCities.length === 0 && <span className="text-[10px] text-muted-foreground">Nenhuma cidade encontrada</span>}
                </div>
              </div>
            )}
            {selectedCities.length > 0 && (
              <p className="text-[10px] text-indigo-600 dark:text-indigo-400">{selectedCities.length} cidade(s): {selectedCities.join(", ")}</p>
            )}
          </div>

          {/* Gender filter */}
          {genders.length > 0 && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Gênero</Label>
              <div className="flex flex-wrap gap-1">
                {genders.map(g => (
                  <Badge
                    key={g.gender}
                    variant={selectedGenders.includes(g.gender) ? "default" : "outline"}
                    className="cursor-pointer text-[10px] px-2 py-0.5"
                    onClick={() => toggleArray("audience_genders", g.gender)}
                  >
                    {genderLabels[g.gender] || g.gender} ({g.count})
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SAVED RFM PRESETS ── */}
      {(audienceSource === "rfm" || audienceSource === "both") && savedPresets.length > 0 && (
        <div className="space-y-1.5 p-2 rounded-lg bg-card border border-border">
          <div className="flex items-center gap-1.5">
            <Bookmark className="h-3 w-3 text-amber-500" />
            <Label className="text-[11px] font-medium">Filtros RFM Salvos</Label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Selecione filtros salvos na aba Clientes RFM para usar como público do disparo
          </p>
          <div className="flex flex-wrap gap-1">
            {savedPresets.map(p => {
              const isSelected = selectedPresetKeys.includes(p.key);
              const presetName = (p.value as any)?.name || "Filtro";
              return (
                <Badge
                  key={p.id}
                  variant={isSelected ? "default" : "outline"}
                  className={`cursor-pointer text-[10px] px-2 py-0.5 ${isSelected ? "bg-amber-600 hover:bg-amber-700 border-amber-500" : ""}`}
                  onClick={() => {
                    const current = [...selectedPresetKeys];
                    const idx = current.indexOf(p.key);
                    const updated = idx >= 0 ? current.filter(k => k !== p.key) : [...current, p.key];
                    onChange({ ...triggerConfig, audience_rfm_preset_keys: updated });
                  }}
                >
                  {presetName}
                </Badge>
              );
            })}
          </div>
          {selectedPresetKeys.length > 0 && (
            <p className="text-[10px] text-amber-500">
              {selectedPresetKeys.length} filtro(s) selecionado(s) — os filtros acima de segmento/estado/cidade serão ignorados
            </p>
          )}
        </div>
      )}

      {/* ── COOLDOWN FILTER ── */}
      <div className="space-y-1.5 p-2 rounded-lg bg-card border border-border">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3 w-3 text-cyan-500" />
          <Label className="text-[11px] font-medium">Cooldown — Excluir contatos de disparos em massa recentes</Label>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Não enviar para quem já recebeu um disparo em massa (broadcast ou outra automação) nos últimos N dias. Conversas 1:1 não contam. Use 0 para desativar.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={365}
            className="h-8 text-xs w-24"
            value={triggerConfig.audience_cooldown_days ?? 0}
            onChange={e => onChange({ ...triggerConfig, audience_cooldown_days: Math.max(0, parseInt(e.target.value) || 0) })}
          />
          <span className="text-[11px] text-muted-foreground">dias</span>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        💡 As variáveis dinâmicas (Primeiro Nome, etc.) serão preenchidas com dados reais de cada destinatário no momento do disparo.
      </p>
    </div>
  );
}

// ─── Audience Selector (legacy, for other triggers) ──────────────────

function AudienceSelector({ triggerConfig, onChange }: { triggerConfig: any; onChange: (c: any) => void }) {
  const [campaigns, setCampaigns] = useState<{ tag: string; count: number }[]>([]);
  const [rfmSegments, setRfmSegments] = useState<{ segment: string; count: number }[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingRfm, setLoadingRfm] = useState(false);

  const selectedCampaigns: string[] = triggerConfig.audience_campaigns || [];
  const selectedRfmSegments: string[] = triggerConfig.audience_rfm_segments || [];
  const audienceMode: string = triggerConfig.audience_mode || "trigger";

  const fetchAllPaginated = async (table: string, column: string): Promise<any[]> => {
    const allData: any[] = [];
    const pageSize = 1000;
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await (supabase as any).from(table).select(column).range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) { hasMore = false; break; }
      allData.push(...data);
      if (data.length < pageSize) hasMore = false;
      else from += pageSize;
    }
    return allData;
  };

  useEffect(() => {
    setLoadingCampaigns(true);
    setLoadingRfm(true);
    Promise.all([
      fetchAllPaginated("lp_leads", "campaign_tag").then((data) => {
        const counts: Record<string, number> = {};
        data.forEach((d: any) => { if (d.campaign_tag) counts[d.campaign_tag] = (counts[d.campaign_tag] || 0) + 1; });
        setCampaigns(Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
        setLoadingCampaigns(false);
      }),
      fetchAllPaginated("crm_customers_v", "rfm_segment").then((data) => {
        const counts: Record<string, number> = {};
        data.forEach((d: any) => { if (d.rfm_segment) counts[d.rfm_segment] = (counts[d.rfm_segment] || 0) + 1; });
        setRfmSegments(Object.entries(counts).map(([segment, count]) => ({ segment, count })).sort((a, b) => b.count - a.count));
        setLoadingRfm(false);
      }),
    ]);
  }, []);

  const toggleCampaign = (tag: string) => {
    const current = [...selectedCampaigns];
    const idx = current.indexOf(tag);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(tag);
    onChange({ ...triggerConfig, audience_campaigns: current });
  };

  const toggleRfmSegment = (seg: string) => {
    const current = [...selectedRfmSegments];
    const idx = current.indexOf(seg);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(seg);
    onChange({ ...triggerConfig, audience_rfm_segments: current });
  };

  return (
    <div className="space-y-3 p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800">
      <Label className="text-xs font-semibold flex items-center gap-1">
        <Users className="h-3.5 w-3.5" />
        Audiência Adicional
      </Label>

      <Select value={audienceMode} onValueChange={v => onChange({ ...triggerConfig, audience_mode: v })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="trigger">🎯 Apenas por gatilho (padrão)</SelectItem>
          <SelectItem value="campaigns">📋 Leads de Campanhas</SelectItem>
          <SelectItem value="rfm">📊 Clientes RFM</SelectItem>
          <SelectItem value="both">📋+📊 Leads + RFM</SelectItem>
        </SelectContent>
      </Select>

      {(audienceMode === "campaigns" || audienceMode === "both") && (
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Leads por Campanha</Label>
          {loadingCampaigns ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1"><Loader2 className="h-3 w-3 animate-spin" />Carregando...</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {campaigns.map(c => (
                <Badge key={c.tag} variant={selectedCampaigns.includes(c.tag) ? "default" : "outline"} className="cursor-pointer text-[10px] px-2 py-0.5" onClick={() => toggleCampaign(c.tag)}>
                  {c.tag} ({c.count})
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {(audienceMode === "rfm" || audienceMode === "both") && (
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Segmentos RFM</Label>
          {loadingRfm ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1"><Loader2 className="h-3 w-3 animate-spin" />Carregando...</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {rfmSegments.map(s => (
                <Badge key={s.segment} variant={selectedRfmSegments.includes(s.segment) ? "default" : "outline"} className="cursor-pointer text-[10px] px-2 py-0.5" onClick={() => toggleRfmSegment(s.segment)}>
                  {s.segment} ({s.count})
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Instance Selector for Automations ──────────────────

function AutomationInstanceSelector({ triggerConfig, onChange }: { triggerConfig: any; onChange: (c: any) => void }) {
  const { numbers, fetchNumbers } = useWhatsAppNumberStore();
  const selectedInstances: string[] = triggerConfig.whatsapp_instances || [];

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  const allInstances = [
    { id: 'zapi', label: 'Z-API', type: 'zapi' },
    ...numbers.map(n => ({ id: n.id, label: n.label || n.phone_display, type: 'meta' })),
  ];

  const toggle = (id: string) => {
    const current = [...selectedInstances];
    const idx = current.indexOf(id);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(id);
    onChange({ ...triggerConfig, whatsapp_instances: current });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">Instâncias WhatsApp (vazio = todas)</Label>
      <div className="flex flex-wrap gap-1.5">
        {allInstances.map(inst => (
          <Badge
            key={inst.id}
            variant={selectedInstances.includes(inst.id) ? "default" : "outline"}
            className="cursor-pointer text-[10px] px-2 py-0.5"
            onClick={() => toggle(inst.id)}
          >
            {inst.type === 'zapi' ? '📱' : '☁️'} {inst.label}
          </Badge>
        ))}
      </div>
      {selectedInstances.length > 0 && (
        <p className="text-[10px] text-muted-foreground">{selectedInstances.length} instância(s) selecionada(s)</p>
      )}
    </div>
  );
}

function PosSaleTriggerConfig({ triggerConfig, onChange }: { triggerConfig: any; onChange: (c: any) => void }) {
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [sellers, setSellers] = useState<Array<{ id: string; name: string; store_id: string | null }>>([]);
  const selectedStoreId: string = triggerConfig.store_id || "all";
  const selectedSellerId: string = triggerConfig.seller_id || "all";
  const minTotal: number = Number(triggerConfig.min_total || 0);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("pos_stores").select("id, name").order("name");
      setStores((s as any) || []);
      const { data: sl } = await supabase.from("pos_sellers").select("id, name, store_id").order("name");
      setSellers((sl as any) || []);
    })();
  }, []);

  const filteredSellers = selectedStoreId === "all"
    ? sellers
    : sellers.filter(s => s.store_id === selectedStoreId);

  return (
    <div className="space-y-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
      <p className="text-[10px] text-amber-700 dark:text-amber-300">
        <ShoppingBag className="h-3 w-3 inline mr-1" />
        Disparado quando uma venda física é concluída. Filtre por loja para usar a instância Meta vinculada.
      </p>
      <div className="space-y-1">
        <Label className="text-xs">Loja</Label>
        <Select
          value={selectedStoreId}
          onValueChange={v => onChange({ ...triggerConfig, store_id: v === "all" ? null : v, seller_id: null })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as lojas</SelectItem>
            {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Crie um fluxo separado por loja para usar instância Meta dedicada (ex: Centro, Pérola).
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Vendedora (opcional)</Label>
        <Select
          value={selectedSellerId}
          onValueChange={v => onChange({ ...triggerConfig, seller_id: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {filteredSellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Ticket mínimo (R$, opcional)</Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={minTotal || ""}
          onChange={e => onChange({ ...triggerConfig, min_total: parseFloat(e.target.value) || 0 })}
          placeholder="Ex: 100"
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}

// ─── Event Lead Captured Config (select which event the lead registered for) ──
function EventLeadCaptureConfig({ triggerConfig, onChange }: { triggerConfig: any; onChange: (c: any) => void }) {
  const [events, setEvents] = useState<Array<{ id: string; name: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const selectedEventId: string = triggerConfig.event_id || "all";
  const selectedSource: string = triggerConfig.source || "all";

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("id, name, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      setEvents((data as any) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
      <p className="text-[10px] text-purple-700 dark:text-purple-300">
        <Users className="h-3 w-3 inline mr-1" />
        Selecione o evento no qual a pessoa se cadastrou. Cada evento pode ter informações de cadastro diferentes.
      </p>
      <div className="space-y-1">
        <Label className="text-xs">Evento</Label>
        <Select
          value={selectedEventId}
          onValueChange={v => onChange({ ...triggerConfig, event_id: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={loading ? "Carregando..." : "Todos os eventos"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os eventos</SelectItem>
            {events.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Crie um fluxo separado por evento para enviar mensagens específicas de cada cadastro.
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Origem do cadastro (opcional)</Label>
        <Select
          value={selectedSource}
          onValueChange={v => onChange({ ...triggerConfig, source: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Qualquer origem</SelectItem>
            <SelectItem value="landing_page">Landing Page (LP)</SelectItem>
            <SelectItem value="typebot">Typebot</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
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
  const [flowName, setFlowName] = useState(flow.name);
  const [triggerType, setTriggerType] = useState(flow.trigger_type);
  const [triggerConfig, setTriggerConfig] = useState<any>(() => {
    // Strip node_positions from triggerConfig state to avoid unnecessary rebuilds
    const { node_positions, ...rest } = (flow.trigger_config || {}) as any;
    return rest;
  });
  const [isActive, setIsActive] = useState(flow.is_active);
  const [useJessAgent, setUseJessAgent] = useState(flow.use_jess_agent || false);
  const [jessCampaignName, setJessCampaignName] = useState(flow.jess_campaign_name || '');
  const [editingStep, setEditingStep] = useState<AutomationStep | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [steps, setSteps] = useState<AutomationStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testName, setTestName] = useState("Teste");
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any[] | null>(null);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchPaused, setDispatchPaused] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [alreadySentCount, setAlreadySentCount] = useState<number>(0);
  const [loadingAudienceCount, setLoadingAudienceCount] = useState(false);
  const pauseRef = useRef(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Detect running/paused job on dialog open
  useEffect(() => {
    if (!dispatchDialogOpen) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("automation_dispatch_jobs")
        .select("*")
        .eq("flow_id", flow.id)
        .in("status", ["running", "paused", "queued"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      setActiveJobId(data.id);
      setDispatching(data.status === "running" || data.status === "queued");
      setDispatchPaused(data.status === "paused");
      setDispatchResult({
        sent: data.sent, failed: data.failed, skipped: data.skipped,
        totalAudience: data.total_audience, done: data.status === "done",
        processing: data.status === "running", paused: data.status === "paused",
      });
    })();
    return () => { cancelled = true; };
  }, [dispatchDialogOpen, flow.id]);

  useEffect(() => {
    if (!activeJobId) return;
    const ch = supabase
      .channel(`auto-job-${activeJobId}`)
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "automation_dispatch_jobs", filter: `id=eq.${activeJobId}` }, (payload: any) => {
        const j = payload.new;
        setDispatchResult({
          sent: j.sent, failed: j.failed, skipped: j.skipped,
          totalAudience: j.total_audience, done: j.status === "done",
          processing: j.status === "running", paused: j.status === "paused",
          error: j.status === "error" ? j.error_message : undefined,
        });
        if (j.status === "done") { setDispatching(false); setDispatchPaused(false); toast.success(`Disparo concluído! ${j.sent} enviadas`); }
        if (j.status === "paused") { setDispatching(false); setDispatchPaused(true); }
        if (j.status === "error") { setDispatching(false); }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeJobId]);

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

  // Track saved positions so user-dragged positions persist across rebuilds AND page refreshes
  const nodePositionsRef = useRef<Record<string, { x: number; y: number }>>(
    (flow.trigger_config as any)?.node_positions || {}
  );
  const positionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerConfigRef = useRef(triggerConfig);
  useEffect(() => { triggerConfigRef.current = triggerConfig; }, [triggerConfig]);

  // Save positions to DB on unmount if there's a pending save
  useEffect(() => {
    return () => {
      if (positionSaveTimerRef.current) {
        clearTimeout(positionSaveTimerRef.current);
        supabase
          .from("automation_flows")
          .update({ trigger_config: { ...triggerConfigRef.current, node_positions: nodePositionsRef.current } })
          .eq("id", flow.id)
          .then();
      }
    };
  }, [flow.id]);

  const buildNodesAndEdges = useCallback(() => {
    const nodes: Node[] = [
      {
        id: "trigger",
        type: "trigger",
        position: nodePositionsRef.current["trigger"] || { x: 250, y: 50 },
        data: { triggerType, ...triggerConfig },
        draggable: true,
      },
    ];
    const edges: Edge[] = [];

    // Collect all step IDs that are referenced as a branch target from ANY step,
    // so we don't also add a sequential edge to them.
    const branchTargetIds = new Set<string>();
    steps.forEach((s) => {
      const cfg = (s.action_config || {}) as any;
      const branches = cfg.buttonBranches || {};
      Object.values(branches).forEach((targetId) => {
        if (typeof targetId === "string") branchTargetIds.add(targetId);
      });
    });

    steps.forEach((step, idx) => {
      const nodeId = `step-${step.id}`;
      const cfg = (step.action_config || {}) as any;
      nodes.push({
        id: nodeId,
        type: "action",
        position: nodePositionsRef.current[nodeId] || { x: 250, y: 180 + idx * 150 },
        data: {
          actionType: step.action_type,
          order: idx + 1,
          delaySeconds: step.delay_seconds,
          minutes: cfg.minutes,
          delayValue: cfg.delayValue || cfg.minutes,
          delayUnit: cfg.delayUnit || "minutes",
          templateName: cfg.templateName,
          templateVars: cfg.templateVars,
          headerMediaUrl: cfg.headerMediaUrl,
          message: cfg.message,
          mediaUrl: cfg.mediaUrl,
          tags: cfg.tags,
          promptPreview: cfg.prompt?.slice(0, 40) || cfg.crosssellPrompt?.slice(0, 40),
          timeoutAction: cfg.timeoutAction,
          productPool: cfg.productPool,
          carouselCards: cfg.carouselCards,
          hasDeadline: cfg.hasDeadline,
          deadline: cfg.deadline,
          quickReplyButtons: cfg.quickReplyButtons || [],
          interactiveButtons: cfg.interactiveButtons || [],
          buttonBranches: cfg.buttonBranches || {},
          onDelete: () => deleteStep(step.id),
        },
        draggable: true,
      });

      // 1) Emit branch edges declared on THIS step's buttonBranches
      const branches = cfg.buttonBranches || {};
      for (const [handleId, targetStepId] of Object.entries(branches)) {
        if (typeof targetStepId !== "string") continue;
        if (!steps.some(s => s.id === targetStepId)) continue;
        edges.push({
          id: `e-branch-${step.id}-${handleId}`,
          source: nodeId,
          sourceHandle: handleId,
          target: `step-${targetStepId}`,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
          label: handleId === 'btn-timeout' ? '⏳ Sem resposta' : `↩️ ${(cfg.quickReplyButtons || cfg.interactiveButtons || [])[parseInt(handleId.replace('btn-', ''))] || '?'}`,
          style: { stroke: handleId === 'btn-timeout' ? "hsl(30, 90%, 50%)" : "hsl(217, 91%, 60%)", strokeWidth: 2 },
        });
      }

      // 2) Emit sequential edge from previous node ONLY if:
      //    - this step is not the target of any branch, AND
      //    - the previous step does not have button branches (those nodes only flow via branches)
      const prevStep = idx > 0 ? steps[idx - 1] : null;
      const prevNodeId = idx === 0 ? "trigger" : `step-${prevStep!.id}`;
      const prevCfg = prevStep ? (prevStep.action_config || {}) as any : null;
      const prevHasButtons = !!(prevCfg && ((prevCfg.quickReplyButtons && prevCfg.quickReplyButtons.length > 0) || (prevCfg.interactiveButtons && prevCfg.interactiveButtons.length > 0)));

      if (branchTargetIds.has(step.id)) {
        // Already wired via a branch — skip sequential
        return;
      }
      if (prevHasButtons) {
        // Don't auto-chain after a template-with-buttons step; user must explicitly route
        return;
      }
      edges.push({
        id: `e-${idx}`,
        source: prevNodeId,
        target: nodeId,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      });
    });
    return { nodes, edges };
  }, [steps, triggerType, triggerConfig]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Only rebuild nodes from DB when steps array changes (length or IDs)
  const stepsKey = steps.map(s => s.id).join(",");
  useEffect(() => {
    const { nodes: n, edges: e } = buildNodesAndEdges();
    setNodes(n);
    setEdges(e);
  }, [stepsKey, triggerType, triggerConfig]);

  // Save positions when nodes are dragged
  const handleNodesChange = useCallback((changes: any) => {
    onNodesChange(changes);
    // After changes, save current positions in ref and debounce-persist to DB
    setTimeout(() => {
      setNodes(currentNodes => {
        currentNodes.forEach(n => {
          nodePositionsRef.current[n.id] = { x: n.position.x, y: n.position.y };
        });
        return currentNodes;
      });
    }, 0);
    // Debounce saving positions to the database
    if (positionSaveTimerRef.current) clearTimeout(positionSaveTimerRef.current);
    positionSaveTimerRef.current = setTimeout(() => {
      supabase
        .from("automation_flows")
        .update({ trigger_config: { ...triggerConfigRef.current, node_positions: nodePositionsRef.current } })
        .eq("id", flow.id)
        .then(({ error }) => {
          if (error) console.error('Failed to save node positions:', error);
        });
    }, 1000);
  }, [onNodesChange, setNodes, flow.id]);

  const onConnect = useCallback(async (conn: Connection) => {
    // If connection comes from a button handle (btn-0, btn-1, btn-timeout), save to step config
    if (conn.sourceHandle && conn.sourceHandle.startsWith('btn-') && conn.source) {
      const sourceStepId = conn.source.replace('step-', '');
      const targetStepId = conn.target?.replace('step-', '');
      const sourceStep = steps.find(s => s.id === sourceStepId);
      if (sourceStep && targetStepId) {
        const cfg = (sourceStep.action_config || {}) as any;
        const buttonBranches = { ...(cfg.buttonBranches || {}), [conn.sourceHandle]: targetStepId };
        await supabase
          .from("automation_steps")
          .update({ action_config: { ...cfg, buttonBranches } })
          .eq("id", sourceStepId);
        fetchSteps();
      }
    }
    setEdges(eds => addEdge({
      ...conn,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      label: conn.sourceHandle?.startsWith('btn-') ? (conn.sourceHandle === 'btn-timeout' ? '⏳' : `↩️`) : undefined,
      style: conn.sourceHandle?.startsWith('btn-')
        ? { stroke: conn.sourceHandle === 'btn-timeout' ? "hsl(30, 90%, 50%)" : "hsl(217, 91%, 60%)", strokeWidth: 2 }
        : undefined,
    }, eds));
  }, [steps]);

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
    const defaultConfig: any = actionType === "delay" ? { minutes: 5 } : actionType === "wait_for_reply" ? { timeoutHours: 24, timeoutAction: "cancel" } : actionType === "ai_response" ? { prompt: "", maxInteractions: 5 } : actionType === "add_tag" ? { tags: [], condition: "always" } : actionType === "ai_crosssell" ? { crosssellPrompt: "", crosssellIntro: "", productPool: [], maxInteractions: 5, discountPercent: 0 } : {};
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

  const runTestFlow = async () => {
    if (!testPhone.trim()) { toast.error("Informe o número de WhatsApp"); return; }
    setTesting(true);
    setTestResults(null);
    try {
      const res = await supabase.functions.invoke("automation-test-flow", {
        body: { flowId: flow.id, phone: testPhone, testName },
      });
      if (res.error) throw new Error(res.error.message);
      setTestResults(res.data?.results || []);
      const sent = (res.data?.results || []).filter((r: any) => r.status === "sent").length;
      toast.success(`Teste concluído! ${sent} mensagem(ns) enviada(s)`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao testar fluxo");
    } finally {
      setTesting(false);
    }
  };

  const openDispatchDialog = async () => {
    setDispatchResult(null);
    setAudienceCount(null);
    setAlreadySentCount(0);
    setDispatchDialogOpen(true);
    const configWithPositions = { ...triggerConfig, node_positions: nodePositionsRef.current };
    await supabase.from("automation_flows").update({ name: flowName, trigger_type: triggerType, trigger_config: configWithPositions, is_active: isActive, use_jess_agent: useJessAgent, jess_campaign_name: jessCampaignName || null }).eq("id", flow.id);
    setLoadingAudienceCount(true);
    try {
      const res = await supabase.functions.invoke("automation-dispatch-audience", {
        body: { flowId: flow.id, dryRun: true },
      });
      if (res.data?.audienceCount !== undefined) {
        setAudienceCount(res.data.audienceCount);
      }
      if (res.data?.alreadySent !== undefined) {
        setAlreadySentCount(res.data.alreadySent);
      }
    } catch { /* silent */ }
    setLoadingAudienceCount(false);
  };

  const runDispatch = async () => {
    setDispatching(true);
    setDispatchPaused(false);
    setDispatchResult({ sent: 0, failed: 0, skipped: 0, totalAudience: audienceCount || 0, processing: true, done: false });

    try {
      // 1) Create job in DB (server-side state — survives tab close)
      const { data: jobRow, error: jobErr } = await supabase
        .from("automation_dispatch_jobs")
        .insert({
          flow_id: flow.id,
          status: "running",
          total_audience: audienceCount || 0,
          batch_size: 2000,
        })
        .select()
        .single();
      if (jobErr || !jobRow) throw new Error(jobErr?.message || "Erro ao criar job");
      setActiveJobId(jobRow.id);

      // 2) Kick off first batch (fire-and-forget — server self-chains via heartbeat + cron recovery)
      supabase.functions.invoke("automation-dispatch-audience", {
        body: { jobId: jobRow.id },
      }).catch(err => console.error("[dispatch] kick failed", err));

      toast.success("Disparo iniciado. Você pode fechar a aba — continua rodando no servidor.");
    } catch (err: any) {
      toast.error(err.message || "Erro ao disparar");
      setDispatching(false);
      setDispatchResult(prev => ({ ...prev, error: err.message, done: false }));
    }
  };

  const handlePauseDispatch = async () => {
    if (!activeJobId) return;
    await supabase.from("automation_dispatch_jobs").update({ status: "paused" }).eq("id", activeJobId);
    setDispatchPaused(true);
  };

  const handleResumeDispatch = async () => {
    if (!activeJobId) return;
    await supabase.from("automation_dispatch_jobs").update({ status: "running", heartbeat_at: new Date().toISOString() }).eq("id", activeJobId);
    setDispatchPaused(false);
    setDispatching(true);
    supabase.functions.invoke("automation-dispatch-audience", { body: { jobId: activeJobId } }).catch(() => {});
  };

  const saveFlow = async () => {
    setSaving(true);
    const configWithPositions = { ...triggerConfig, node_positions: nodePositionsRef.current };
    const { error } = await supabase
      .from("automation_flows")
      .update({ name: flowName, trigger_type: triggerType, trigger_config: configWithPositions, is_active: isActive, use_jess_agent: useJessAgent, jess_campaign_name: jessCampaignName || null })
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
          <Button variant="outline" size="sm" onClick={() => { setTestDialogOpen(true); setTestResults(null); }} disabled={steps.length === 0} className="gap-1">
            <PlayCircle className="h-3.5 w-3.5" />Testar
          </Button>
          {triggerType === "mass_audience" && (
            <Button variant="default" size="sm" onClick={openDispatchDialog} disabled={steps.length === 0 || dispatching} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Send className="h-3.5 w-3.5" />Disparar Audiência
            </Button>
          )}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
            <Sparkles className="h-3 w-3 text-purple-500" />
            <span className="text-[10px] text-purple-700 dark:text-purple-300">Jess</span>
            <Switch checked={useJessAgent} onCheckedChange={setUseJessAgent} className="scale-75" />
          </div>
          {useJessAgent && (
            <Input
              value={jessCampaignName}
              onChange={e => setJessCampaignName(e.target.value)}
              placeholder="Nome da campanha (leads)"
              className="max-w-[180px] h-7 text-xs"
            />
          )}
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
                {triggerType === "mass_audience" && (
                  <MassAudienceConfig triggerConfig={triggerConfig} onChange={setTriggerConfig} />
                )}
                {triggerType === "new_lead" && (
                  <NewLeadCampaignSelector triggerConfig={triggerConfig} onChange={setTriggerConfig} />
                )}
                {triggerType === "incoming_message" && (
                  <div className="space-y-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                    <p className="text-[10px] text-blue-700 dark:text-blue-300">
                      <MessageSquare className="h-3 w-3 inline mr-1" />
                      Dispara quando o cliente envia mensagem e <b>não recebeu resposta</b> nas últimas X horas. Evita conflito com vendedoras que já estão atendendo.
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">Cooldown (horas sem resposta)</Label>
                      <Input type="number" value={triggerConfig.cooldown_hours ?? 2} onChange={e => setTriggerConfig({ ...triggerConfig, cooldown_hours: parseInt(e.target.value) || 2 })} className="h-8 text-xs" min={1} max={168} />
                      <p className="text-[10px] text-muted-foreground">Só ativa se nenhuma mensagem outgoing foi enviada nesse período</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Máx. ativações por contato/dia</Label>
                      <Input type="number" value={triggerConfig.max_per_day ?? 1} onChange={e => setTriggerConfig({ ...triggerConfig, max_per_day: parseInt(e.target.value) || 1 })} className="h-8 text-xs" min={1} max={10} />
                    </div>
                  </div>
                )}
                {triggerType === "stage_change" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Para estágio</Label>
                    <Input value={triggerConfig.to_stage || ""} onChange={e => setTriggerConfig({ ...triggerConfig, to_stage: e.target.value })} placeholder="confirmed" className="h-8 text-xs" />
                  </div>
                )}
                {triggerType === "shopify_purchase" && (
                  <div className="space-y-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                    <p className="text-[10px] text-green-700 dark:text-green-300">
                      <ShoppingCart className="h-3 w-3 inline mr-1" />
                      Disparado automaticamente quando a Shopify envia o webhook de pedido pago. O cliente precisa ter telefone no pedido.
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">Filtrar por tag do produto (opcional)</Label>
                      <Input value={triggerConfig.product_tag || ""} onChange={e => setTriggerConfig({ ...triggerConfig, product_tag: e.target.value })} placeholder="Ex: calcado, acessorio" className="h-8 text-xs" />
                    </div>
                  </div>
                )}
                {triggerType === "pos_sale_completed" && (
                  <PosSaleTriggerConfig triggerConfig={triggerConfig} onChange={setTriggerConfig} />
                )}
                {triggerType === "yampi_abandoned_cart" && (
                  <div className="space-y-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                    <p className="text-[10px] text-red-700 dark:text-red-300">
                      <Package className="h-3 w-3 inline mr-1" />
                      Disparado quando a Yampi envia o webhook de carrinho abandonado. O contato será identificado pelo telefone do cliente.
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">Delay mínimo após abandono (min)</Label>
                      <Input type="number" value={triggerConfig.min_delay_minutes || 30} onChange={e => setTriggerConfig({ ...triggerConfig, min_delay_minutes: parseInt(e.target.value) || 30 })} className="h-8 text-xs" min={5} />
                    </div>
                  </div>
                )}

                {/* Instance selector for all triggers */}
                <div className="mt-3">
                  <AutomationInstanceSelector triggerConfig={triggerConfig} onChange={setTriggerConfig} />
                </div>

                {/* Audience selector */}
                <div className="mt-3">
                  <AudienceSelector triggerConfig={triggerConfig} onChange={setTriggerConfig} />
                </div>
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
              onNodesChange={handleNodesChange}
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
        allSteps={steps}
        onSave={handleStepSave}
      />


      {/* Test Flow Dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-green-500" />
              Testar Fluxo em Tempo Real
            </DialogTitle>
          </DialogHeader>

          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
              Todas as mensagens serão enviadas <strong>imediatamente</strong> para o número informado. Delays e esperas são ignorados no modo teste.
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Número WhatsApp (com DDD)</Label>
              <Input
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="11999999999"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome para variáveis</Label>
              <Input
                value={testName}
                onChange={e => setTestName(e.target.value)}
                placeholder="Teste"
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                Usado como {"{{nome}}"} nas mensagens. Outros dados usam valores fictícios.
              </p>
            </div>
          </div>

          {/* Step summary */}
          <div className="p-2 bg-muted rounded-lg space-y-1">
            <p className="text-[10px] font-medium">Etapas que serão executadas:</p>
            {steps.map((s, i) => {
              const a = ACTION_TYPES.find(a => a.value === s.action_type);
              const Icon = a?.icon || Send;
              const isSkippable = ["delay", "wait_for_reply", "ai_response", "ai_crosssell"].includes(s.action_type);
              return (
                <div key={s.id} className={`flex items-center gap-2 text-[10px] ${isSkippable ? "opacity-50" : ""}`}>
                  <span className="text-muted-foreground w-4">{i + 1}.</span>
                  <Icon className={`h-3 w-3 ${a?.color || "text-primary"}`} />
                  <span>{a?.label}</span>
                  {isSkippable && <Badge variant="outline" className="text-[8px] px-1">skip</Badge>}
                </div>
              );
            })}
          </div>

          {/* Results */}
          {testResults && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Resultado do Teste</Label>
              {testResults.map((r: any, i: number) => (
                <div key={i} className={`flex items-center gap-2 p-2 rounded-lg text-xs border ${
                  r.status === "sent" ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" :
                  r.status === "skipped" ? "bg-muted border-border" :
                  r.status === "logged" ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" :
                  "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                }`}>
                  <span className="font-mono text-muted-foreground w-5">{r.step}</span>
                  <span className={`font-medium ${
                    r.status === "sent" ? "text-green-700 dark:text-green-300" :
                    r.status === "error" ? "text-red-700 dark:text-red-300" :
                    "text-muted-foreground"
                  }`}>
                    {r.status === "sent" ? "✅" : r.status === "skipped" ? "⏭️" : r.status === "logged" ? "📝" : "❌"} {r.type}
                  </span>
                  {r.detail && <span className="text-muted-foreground truncate flex-1 text-[10px]">{r.detail}</span>}
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>Fechar</Button>
            <Button onClick={runTestFlow} disabled={testing || !testPhone.trim()} className="gap-1">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {testing ? "Enviando..." : "Disparar Teste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispatch Audience Dialog */}
      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-emerald-500" />
              Disparar para Audiência
            </DialogTitle>
          </DialogHeader>

          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <p className="text-xs text-red-700 dark:text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
              Esta ação enviará mensagens para <strong>todos os destinatários</strong> da audiência configurada. Essa operação <strong>não pode ser desfeita</strong>.
            </p>
          </div>

          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Fluxo</span>
                <span className="text-xs font-semibold">{flowName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Etapas</span>
                <span className="text-xs font-semibold">{steps.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Audiência estimada</span>
                {loadingAudienceCount ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <Badge className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                    {audienceCount !== null ? `${audienceCount.toLocaleString("pt-BR")} destinatário(s)` : "—"}
                  </Badge>
                )}
              </div>
              {alreadySentCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Já enviados anteriormente</span>
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    {alreadySentCount.toLocaleString("pt-BR")} pulados
                  </Badge>
                </div>
              )}
            </div>

            {/* Step summary */}
            <div className="p-2 bg-muted rounded-lg space-y-1">
              <p className="text-[10px] font-medium">Primeira ação do fluxo:</p>
              {steps.slice(0, 3).map((s, i) => {
                const a = ACTION_TYPES.find(a => a.value === s.action_type);
                const Icon = a?.icon || Send;
                return (
                  <div key={s.id} className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground w-4">{i + 1}.</span>
                    <Icon className={`h-3 w-3 ${a?.color || "text-primary"}`} />
                    <span>{a?.label}</span>
                  </div>
                );
              })}
              {steps.length > 3 && <p className="text-[9px] text-muted-foreground">+{steps.length - 3} etapa(s) adicionais</p>}
            </div>
          </div>

          {/* Dispatch Result */}
          {dispatchResult && !dispatchResult.error && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-2">
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {dispatchResult.done ? "✅ Disparo concluído!" : dispatchResult.paused ? "⏸️ Disparo pausado" : "⏳ Disparando em lotes..."}
              </p>
              {/* Progress bar */}
              {dispatchResult.totalAudience > 0 && (
                <div className="space-y-1">
                  <div className="w-full bg-emerald-100 dark:bg-emerald-900 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, ((dispatchResult.sent + dispatchResult.failed + dispatchResult.skipped) / dispatchResult.totalAudience) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground text-right">
                    {(dispatchResult.sent + dispatchResult.failed + dispatchResult.skipped).toLocaleString("pt-BR")} / {dispatchResult.totalAudience.toLocaleString("pt-BR")}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-emerald-600">{dispatchResult.sent.toLocaleString("pt-BR")}</p>
                  <p className="text-[10px] text-muted-foreground">Enviadas</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-red-500">{dispatchResult.failed.toLocaleString("pt-BR")}</p>
                  <p className="text-[10px] text-muted-foreground">Falhas</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-muted-foreground">{dispatchResult.skipped.toLocaleString("pt-BR")}</p>
                  <p className="text-[10px] text-muted-foreground">Puladas</p>
                </div>
              </div>
            </div>
          )}
          {dispatchResult?.error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 space-y-1">
              <p className="text-xs text-red-700 dark:text-red-300">❌ {dispatchResult.error}</p>
              {dispatchResult.sent > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Progresso antes do erro: {dispatchResult.sent.toLocaleString("pt-BR")} enviadas, {dispatchResult.failed.toLocaleString("pt-BR")} falhas
                </p>
              )}
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDispatchDialogOpen(false)}>Fechar</Button>
            {dispatching && !dispatchPaused && (
              <Button onClick={handlePauseDispatch} variant="destructive" className="gap-1">
                <StopCircle className="h-3.5 w-3.5" />
                Pausar
              </Button>
            )}
            <Button
              onClick={dispatchPaused ? handleResumeDispatch : runDispatch}
              disabled={(dispatching && !dispatchPaused) || audienceCount === 0 || loadingAudienceCount || (dispatchResult?.done === true)}
              className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {dispatching && !dispatchPaused ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {dispatchResult?.done
                ? "Concluído"
                : dispatchPaused
                  ? "Retomar Disparo"
                  : dispatching
                    ? "Disparando..."
                    : `Confirmar Disparo${audienceCount ? ` (${audienceCount.toLocaleString("pt-BR")})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const [execStats, setExecStats] = useState<Record<string, { total: number; success: number; failed: number; lastAt: string | null }>>({});
  const [showExecLog, setShowExecLog] = useState(false);
  const [execLog, setExecLog] = useState<any[]>([]);
  const [execLogLoading, setExecLogLoading] = useState(false);

  const fetchFlows = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("automation_flows").select("*").order("created_at", { ascending: false });
    setFlows((data || []) as AutomationFlow[]);
    setLoading(false);
  }, []);

  const fetchExecStats = useCallback(async () => {
    const { data } = await supabase.from("automation_executions").select("flow_id, status, executed_at").order("executed_at", { ascending: false });
    if (!data) return;
    const stats: Record<string, { total: number; success: number; failed: number; lastAt: string | null }> = {};
    for (const row of data) {
      if (!stats[row.flow_id]) stats[row.flow_id] = { total: 0, success: 0, failed: 0, lastAt: null };
      const s = stats[row.flow_id];
      s.total++;
      if (row.status === 'success' || row.status === 'sent' || row.status === 'delivered' || row.status === 'read') s.success++;
      else if (row.status === 'error' || row.status === 'failed') s.failed++;
      if (!s.lastAt) s.lastAt = row.executed_at;
    }
    setExecStats(stats);
  }, []);

  const fetchExecLog = useCallback(async () => {
    setExecLogLoading(true);
    const { data } = await supabase
      .from("automation_executions")
      .select("*, automation_flows(name), automation_steps(action_type, step_order)")
      .order("executed_at", { ascending: false })
      .limit(100);
    setExecLog(data || []);
    setExecLogLoading(false);
  }, []);

  useEffect(() => { fetchFlows(); fetchExecStats(); }, [fetchFlows, fetchExecStats]);

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

  const duplicateFlow = async (flow: AutomationFlow) => {
    try {
      // 1) Fetch original steps
      const { data: srcSteps, error: stepsErr } = await supabase
        .from("automation_steps")
        .select("*")
        .eq("flow_id", flow.id)
        .order("step_order");
      if (stepsErr) throw stepsErr;

      // 2) Create new flow (inactive by default)
      const { data: newFlow, error: flowErr } = await supabase
        .from("automation_flows")
        .insert({
          name: `${flow.name} (cópia)`,
          description: (flow as any).description || null,
          trigger_type: flow.trigger_type,
          trigger_config: (flow as any).trigger_config || {},
          is_active: false,
          event_id: (flow as any).event_id || null,
          use_jess_agent: (flow as any).use_jess_agent || false,
          jess_campaign_name: (flow as any).jess_campaign_name || null,
        })
        .select()
        .single();
      if (flowErr) throw flowErr;

      // 3) Pre-allocate new step IDs to remap buttonBranches
      const idMap: Record<string, string> = {};
      const cryptoRef: any = (globalThis as any).crypto;
      const genId = () => (cryptoRef?.randomUUID ? cryptoRef.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      for (const s of srcSteps || []) idMap[s.id] = genId();

      const remapped = (srcSteps || []).map((s: any) => {
        const cfg = { ...(s.action_config || {}) };
        if (cfg.buttonBranches && typeof cfg.buttonBranches === 'object') {
          const nb: Record<string, string> = {};
          for (const [k, v] of Object.entries(cfg.buttonBranches as Record<string, string>)) {
            nb[k] = idMap[v] || v;
          }
          cfg.buttonBranches = nb;
        }
        return {
          id: idMap[s.id],
          flow_id: newFlow.id,
          step_order: s.step_order,
          action_type: s.action_type,
          action_config: cfg,
          delay_seconds: s.delay_seconds || 0,
        };
      });

      if (remapped.length > 0) {
        const { error: insErr } = await supabase.from("automation_steps").insert(remapped);
        if (insErr) throw insErr;
      }

      toast.success(`Automação duplicada como "${newFlow.name}"`);
      fetchFlows();
    } catch (e: any) {
      console.error("[duplicateFlow]", e);
      toast.error(`Erro ao duplicar: ${e.message || e}`);
    }
  };

  if (selectedFlow) {
    return <FlowEditor key={selectedFlow.id} flow={selectedFlow} onBack={async () => { setSelectedFlow(null); await fetchFlows(); }} onSave={fetchFlows} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Crie automações de disparo por gatilhos com IA, templates e mensagens ricas.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setShowExecLog(true); fetchExecLog(); }} className="gap-1">
            <FileText className="h-3.5 w-3.5" />Log de Disparos
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1"><Plus className="h-3.5 w-3.5" />Nova Automação</Button>
        </div>
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
            const stats = execStats[flow.id];
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
                    {stats && (
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-muted-foreground">{stats.total} disparos</span>
                        <span className="text-[10px] text-emerald-600">{stats.success} ✓</span>
                        {stats.failed > 0 && <span className="text-[10px] text-destructive">{stats.failed} ✗</span>}
                        {stats.lastAt && <span className="text-[10px] text-muted-foreground">Último: {new Date(stats.lastAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <Switch checked={flow.is_active} onCheckedChange={() => toggleActive(flow)} />
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Duplicar" onClick={() => duplicateFlow(flow)}>
                      <Copy className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Excluir" onClick={() => deleteFlow(flow.id)}>
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

      {/* Execution Log Dialog */}
      <Dialog open={showExecLog} onOpenChange={setShowExecLog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Log de Disparos</DialogTitle>
          </DialogHeader>
          {execLogLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : execLog.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">Nenhuma execução registrada</p>
          ) : (
            <ScrollArea className="flex-1 max-h-[60vh]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium">Data/Hora</th>
                    <th className="text-left py-2 px-2 font-medium">Fluxo</th>
                    <th className="text-left py-2 px-2 font-medium">Ação</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 px-2 font-medium">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {execLog.map(ex => (
                    <tr key={ex.id} className="border-b hover:bg-muted/50">
                      <td className="py-1.5 px-2 whitespace-nowrap">{new Date(ex.executed_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                      <td className="py-1.5 px-2">{ex.automation_flows?.name || '—'}</td>
                      <td className="py-1.5 px-2">{ex.automation_steps?.action_type || '—'} {ex.automation_steps?.step_order != null ? `(#${ex.automation_steps.step_order})` : ''}</td>
                      <td className="py-1.5 px-2">
                        <Badge variant={ex.status === 'success' ? 'default' : 'destructive'} className="text-[10px]">{ex.status}</Badge>
                      </td>
                      <td className="py-1.5 px-2 text-destructive max-w-[200px] truncate">{ex.error_message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
