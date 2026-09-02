import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Send, Variable, Images, AlertCircle, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { uploadMediaToStorage } from "@/components/MediaAttachmentPicker";
import { ShopifyImagePicker } from "@/components/events/ShopifyImagePicker";
import { useTeamIdentity } from "@/hooks/chat/useTeamIdentity";
import { getOrderFinalValue } from "@/lib/orderTotal";
import type { DbOrder } from "@/types/database";
import type { Stage } from "@/types/order";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CHECKOUT_BASE = "https://checkout.bananacalcados.com.br";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  orders: DbOrder[];
  stages: Stage[];
  initialStage?: string | null;
  onQueued?: (sendId: string) => void;
}

interface MetaComponent { type: string; format?: string; text?: string; cards?: Array<{ components: MetaComponent[] }>; example?: { header_handle?: string[] } }
interface MetaTemplate { name: string; language: string; status: string; category?: string; components: MetaComponent[] }
interface DbCarousel { id: string; nome: string; template_id: string; template_language: string; qtd_cards: number; whatsapp_number_id: string | null }

const VAR_OPTIONS: { key: string; label: string }[] = [
  { key: "nome", label: "Nome do cliente" },
  { key: "instagram", label: "@ Instagram" },
  { key: "valor_compra", label: "Valor da compra" },
  { key: "qtd_itens", label: "Qtd. de itens" },
  { key: "primeiro_produto", label: "1º produto" },
  { key: "link_checkout", label: "Link do checkout" },
  { key: "link_area_membros", label: "Link autenticado da Área de Membros" },
];

const formatBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const countVarSlots = (text?: string) => {
  const m = (text || "").match(/\{\{\s*(\d+)\s*\}\}/g);
  return m ? Math.max(...m.map((s) => parseInt(s.replace(/\D/g, ""), 10))) : 0;
};
const findComp = (comps: MetaComponent[] | undefined, type: string) =>
  (comps || []).find((c) => (c.type || "").toUpperCase() === type);

/** Contexto de variáveis por pedido (resolvido no cliente; link da área de membros é resolvido no backend). */
export function buildOrderVars(o: DbOrder): Record<string, string> {
  const ig = (o.customer?.instagram_handle || "").replace(/^@/, "");
  const nome = (o.customer?.full_name || "").trim() || ig;
  const products = o.products || [];
  return {
    nome,
    instagram: ig ? `@${ig}` : "",
    valor_compra: formatBRL(getOrderFinalValue(o)),
    qtd_itens: String(products.reduce((s, p) => s + (Number(p.quantity) || 1), 0)),
    primeiro_produto: products[0]?.title || "",
    link_checkout: o.cart_link || `${CHECKOUT_BASE}/checkout/order/${o.id}`,
  };
}

/** Prévia: troca tokens {{var:x}} pelo valor de um pedido de exemplo. */
const previewText = (text: string, vars: Record<string, string>) =>
  text.replace(/\{\{\s*var:([a-z_0-9]+)\s*\}\}/gi, (_m, k: string) =>
    k.toLowerCase() === "link_area_membros" ? `${CHECKOUT_BASE}/minha-area?ml=…` : vars[k.toLowerCase()] ?? `{{${k}}}`);

const humanizeTokens = (v: string) =>
  v.replace(/\{\{\s*var:([a-z_0-9]+)\s*\}\}/gi, (_m, k: string) => `[${VAR_OPTIONS.find((o) => o.key === k)?.label || k}]`);

function VarPicker({ onPick, sampleVars }: { onPick: (token: string) => void; sampleVars: Record<string, string> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
          <Variable className="h-3.5 w-3.5" /> Variável
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Preenchida por cliente</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {VAR_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.key} onClick={() => onPick(`{{var:${o.key}}}`)}>
            <div className="flex flex-col">
              <span className="text-xs">{o.label}</span>
              <span className="text-[10px] text-muted-foreground truncate">
                ex.: {o.key === "link_area_membros" ? "link único por cliente" : sampleVars[o.key] || "—"}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VarInput({ value, onChange, placeholder, sampleVars }: { value: string; onChange: (v: string) => void; placeholder: string; sampleVars: Record<string, string> }) {
  return (
    <div className="flex gap-1">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-xs" />
      <VarPicker sampleVars={sampleVars} onPick={(t) => onChange(value ? `${value} ${t}` : t)} />
    </div>
  );
}

export function EventBulkSendDialog({ open, onOpenChange, eventId, orders, stages, initialStage, onQueued }: Props) {
  const { numbers, fetchNumbers } = useWhatsAppNumberStore();
  const { senderName } = useTeamIdentity();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [kind, setKind] = useState<"template" | "crossell">("template");
  const [instanceId, setInstanceId] = useState<string>("");
  const [allowResend, setAllowResend] = useState(false);

  // Template API
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [templateName, setTemplateName] = useState<string>("");
  const [bodyVars, setBodyVars] = useState<string[]>([]);
  const [headerVars, setHeaderVars] = useState<string[]>([]);
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");

  // Cross-sell
  const [carousels, setCarousels] = useState<DbCarousel[]>([]);
  const [carouselId, setCarouselId] = useState<string>("");
  const [carouselDef, setCarouselDef] = useState<MetaTemplate | null>(null);
  const [cards, setCards] = useState<{ imageUrl: string; bodyVars: string[]; uploading: boolean }[]>([]);
  const [shopifyPickerIdx, setShopifyPickerIdx] = useState<number | null>(null);

  // Revisão
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<{ summary: { total: number; ready: number; skipped: number; reasons: Record<string, number> }; items: Array<{ phone: string; customer_name: string | null; status: string; reason: string | null }> } | null>(null);
  const [sending, setSending] = useState(false);

  const metaNumbers = useMemo(
    () => numbers.filter((n) => n.is_active && (!n.provider || n.provider === "meta")),
    [numbers],
  );

  useEffect(() => { if (numbers.length === 0) fetchNumbers(); }, [numbers.length, fetchNumbers]);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelectedStages(initialStage ? [initialStage] : []);
    setSelectedIds(new Set());
    setPlan(null);
    setTemplateName(""); setBodyVars([]); setHeaderVars([]); setHeaderMediaUrl("");
    setCarouselId(""); setCarouselDef(null); setCards([]);
    setAllowResend(false);
    if (!instanceId) {
      const def = metaNumbers.find((n) => n.is_default) || metaNumbers[0];
      if (def) setInstanceId(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Passo 1: público ──
  const candidates = useMemo(
    () => orders.filter((o) => selectedStages.includes(o.stage)),
    [orders, selectedStages],
  );
  const stageCount = (id: string) => orders.filter((o) => o.stage === id).length;

  // Ao mudar etapas, seleciona todos com telefone
  useEffect(() => {
    setSelectedIds(new Set(candidates.filter((o) => !!o.customer?.whatsapp).map((o) => o.id)));
  }, [candidates]);

  const toggleStage = (id: string) =>
    setSelectedStages((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  const toggleOrder = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedOrders = useMemo(() => candidates.filter((o) => selectedIds.has(o.id)), [candidates, selectedIds]);
  const sampleOrder = selectedOrders[0];
  const sampleVars = useMemo(() => (sampleOrder ? buildOrderVars(sampleOrder) : {}), [sampleOrder]);

  // ── Passo 2: templates ──
  useEffect(() => {
    if (!open || step !== 2 || !instanceId) return;
    let cancelled = false;
    (async () => {
      setLoadingMeta(true);
      const [metaRes, carRes] = await Promise.all([
        supabase.functions.invoke("meta-whatsapp-get-templates", { body: { whatsappNumberId: instanceId } }),
        supabase.from("templates_carrossel")
          .select("id,nome,template_id,template_language,qtd_cards,whatsapp_number_id")
          .in("scope", ["event", "pos"]).eq("meta_status", "APPROVED").eq("whatsapp_number_id", instanceId)
          .order("qtd_cards", { ascending: true }),
      ]);
      if (cancelled) return;
      setLoadingMeta(false);
      if (metaRes.error) toast.error("Erro ao buscar templates", { description: metaRes.error.message });
      const list: MetaTemplate[] = ((metaRes.data as { templates?: MetaTemplate[] })?.templates || []).filter((t) => t.status === "APPROVED");
      setMetaTemplates(list);
      setCarousels((carRes.data || []) as DbCarousel[]);
    })();
    return () => { cancelled = true; };
  }, [open, step, instanceId]);

  const selectedMeta = useMemo(() => metaTemplates.find((t) => t.name === templateName) || null, [metaTemplates, templateName]);
  const metaBody = findComp(selectedMeta?.components, "BODY");
  const metaHeader = findComp(selectedMeta?.components, "HEADER");
  const metaHeaderFormat = String(metaHeader?.format || "TEXT").toUpperCase();

  useEffect(() => {
    if (!selectedMeta) { setBodyVars([]); setHeaderVars([]); return; }
    setBodyVars(Array.from({ length: countVarSlots(metaBody?.text) }, () => ""));
    setHeaderVars(metaHeaderFormat === "TEXT" ? Array.from({ length: countVarSlots(metaHeader?.text) }, () => "") : []);
    setHeaderMediaUrl(metaHeader?.example?.header_handle?.[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeta]);

  // Cross-sell: definição Meta do carrossel
  useEffect(() => {
    if (!carouselId) { setCarouselDef(null); setCards([]); return; }
    const c = carousels.find((x) => x.id === carouselId);
    if (!c) return;
    const found = metaTemplates.find((m) => m.name === c.template_id && m.language === c.template_language)
      || metaTemplates.find((m) => m.name === c.template_id) || null;
    if (!found) { toast.error("Template do carrossel não encontrado na Meta"); setCarouselDef(null); return; }
    setCarouselDef(found);
    setBodyVars(Array.from({ length: countVarSlots(findComp(found.components, "BODY")?.text) }, () => ""));
    const metaCards = findComp(found.components, "CAROUSEL")?.cards || [];
    setCards(metaCards.map((mc) => ({
      imageUrl: "", uploading: false,
      bodyVars: Array.from({ length: countVarSlots(findComp(mc.components, "BODY")?.text) }, () => ""),
    })));
  }, [carouselId, carousels, metaTemplates]);

  const handleCardUpload = async (idx: number, file: File) => {
    setCards((p) => p.map((c, i) => (i === idx ? { ...c, uploading: true } : c)));
    const url = await uploadMediaToStorage(file);
    setCards((p) => p.map((c, i) => (i === idx ? { ...c, uploading: false, imageUrl: url || c.imageUrl } : c)));
    if (!url) toast.error(`Falha no upload do card ${idx + 1}`);
  };

  // ── Componentes base (com tokens) ──
  const activeTemplateName = kind === "template" ? templateName : (carousels.find((c) => c.id === carouselId)?.template_id || "");
  const activeLanguage = kind === "template" ? (selectedMeta?.language || "pt_BR") : (carousels.find((c) => c.id === carouselId)?.template_language || "pt_BR");
  const activeLabel = kind === "template" ? templateName : (carousels.find((c) => c.id === carouselId)?.nome || "");

  const buildBaseComponents = (): unknown[] => {
    const comps: unknown[] = [];
    if (kind === "template") {
      if (metaHeaderFormat === "TEXT" && headerVars.length > 0) {
        comps.push({ type: "header", parameters: headerVars.map((t) => ({ type: "text", text: t })) });
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(metaHeaderFormat) && headerMediaUrl) {
        const k = metaHeaderFormat.toLowerCase();
        comps.push({ type: "header", parameters: [{ type: k, [k]: { link: headerMediaUrl } }] });
      }
      if (bodyVars.length > 0) comps.push({ type: "body", parameters: bodyVars.map((t) => ({ type: "text", text: t })) });
    } else {
      if (bodyVars.length > 0) comps.push({ type: "body", parameters: bodyVars.map((t) => ({ type: "text", text: t })) });
      comps.push({
        type: "carousel",
        cards: cards.map((c, i) => {
          const cc: unknown[] = [{ type: "header", parameters: [{ type: "image", image: { link: c.imageUrl } }] }];
          if (c.bodyVars.length > 0) cc.push({ type: "body", parameters: c.bodyVars.map((t) => ({ type: "text", text: t })) });
          return { card_index: i, components: cc };
        }),
      });
    }
    return comps;
  };

  const messageReady =
    !!instanceId && !!activeTemplateName &&
    bodyVars.every((v) => v.trim()) && headerVars.every((v) => v.trim()) &&
    (kind === "template" || (cards.length > 0 && cards.every((c) => c.imageUrl && c.bodyVars.every((v) => v.trim()))));

  const recipientsPayload = () =>
    selectedOrders.filter((o) => o.customer?.whatsapp).map((o) => ({
      order_id: o.id,
      phone: o.customer!.whatsapp!,
      customer_name: o.customer?.full_name || o.customer?.instagram_handle || null,
      vars: buildOrderVars(o),
    }));

  const basePayload = () => ({
    event_id: eventId,
    kind,
    template_name: activeTemplateName,
    template_language: activeLanguage,
    template_label: activeLabel,
    whatsapp_number_id: instanceId,
    stages: selectedStages,
    allow_resend: allowResend,
    variable_map: { bodyVars, headerVars, cards: cards.map((c) => c.bodyVars) },
    base_components: buildBaseComponents(),
    recipients: recipientsPayload(),
    created_by_name: senderName || null,
  });

  const runPlan = async () => {
    setPlanning(true);
    setPlan(null);
    try {
      const { data, error } = await supabase.functions.invoke("event-bulk-send-enqueue", { body: { ...basePayload(), dry_run: true } });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setPlan(data as typeof plan);
      setStep(3);
    } catch (e) {
      toast.error("Erro ao preparar envio", { description: (e as Error).message });
    } finally {
      setPlanning(false);
    }
  };

  const runSend = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("event-bulk-send-enqueue", { body: basePayload() });
      if (error) throw new Error(error.message);
      const d = data as { error?: string; send_id?: string; summary?: { ready: number } };
      if (d?.error) throw new Error(d.error);
      toast.success(`Envio em massa iniciado para ${d.summary?.ready ?? 0} clientes`, { description: "Acompanhe o progresso em Envios em massa." });
      onQueued?.(d.send_id!);
      onOpenChange(false);
    } catch (e) {
      toast.error("Erro ao iniciar envio", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const previewBody = kind === "template"
    ? previewText((metaBody?.text || "").replace(/\{\{(\d+)\}\}/g, (_m, n) => bodyVars[+n - 1] || `{{${n}}}`), sampleVars)
    : previewText((findComp(carouselDef?.components, "BODY")?.text || "").replace(/\{\{(\d+)\}\}/g, (_m, n) => bodyVars[+n - 1] || `{{${n}}}`), sampleVars);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Envio em massa
            <span className="text-xs font-normal text-muted-foreground ml-2">
              Passo {step} de 3 — {step === 1 ? "Público" : step === 2 ? "Mensagem" : "Revisão"}
            </span>
          </DialogTitle>
          <DialogDescription>
            Template API ou Cross-sell para todos os clientes de uma etapa do Kanban.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden px-5 py-4">
          {/* ───── Passo 1 ───── */}
          {step === 1 && (
            <div className="flex flex-col h-full gap-3">
              <div>
                <Label className="text-xs">Etapas do Kanban</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {stages.map((s) => {
                    const n = stageCount(s.id);
                    const active = selectedStages.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={n === 0}
                        onClick={() => toggleStage(s.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
                          active ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-foreground border-border hover:bg-accent",
                        )}
                      >
                        {s.title} <span className="opacity-70">({n})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {selectedIds.size} de {candidates.length} selecionados
                </p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set(candidates.filter((o) => o.customer?.whatsapp).map((o) => o.id)))}>Marcar todos</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>Desmarcar</Button>
                </div>
              </div>

              <ScrollArea className="flex-1 rounded-md border border-border">
                {candidates.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Selecione uma ou mais etapas acima.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {candidates.map((o) => {
                      const phone = o.customer?.whatsapp;
                      const name = o.customer?.full_name || o.customer?.instagram_handle || "—";
                      const st = stages.find((s) => s.id === o.stage);
                      return (
                        <li key={o.id} className="flex items-center gap-3 px-3 py-2">
                          <Checkbox checked={selectedIds.has(o.id)} disabled={!phone} onCheckedChange={() => toggleOrder(o.id)} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {phone || "sem telefone"} · {formatBRL(getOrderFinalValue(o))}
                            </p>
                          </div>
                          {st && <Badge variant="outline" className="text-[10px]">{st.title}</Badge>}
                          {!phone && <Badge variant="destructive" className="text-[10px]">sem telefone</Badge>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ScrollArea>
            </div>
          )}

          {/* ───── Passo 2 ───── */}
          {step === 2 && (
            <ScrollArea className="h-full pr-2">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
                      {(["template", "crossell"] as const).map((k) => (
                        <button key={k} type="button" onClick={() => { setKind(k); setTemplateName(""); setCarouselId(""); setBodyVars([]); }}
                          className={cn("rounded px-2 py-1.5 text-xs font-semibold", kind === k ? "bg-background shadow" : "text-muted-foreground")}>
                          {k === "template" ? "Template API" : "Cross-sell (carrossel)"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Instância (fallback / do template)</Label>
                    <Select value={instanceId} onValueChange={(v) => { setInstanceId(v); setTemplateName(""); setCarouselId(""); }}>
                      <SelectTrigger className="mt-1.5 h-9 text-xs"><SelectValue placeholder="Selecione a instância" /></SelectTrigger>
                      <SelectContent>
                        {metaNumbers.map((n) => (
                          <SelectItem key={n.id} value={n.id} className="text-xs">{n.label} · {n.phone_display}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Quem já tem conversa recebe pela instância vinculada; quem estiver em outra instância é ignorado.
                    </p>
                  </div>
                </div>

                {loadingMeta ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Carregando templates…</div>
                ) : kind === "template" ? (
                  <div>
                    <Label className="text-xs">Template Meta aprovado</Label>
                    <Select value={templateName} onValueChange={setTemplateName}>
                      <SelectTrigger className="mt-1.5 h-9 text-xs"><SelectValue placeholder={metaTemplates.length ? "Escolha o template" : "Nenhum template aprovado"} /></SelectTrigger>
                      <SelectContent>
                        {metaTemplates.filter((t) => !findComp(t.components, "CAROUSEL")).map((t) => (
                          <SelectItem key={`${t.name}-${t.language}`} value={t.name} className="text-xs">{t.name} <span className="text-muted-foreground">· {t.language}</span></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs">Carrossel de cross-sell aprovado</Label>
                    <Select value={carouselId} onValueChange={setCarouselId}>
                      <SelectTrigger className="mt-1.5 h-9 text-xs"><SelectValue placeholder={carousels.length ? "Escolha o carrossel" : "Nenhum carrossel aprovado nesta instância"} /></SelectTrigger>
                      <SelectContent>
                        {carousels.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome} · {c.qtd_cards} cards</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {(selectedMeta || carouselDef) && (
                  <div className="space-y-3 rounded-md border border-border p-3">
                    {kind === "template" && metaHeaderFormat === "TEXT" && headerVars.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Header</Label>
                        {headerVars.map((v, i) => (
                          <VarInput sampleVars={sampleVars} key={i} value={v} placeholder={`Header {{${i + 1}}}`} onChange={(val) => setHeaderVars((p) => p.map((x, j) => (j === i ? val : x)))} />
                        ))}
                      </div>
                    )}
                    {kind === "template" && ["IMAGE", "VIDEO", "DOCUMENT"].includes(metaHeaderFormat) && (
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Mídia do header ({metaHeaderFormat.toLowerCase()})</Label>
                        <Input value={headerMediaUrl} onChange={(e) => setHeaderMediaUrl(e.target.value)} placeholder="URL da mídia (vazio = exemplo aprovado)" className="h-8 text-xs" />
                      </div>
                    )}
                    {bodyVars.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Corpo</Label>
                        <p className="text-[11px] whitespace-pre-wrap rounded bg-secondary p-2">{kind === "template" ? metaBody?.text : findComp(carouselDef?.components, "BODY")?.text}</p>
                        {bodyVars.map((v, i) => (
                          <VarInput sampleVars={sampleVars} key={i} value={v} placeholder={`{{${i + 1}}}`} onChange={(val) => setBodyVars((p) => p.map((x, j) => (j === i ? val : x)))} />
                        ))}
                      </div>
                    )}
                    {kind === "crossell" && cards.map((c, idx) => {
                      const mc = findComp(carouselDef?.components, "CAROUSEL")?.cards?.[idx];
                      const cardBody = findComp(mc?.components, "BODY")?.text;
                      return (
                        <div key={idx} className="rounded-md border border-border p-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px]">Card {idx + 1}</Label>
                            <div className="flex gap-1">
                              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => setShopifyPickerIdx(idx)}>
                                <Images className="h-3 w-3" /> Shopify
                              </Button>
                              <label className="inline-flex h-7 cursor-pointer items-center rounded-md border border-input bg-background px-2 text-[11px] hover:bg-accent">
                                {c.uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Upload"}
                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleCardUpload(idx, e.target.files[0])} />
                              </label>
                            </div>
                          </div>
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt={`Card ${idx + 1}`} className="h-20 w-20 rounded object-cover" />
                          ) : (
                            <p className="text-[10px] text-destructive">Imagem obrigatória</p>
                          )}
                          {cardBody && <p className="text-[10px] text-muted-foreground whitespace-pre-wrap">{cardBody}</p>}
                          {c.bodyVars.map((v, i) => (
                            <VarInput sampleVars={sampleVars} key={i} value={v} placeholder={`Card ${idx + 1} · {{${i + 1}}}`} onChange={(val) => setCards((p) => p.map((cc, j) => (j === idx ? { ...cc, bodyVars: cc.bodyVars.map((x, k) => (k === i ? val : x)) } : cc)))} />
                          ))}
                        </div>
                      );
                    })}

                    {sampleOrder && previewBody && (
                      <div>
                        <Label className="text-[11px]">Prévia ({sampleVars.nome || sampleOrder.customer?.instagram_handle})</Label>
                        <p className="mt-1 whitespace-pre-wrap rounded-md bg-accent/40 p-2 text-xs">{previewBody}</p>
                      </div>
                    )}
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={allowResend} onCheckedChange={(v) => setAllowResend(!!v)} />
                  Reenviar mesmo para quem já recebeu este template neste evento
                </label>
              </div>
            </ScrollArea>
          )}

          {/* ───── Passo 3 ───── */}
          {step === 3 && plan && (
            <div className="flex h-full flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-2xl font-bold">{plan.summary.ready}</p>
                  <p className="text-[11px] text-muted-foreground">aptos</p>
                </div>
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-2xl font-bold">{plan.summary.skipped}</p>
                  <p className="text-[11px] text-muted-foreground">ignorados</p>
                </div>
                <div className="rounded-md border border-border p-3 text-center">
                  <p className="text-sm font-semibold truncate">{activeLabel}</p>
                  <p className="text-[11px] text-muted-foreground">{kind === "template" ? "Template API" : "Cross-sell"}</p>
                </div>
              </div>
              {Object.keys(plan.summary.reasons).length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {Object.entries(plan.summary.reasons).map(([r, n]) => <div key={r}>{n} × {r}</div>)}
                  </AlertDescription>
                </Alert>
              )}
              <div className="text-[11px] text-muted-foreground">
                Variáveis: {[...bodyVars, ...headerVars, ...cards.flatMap((c) => c.bodyVars)].map(humanizeTokens).join(" · ") || "nenhuma"}
              </div>
              <ScrollArea className="flex-1 rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {plan.items.map((it) => (
                    <li key={it.phone} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className={cn("h-2 w-2 rounded-full", it.status === "pending" ? "bg-primary" : "bg-muted-foreground/40")} />
                      <span className="min-w-0 flex-1 truncate">{it.customer_name || it.phone}</span>
                      <span className="text-muted-foreground">{it.phone}</span>
                      {it.reason && <Badge variant="outline" className="text-[10px]">{it.reason}</Badge>}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={step === 1} onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>
            <ChevronLeft className="h-4 w-4" /> Voltar
          </Button>
          {step === 1 && (
            <Button size="sm" disabled={selectedOrders.length === 0} onClick={() => setStep(2)}>
              Mensagem ({selectedOrders.length}) <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          {step === 2 && (
            <Button size="sm" disabled={!messageReady || planning} onClick={runPlan}>
              {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />} Revisar
            </Button>
          )}
          {step === 3 && plan && (
            <Button size="sm" className="gap-1 font-bold" disabled={sending || plan.summary.ready === 0} onClick={runSend}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar para {plan.summary.ready} clientes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <Dialog open={shopifyPickerIdx !== null} onOpenChange={(o) => !o && setShopifyPickerIdx(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Imagem do card {shopifyPickerIdx !== null ? shopifyPickerIdx + 1 : ""}</DialogTitle></DialogHeader>
          <ShopifyImagePicker onPick={(url) => { if (shopifyPickerIdx !== null) setCards((p) => p.map((c, i) => (i === shopifyPickerIdx ? { ...c, imageUrl: url } : c))); setShopifyPickerIdx(null); }} />
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
