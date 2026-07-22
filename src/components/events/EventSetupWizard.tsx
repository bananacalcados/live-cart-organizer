import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { DbEvent } from "@/types/database";
import { MetaTemplateConfigurator } from "./MetaTemplateConfigurator";
import { EventFollowupsManager } from "./EventFollowupsManager";
import { InitialMessageEditor, type IgBlockButtonsEntry } from "./InitialMessageEditor";
import { IgAutomationsManager, type IgAutomation } from "./IgAutomationsManager";
import { LiveActiveToggleButton } from "./LiveActiveToggleButton";
import { useWhatsAppNumberStore } from "@/stores/whatsappNumberStore";
import { CrossellConfigStep, CrossellOfferDraft } from "./CrossellConfigStep";
import {
  Truck,
  FileText,
  CreditCard,
  Radio,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Gift,
  Smartphone,
  ShoppingBag,
  Tag,
  Store,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  event: DbEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}

type StepKey = "general" | "shipping" | "template" | "installments" | "crossell" | "followups" | "live";

const STEPS: { key: StepKey; title: string; icon: typeof Truck }[] = [
  { key: "general", title: "Identificação", icon: Tag },
  { key: "shipping", title: "Frete", icon: Truck },
  { key: "template", title: "Mensagem", icon: FileText },
  { key: "installments", title: "Parcelamento", icon: CreditCard },
  { key: "crossell", title: "Crossell", icon: ShoppingBag },
  { key: "followups", title: "Follow-ups", icon: Calendar },
  { key: "live", title: "Ativar Live", icon: Radio },
];

// Nome temporário aplicado a um evento recém-criado pelo botão "Nova Live".
export const EVENT_DRAFT_NAME = "Nova Live (rascunho)";

// Canal de venda -> loja física padrão (mesma regra usada em Events.tsx).
const STORE_BY_CHANNEL: Record<string, string | null> = {
  site: null,
  pos_perola: "1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2",
  pos_centro: "4ade7b44-5043-4ab1-a124-7a6ab5468e29",
};

const toNum = (v: string): number | null => {
  const t = (v ?? "").toString().replace(",", ".").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function EventSetupWizard({ event, open, onOpenChange, onCompleted }: Props) {
  // Step state
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  // Identificação (etapa 1)
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [channel, setChannel] = useState<string>("site");

  // Frete
  const [shippingCost, setShippingCost] = useState("");
  const [freeThreshold, setFreeThreshold] = useState("");

  // Template + mensagem
  const [selectedWaId, setSelectedWaId] = useState<string>("none");
  const [metaTemplateName, setMetaTemplateName] = useState<string | null>(null);
  const [metaTemplateLanguage, setMetaTemplateLanguage] = useState("pt_BR");
  const [metaTemplateBodyVars, setMetaTemplateBodyVars] = useState<string[]>([]);
  const [metaTemplateHeaderVar, setMetaTemplateHeaderVar] = useState<string | null>(null);
  const [initialMessageEnabled, setInitialMessageEnabled] = useState(false);
  const [initialMessageBlocks, setInitialMessageBlocks] = useState<string[]>([]);
  const [igButtons, setIgButtons] = useState<IgBlockButtonsEntry[]>([]);
  const [igAutomations, setIgAutomations] = useState<IgAutomation[]>([]);

  // Parcelamento
  const [installMin, setInstallMin] = useState("");
  const [installMax, setInstallMax] = useState("");

  // Crossell
  const [crossellNone, setCrossellNone] = useState(false);
  const [crossellOffers, setCrossellOffers] = useState<CrossellOfferDraft[]>([]);


  const { numbers, fetchNumbers } = useWhatsAppNumberStore();
  const whatsappNumberId = selectedWaId === "none" ? null : selectedWaId;

  useEffect(() => {
    if (open && numbers.length === 0) fetchNumbers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Per-step completeness based on the persisted event (used to skip configured steps).
  const completeFromEvent = useMemo(() => {
    if (!event)
      return { general: false, shipping: false, template: false, installments: false, crossell: false, live: false };
    const e = event as any;
    return {
      general: Boolean(e.name) && e.name !== EVENT_DRAFT_NAME && Boolean(e.channel),
      shipping: e.default_shipping_cost != null || e.free_shipping_threshold != null,
      template: Boolean(e.meta_template_name) || Boolean(e.initial_message_enabled),
      installments: e.installment_max != null,
      crossell: Boolean(e.crossell_configured),
      live: Boolean(e.live_active_until) && new Date(e.live_active_until).getTime() > Date.now(),
    };
  }, [event]);

  // Initialize fields + jump to first unconfigured step when the wizard opens.
  useEffect(() => {
    if (!open || !event) return;
    const e = event as any;
    setName(e.name && e.name !== EVENT_DRAFT_NAME ? e.name : "");
    setDescription(e.description || "");
    setStartDate(e.start_date || "");
    setEndDate(e.end_date || "");
    setChannel(e.channel || "site");
    setShippingCost(e.default_shipping_cost != null ? String(e.default_shipping_cost) : "");
    setFreeThreshold(e.free_shipping_threshold != null ? String(e.free_shipping_threshold) : "");
    setSelectedWaId(e.whatsapp_number_id || "none");
    setMetaTemplateName(e.meta_template_name || null);
    setMetaTemplateLanguage(e.meta_template_language || "pt_BR");
    setMetaTemplateBodyVars((e.meta_template_body_variables as string[]) || []);
    setMetaTemplateHeaderVar(e.meta_template_header_variable || null);
    setInitialMessageEnabled(Boolean(e.initial_message_enabled));
    setInitialMessageBlocks((e.initial_message_blocks as string[]) || []);
    setIgButtons((e.ig_initial_message_buttons as IgBlockButtonsEntry[]) || []);
    setIgAutomations((e.ig_automations as IgAutomation[]) || []);
    setInstallMin(e.installment_min_value != null ? String(e.installment_min_value) : "");
    setInstallMax(e.installment_max != null ? String(e.installment_max) : "");

    // Crossell: load existing offers + "no crossell" preference
    setCrossellNone(Boolean(e.crossell_configured) && !e.crossell_enabled);
    supabase
      .from("event_crossell_offers")
      .select("*")
      .eq("event_id", event.id)
      .order("position", { ascending: true })
      .then(({ data }) => {
        setCrossellOffers(
          (data || []).map((o: any) => ({
            id: o.id,
            shopify_product_id: o.shopify_product_id,
            product_title: o.product_title || "",
            image: o.image,
            has_sizes: o.has_sizes,
            original_price: o.original_price != null ? String(o.original_price) : "",
            discount_price: o.discount_price != null ? String(o.discount_price) : "",
          })),
        );
      });

    const firstIncomplete = STEPS.findIndex((s) => !completeFromEvent[s.key]);
    setStepIndex(firstIncomplete === -1 ? 0 : firstIncomplete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  if (!event) return null;

  const currentStep = STEPS[stepIndex];

  // Persist crossell offers: sync events flags + replace offer rows for this event.
  const persistCrossell = async (): Promise<boolean> => {
    const validOffers = crossellNone
      ? []
      : crossellOffers.filter(
          (o) =>
            o.shopify_product_id &&
            toNum(o.original_price) != null &&
            toNum(o.discount_price) != null,
        );

    const { error: evErr } = await supabase
      .from("events")
      .update({
        crossell_configured: true,
        crossell_enabled: !crossellNone && validOffers.length > 0,
      } as any)
      .eq("id", event.id);
    if (evErr) {
      toast.error("Erro ao salvar crossell: " + evErr.message);
      return false;
    }

    // Replace offers (delete + insert) to keep it simple and consistent.
    const { error: delErr } = await supabase
      .from("event_crossell_offers")
      .delete()
      .eq("event_id", event.id);
    if (delErr) {
      toast.error("Erro ao atualizar ofertas: " + delErr.message);
      return false;
    }

    if (validOffers.length > 0) {
      const rows = validOffers.map((o, i) => ({
        event_id: event.id,
        shopify_product_id: o.shopify_product_id,
        product_title: o.product_title,
        image: o.image,
        has_sizes: o.has_sizes,
        original_price: toNum(o.original_price),
        discount_price: toNum(o.discount_price),
        position: i,
        is_active: true,
      }));
      const { error: insErr } = await supabase.from("event_crossell_offers").insert(rows);
      if (insErr) {
        toast.error("Erro ao salvar ofertas: " + insErr.message);
        return false;
      }
    }
    return true;
  };

  // Build the `events` column updates for a given step from the current form state.
  // (crossell/live are persisted separately and are not column-only updates.)
  const stepUpdates = (key: StepKey): Record<string, any> => {
    const updates: Record<string, any> = {};
    if (key === "general") {
      updates.name = name.trim();
      updates.description = description || null;
      updates.start_date = startDate || null;
      updates.end_date = endDate || null;
      updates.channel = channel;
      const isMulti = channel === "pos_multi";
      updates.default_store_id = STORE_BY_CHANNEL[channel] ?? null;
      updates.store_ids = isMulti
        ? ["1c08a9d8-fc12-4657-8ecf-d442f0c0e9f2", "4ade7b44-5043-4ab1-a124-7a6ab5468e29"]
        : null;
      updates.manual_pos_routing = isMulti;
    } else if (key === "shipping") {
      updates.default_shipping_cost = toNum(shippingCost);
      updates.free_shipping_threshold = toNum(freeThreshold);
    } else if (key === "template") {
      updates.whatsapp_number_id = whatsappNumberId;
      updates.meta_template_name = metaTemplateName;
      updates.meta_template_language = metaTemplateLanguage;
      updates.meta_template_body_variables = metaTemplateBodyVars;
      updates.meta_template_header_variable = metaTemplateHeaderVar;
      updates.initial_message_enabled = initialMessageEnabled;
      updates.initial_message_blocks = initialMessageBlocks;
      updates.ig_initial_message_buttons = igButtons;
      updates.ig_automations = igAutomations;
      // Keep channel preference consistent: a Meta instance + template means the
      // event dispatches via Meta WhatsApp template, not a plain session message.
      if (whatsappNumberId && metaTemplateName) {
        updates.channel_preference = "meta_whatsapp";
        updates.channel_preferences = ["meta_whatsapp"];
      }
    } else if (key === "installments") {
      updates.installment_min_value = toNum(installMin);
      updates.installment_max = installMax ? parseInt(installMax, 10) : null;
    }
    return updates;
  };

  const persistStep = async (key: StepKey): Promise<boolean> => {
    if (key === "general" && !name.trim()) {
      toast.error("Defina o nome do evento.");
      return false;
    }
    if (key === "crossell") return await persistCrossell();
    if (key === "live") return true; // persisted by the toggle itself
    const { error } = await supabase.from("events").update(stepUpdates(key)).eq("id", event.id);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return false;
    }
    return true;
  };

  // Persist EVERY step's fields at once. Used by "Concluir" / "Pular e abrir" so a
  // change made on any step is never lost just because the user wasn't standing on
  // that step when they saved (the original bug: only the current step was saved).
  const persistAll = async (): Promise<boolean> => {
    if (!name.trim()) {
      setStepIndex(0);
      toast.error("Defina o nome do evento.");
      return false;
    }
    const updates = {
      ...stepUpdates("general"),
      ...stepUpdates("shipping"),
      ...stepUpdates("template"),
      ...stepUpdates("installments"),
    };
    const { error } = await supabase.from("events").update(updates).eq("id", event.id);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return false;
    }
    return await persistCrossell();
  };

  // Save the current step's fields, then move to another step. Prevents losing edits
  // when jumping around via the stepper circles or "Voltar".
  const goToStep = async (i: number) => {
    if (i === stepIndex || saving) return;
    if (!(currentStep.key === "general" && !name.trim())) {
      setSaving(true);
      await persistStep(currentStep.key);
      setSaving(false);
    }
    setStepIndex(i);
  };

  const goNext = async () => {
    setSaving(true);
    const ok = await persistStep(currentStep.key);
    setSaving(false);
    if (!ok) return;
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
    }
  };

  const goBack = () => goToStep(Math.max(0, stepIndex - 1));



  // "Pular e abrir": fecha o modal e entra no evento, sem exigir as etapas seguintes.
  // Garante apenas que a identificação (nome + canal) esteja preenchida.
  const skipAndOpen = async () => {
    if (!name.trim()) {
      setStepIndex(0);
      toast.error("Defina o nome do evento antes de abrir.");
      return;
    }
    setSaving(true);
    const ok = await persistAll();
    setSaving(false);

    if (!ok) return;
    // NÃO chamar onOpenChange(false) aqui: isso dispararia o descarte do rascunho
    // (que lê o estado local desatualizado) e apagaria o evento recém-configurado.
    // O parent fecha o modal dentro de onCompleted().
    onCompleted();
  };

  const finish = async () => {
    if (!name.trim()) {
      setStepIndex(0);
      toast.error("Defina o nome do evento antes de concluir.");
      return;
    }
    setSaving(true);
    const ok = await persistAll();

    if (ok) {
      const { error } = await supabase
        .from("events")
        .update({ setup_completed: true } as any)
        .eq("id", event.id);
      if (error) {
        toast.error("Erro ao concluir: " + error.message);
        setSaving(false);
        return;
      }
      toast.success("Evento configurado!");
      // NÃO chamar onOpenChange(false): evita o descarte do rascunho que apagaria
      // o evento. O parent fecha o modal dentro de onCompleted().
      onCompleted();
    }
    setSaving(false);
  };


  const isLastStep = stepIndex === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <currentStep.icon className="h-5 w-5 text-accent" />
            Configurar Evento — {event.name}
          </DialogTitle>
          <DialogDescription>
            Etapa {stepIndex + 1} de {STEPS.length}: {currentStep.title}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between gap-1 py-2">
          {STEPS.map((s, i) => {
            const done = i < stepIndex || completeFromEvent[s.key];
            const active = i === stepIndex;
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => goToStep(i)}
                  className="flex flex-col items-center gap-1 flex-shrink-0"
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors",
                      active
                        ? "border-accent bg-accent text-accent-foreground"
                        : done
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-muted bg-muted text-muted-foreground"
                    )}
                  >
                    {done && !active ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                  </div>
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      active ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {s.title}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={cn("h-0.5 flex-1 mx-1", i < stepIndex ? "bg-accent" : "bg-muted")} />
                )}
              </div>
            );
          })}
        </div>

        <div className="py-3 min-h-[260px]">
          {currentStep.key === "general" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Comece pela identificação do evento: nome, quando vai acontecer e em qual canal a
                venda será roteada.
              </p>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Tag className="h-4 w-4" /> Nome do evento *
                </Label>
                <Input
                  placeholder="Ex: Live de Verão 2024"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  placeholder="Descrição opcional..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label className="flex items-center gap-2 m-0">
                  <Calendar className="h-4 w-4" /> Data do evento
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Início</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        if (endDate && e.target.value && endDate < e.target.value)
                          setEndDate(e.target.value);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Fim (opcional)</Label>
                    <Input
                      type="date"
                      min={startDate || undefined}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Pode ser uma data futura. Para lives de vários dias, preencha a data de fim.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Store className="h-4 w-4" /> Canal de venda *
                </Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="site">🌐 Site (Shopify) — venda online</SelectItem>
                    <SelectItem value="pos_perola">🏬 Loja Pérola — venda física</SelectItem>
                    <SelectItem value="pos_centro">🏬 Loja Centro — venda física</SelectItem>
                    <SelectItem value="pos_multi">🏬🏬 Duas lojas (Pérola + Centro) — envio manual</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {channel === "site"
                    ? "Pedidos vão para a Shopify (venda online)."
                    : channel === "pos_multi"
                    ? "Pedido pago NÃO é enviado automático. No card você escolhe a loja e a vendedora que fez a venda. Conta como Faturamento Live da loja."
                    : "Pedidos pagos são roteados para a aba Pedidos da loja escolhida e contam como venda dela."}
                </p>
              </div>
            </div>
          )}

          {currentStep.key === "shipping" && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Defina o frete deste evento. Os valores são aplicados automaticamente no link do
                checkout, sempre no <strong>meio de envio mais barato</strong> (ex.: só no PAC, nunca
                no SEDEX).
              </p>
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label className="flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Frete fixo (R$)
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ex: 19.90 (deixe vazio para cotação normal da Frenet)"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Substitui o valor do método mais barato pelo valor fixo informado.
                </p>
              </div>
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label className="flex items-center gap-2">
                  <Gift className="h-4 w-4" /> Frete grátis acima de (R$)
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ex: 199.90 (deixe vazio para desativar)"
                  value={freeThreshold}
                  onChange={(e) => setFreeThreshold(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Quando o pedido atingir esse valor, o método mais barato fica grátis. Pode ficar
                  ligado junto com o frete fixo — o grátis tem prioridade ao atingir o limite.
                </p>
              </div>
            </div>
          )}

          {currentStep.key === "template" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Selecione a instância de WhatsApp oficial (Meta), escolha o template aprovado e
                preencha as variáveis. A mensagem inicial abaixo é usada como saudação no chat.
              </p>

              {/* WhatsApp API instance selector */}
              <div className="space-y-2 rounded-md border p-3 bg-muted/30">
                <Label className="flex items-center gap-2 text-xs font-semibold">
                  <Smartphone className="h-4 w-4 text-accent" /> Instância de WhatsApp (Meta API)
                </Label>
                <Select value={selectedWaId} onValueChange={setSelectedWaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o número WhatsApp..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma (sem template Meta)</SelectItem>
                    {numbers
                      .filter((n) => (n.provider || "meta") === "meta")
                      .map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.label} <span className="text-muted-foreground ml-1">({n.phone_display})</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Apenas números oficiais da Meta carregam templates aprovados.
                </p>
              </div>

              <MetaTemplateConfigurator
                whatsappNumberId={whatsappNumberId}
                templateName={metaTemplateName}
                language={metaTemplateLanguage}
                bodyVariables={metaTemplateBodyVars}
                headerVariable={metaTemplateHeaderVar}
                onChange={(next) => {
                  setMetaTemplateName(next.templateName);
                  setMetaTemplateLanguage(next.language);
                  setMetaTemplateBodyVars(next.bodyVariables);
                  setMetaTemplateHeaderVar(next.headerVariable);
                }}
              />

              <InitialMessageEditor
                enabled={initialMessageEnabled}
                blocks={initialMessageBlocks}
                onChange={(next) => {
                  setInitialMessageEnabled(next.enabled);
                  setInitialMessageBlocks(next.blocks);
                }}
                buttons={igButtons}
                onChangeButtons={setIgButtons}
                automations={igAutomations}
              />
              <IgAutomationsManager
                eventId={event?.id ?? null}
                automations={igAutomations}
                onChange={setIgAutomations}
              />
            </div>
          )}

          {currentStep.key === "installments" && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Defina uma condição especial de parcelamento sem juros para este evento. Acima do
                valor informado, o cliente poderá parcelar em até o número de vezes escolhido — tudo
                sem juros no checkout.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <Label>Acima de (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Ex: 300.00"
                    value={installMin}
                    onChange={(e) => setInstallMin(e.target.value)}
                  />
                </div>
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <Label>Parcelar em até (vezes)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    max="12"
                    placeholder="Ex: 10"
                    value={installMax}
                    onChange={(e) => setInstallMax(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Deixe vazio para usar o parcelamento padrão da loja. Esta regra vale apenas para os
                pedidos deste evento.
              </p>
            </div>
          )}

          {currentStep.key === "crossell" && (
            <CrossellConfigStep
              noCrossell={crossellNone}
              offers={crossellOffers}
              onChange={({ noCrossell, offers }) => {
                setCrossellNone(noCrossell);
                setCrossellOffers(offers);
              }}
            />
          )}


          {currentStep.key === "followups" && (
            <div className="space-y-3">
              {event?.id ? (
                <EventFollowupsManager eventId={event.id} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Salve o evento (avançando pelos passos anteriores) para configurar follow-ups.
                </p>
              )}
            </div>
          )}

          {currentStep.key === "live" && (
            <LiveActivationStep event={event} />
          )}

        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" onClick={goBack} disabled={stepIndex === 0 || saving} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={skipAndOpen} disabled={saving}>
              Pular e abrir
            </Button>
            {isLastStep ? (
              <Button className="btn-accent gap-1" onClick={finish} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Concluir e abrir evento
              </Button>
            ) : (
              <Button className="btn-accent gap-1" onClick={goNext} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Avançar <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Live activation step ─────────── */

function LiveActivationStep({ event }: { event: any }) {
  const [igUrl, setIgUrl] = useState<string>(event?.instagram_live_url ?? "");
  const [broadcasting, setBroadcasting] = useState<boolean>(!!event?.is_live_broadcasting);
  const [savingUrl, setSavingUrl] = useState(false);
  const [togglingBroadcast, setTogglingBroadcast] = useState(false);

  useEffect(() => {
    setIgUrl(event?.instagram_live_url ?? "");
    setBroadcasting(!!event?.is_live_broadcasting);
  }, [event?.id, event?.instagram_live_url, event?.is_live_broadcasting]);

  const saveUrl = async () => {
    const trimmed = igUrl.trim();
    if (trimmed && !/^https?:\/\/(www\.)?instagram\.com\//i.test(trimmed)) {
      toast.error("Cole o link completo da live do Instagram (https://www.instagram.com/...).");
      return;
    }
    setSavingUrl(true);
    const { error } = await supabase
      .from("events")
      .update({
        instagram_live_url: trimmed || null,
        live_url_updated_at: trimmed ? new Date().toISOString() : null,
      })
      .eq("id", event.id);
    setSavingUrl(false);
    if (error) toast.error(error.message);
    else toast.success("Link da live salvo. TTL de 3h reiniciado.");
  };

  const toggleBroadcasting = async (next: boolean) => {
    if (next) {
      const trimmed = igUrl.trim();
      if (!trimmed) {
        toast.error("Cole o link da live antes de ativar.");
        return;
      }
      const ok = window.confirm(
        "Confirmar link da live?\n\n" + trimmed + "\n\nEle expira automaticamente em 3h.",
      );
      if (!ok) return;
    }
    setTogglingBroadcast(true);
    const patch: Record<string, unknown> = { is_live_broadcasting: next };
    if (next) {
      patch.live_broadcast_started_at = new Date().toISOString();
      patch.live_url_updated_at = new Date().toISOString();
    }
    const { error } = await supabase.from("events").update(patch).eq("id", event.id);
    setTogglingBroadcast(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBroadcasting(next);
    toast.success(next ? "AO VIVO ativado — expira em 3h." : "Broadcasting desativado.");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ative a Live para que os comentários ao vivo do Instagram cheguem neste evento em
        tempo real. (Expira automaticamente em 8h e pode ser religada.)
      </p>

      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-accent" />
          <div>
            <div className="text-sm font-medium">Comentários da Live</div>
            <div className="text-xs text-muted-foreground">
              Liga o recebimento ao vivo dos comentários do Instagram.
            </div>
          </div>
        </div>
        <LiveActiveToggleButton eventId={event.id} size="default" />
      </div>

      {/* IG live link + broadcasting */}
      <div className="rounded-lg border p-4 space-y-3">
        <div>
          <Label className="text-sm font-medium">Link da Live do Instagram</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Cole o link da transmissão (aba "Compartilhar" no IG). É pra onde os
            redirecionadores vão mandar quem clicar.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="https://www.instagram.com/usuario/live/..."
              value={igUrl}
              onChange={(e) => setIgUrl(e.target.value)}
            />
            <Button onClick={saveUrl} disabled={savingUrl}>
              {savingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 border-t pt-3">
          <div>
            <div className="text-sm font-medium">Marcar como "AO VIVO agora"</div>
            <div className="text-xs text-muted-foreground">
              Só um evento pode estar ao vivo por vez. Os redirecionadores públicos
              vão abrir o link deste evento enquanto isso estiver ligado.
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleBroadcasting(!broadcasting)}
            disabled={togglingBroadcast || (!igUrl.trim() && !broadcasting)}
            className={`shrink-0 h-9 px-4 rounded-md text-sm font-semibold transition-colors ${
              broadcasting
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-muted hover:bg-muted/70"
            } disabled:opacity-50`}
          >
            {togglingBroadcast ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : broadcasting ? "⏹ Encerrar" : "🔴 Ativar AO VIVO"}
          </button>
        </div>
      </div>
    </div>
  );
}

