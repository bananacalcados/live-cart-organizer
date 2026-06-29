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
import { InitialMessageEditor } from "./InitialMessageEditor";
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

type StepKey = "shipping" | "template" | "installments" | "crossell" | "live";

const STEPS: { key: StepKey; title: string; icon: typeof Truck }[] = [
  { key: "shipping", title: "Frete", icon: Truck },
  { key: "template", title: "Mensagem", icon: FileText },
  { key: "installments", title: "Parcelamento", icon: CreditCard },
  { key: "crossell", title: "Crossell", icon: ShoppingBag },
  { key: "live", title: "Ativar Live", icon: Radio },
];

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
      return { shipping: false, template: false, installments: false, crossell: false, live: false };
    const e = event as any;
    return {
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
    setShippingCost(e.default_shipping_cost != null ? String(e.default_shipping_cost) : "");
    setFreeThreshold(e.free_shipping_threshold != null ? String(e.free_shipping_threshold) : "");
    setSelectedWaId(e.whatsapp_number_id || "none");
    setMetaTemplateName(e.meta_template_name || null);
    setMetaTemplateLanguage(e.meta_template_language || "pt_BR");
    setMetaTemplateBodyVars((e.meta_template_body_variables as string[]) || []);
    setMetaTemplateHeaderVar(e.meta_template_header_variable || null);
    setInitialMessageEnabled(Boolean(e.initial_message_enabled));
    setInitialMessageBlocks((e.initial_message_blocks as string[]) || []);
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

  const persistStep = async (key: StepKey): Promise<boolean> => {
    const updates: Record<string, any> = {};
    if (key === "shipping") {
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
    } else if (key === "installments") {
      updates.installment_min_value = toNum(installMin);
      updates.installment_max = installMax ? parseInt(installMax, 10) : null;
    } else if (key === "crossell") {
      return await persistCrossell();
    } else {
      return true; // live step is persisted by the toggle itself
    }
    const { error } = await supabase.from("events").update(updates).eq("id", event.id);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return false;
    }
    return true;
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

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const finish = async () => {
    setSaving(true);
    const ok = await persistStep(currentStep.key);
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
                  onClick={() => setStepIndex(i)}
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



          {currentStep.key === "live" && (
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
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" onClick={goBack} disabled={stepIndex === 0 || saving} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onCompleted} disabled={saving}>
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
