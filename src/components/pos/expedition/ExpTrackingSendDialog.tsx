import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Pencil, MessageSquareText } from "lucide-react";

import { ExpOrder, brl, trackingLink } from "./expeditionTypes";
import { ExpTrackingTemplateEditor, TrackingTemplate } from "./ExpTrackingTemplateEditor";
import { TrackingVarValues, formatShippingAddress, renderTrackingMessage } from "@/lib/pos/trackingMessage";
import { sendTrackingWhatsApp } from "@/lib/pos/trackingSend";

interface UazapiNumberOption {
  id: string;
  label: string | null;
  phone_display: string | null;
}

/** Monta os valores das variáveis a partir do pedido + campos informados. */
export function buildTrackingValues(
  order: ExpOrder,
  o: { carrier?: string; deliveryDays?: string; tracking?: string; trackingUrl?: string },
): TrackingVarValues {
  const full = String(order.customer_name || "").trim();
  const addr: any = order.shipping_address || {};
  const code = (o.tracking || "").trim();
  return {
    nome: full,
    primeiro_nome: full.split(" ")[0] || "",
    transportadora: o.carrier || "",
    prazo_entrega: o.deliveryDays || "",
    codigo_rastreio: code,
    link_rastreio: (o.trackingUrl || "").trim() || (code ? trackingLink(code) : ""),
    valor_pedido: brl(order.total || 0),
    endereco: formatShippingAddress(addr),
    cidade: addr?.city || addr?.cidade || "",
    estado: addr?.state || addr?.uf || "",
    cep: addr?.zip_code || addr?.cep || "",
    pedido_numero: String(order.id).slice(0, 8).toUpperCase(),
    itens: order.items
      .map((i) => `${i.quantity}x ${[i.product_name, i.variant_name, i.size && `Tam ${i.size}`].filter(Boolean).join(" ")}`)
      .join("\n"),
  };
}

interface Props {
  order: ExpOrder | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Reenvio da mensagem de rastreio (etapa CONCLUÍDOS) — mesma mensagem padrão
 * da Conferência, para os casos em que o envio anterior não chegou ao cliente.
 */
export function ExpTrackingSendDialog({ order, open, onOpenChange }: Props) {
  const [templates, setTemplates] = useState<TrackingTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [numbers, setNumbers] = useState<UazapiNumberOption[]>([]);
  const [numberId, setNumberId] = useState("");
  const [tracking, setTracking] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [carrier, setCarrier] = useState("");
  const [sending, setSending] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const loadTemplates = async (focusId?: string) => {
    const { data } = await supabase
      .from("pos_tracking_templates" as any)
      .select("id, name, body, is_default")
      .order("is_default", { ascending: false })
      .order("name");
    const list = ((data as any[]) || []) as TrackingTemplate[];
    setTemplates(list);
    setTemplateId((prev) => focusId || prev || list[0]?.id || "");
  };

  useEffect(() => {
    if (!open || !order) return;
    setTracking(order.tracking_code || "");
    setTrackingUrl((order as any).tracking_url || "");
    setDeliveryDays((order as any).delivery_days || "");
    setCarrier(order.shipping_carrier || order.delivery_method || "");
    void loadTemplates();
    supabase
      .from("whatsapp_numbers_safe")
      .select("id, label, phone_display")
      .eq("is_active", true)
      .eq("provider", "uazapi")
      .order("is_default", { ascending: false })
      .order("label")
      .then(({ data }) => {
        const list = (data || []) as UazapiNumberOption[];
        setNumbers(list);
        const boundId = order.wa_number_id;
        setNumberId(boundId && list.some((number) => number.id === boundId) ? boundId : list[0]?.id || "");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  const values = useMemo(
    () => (order ? buildTrackingValues(order, { carrier, deliveryDays, tracking, trackingUrl }) : {}),
    [order, carrier, deliveryDays, tracking, trackingUrl],
  );

  const tpl = templates.find((t) => t.id === templateId) || templates[0];
  const preview = tpl ? renderTrackingMessage(tpl.body, values).trim() : "";

  const send = async () => {
    if (!order) return;
    if (!tpl) return toast.error("Nenhuma mensagem de rastreio cadastrada");
    if (!tracking.trim()) return toast.error("Informe o código de rastreio");
    setSending(true);
    try {
      const id = await sendTrackingWhatsApp({
        phone: order.resolved_phone || order.customer_phone || "",
        message: preview,
        numberId,
      });
      if (!id) throw new Error("O provedor não confirmou o envio da mensagem");
      await supabase
        .from("pos_sales")
        .update({
          tracking_code: tracking.trim() || null,
          tracking_url: trackingUrl.trim() || null,
          delivery_days: deliveryDays.trim() || null,
        } as any)
        .eq("id", order.id);
      toast.success("Rastreio enviado no WhatsApp");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar rastreio", { duration: 10000 });
    } finally {
      setSending(false);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-exp-done" /> Enviar rastreio — {order.customer_name || "Cliente"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label className="text-base font-bold">Transportadora</Label>
              <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-12 text-base" />
            </div>
            <div>
              <Label className="text-base font-bold">Prazo de entrega (dias úteis)</Label>
              <Input value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} className="h-12 text-base" placeholder="Ex: 5 a 8" />
            </div>
            <div>
              <Label className="text-base font-bold">Código de rastreio</Label>
              <Input value={tracking} onChange={(e) => setTracking(e.target.value)} className="h-12 text-base" />
            </div>
            <div>
              <Label className="text-base font-bold">Link de rastreio</Label>
              <Input
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                className="h-12 text-base"
                placeholder={tracking.trim() ? trackingLink(tracking.trim()) : "https://..."}
              />
            </div>
          </div>

          <div className="flex items-end gap-2 flex-wrap">
            <div className="min-w-[220px] flex-1">
              <Label className="text-base font-bold">Mensagem</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-base">
                      {t.name}{t.is_default ? " (padrão)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="h-12 font-bold" onClick={() => setShowEditor(true)}>
              <Pencil className="h-4 w-4 mr-1" /> Editar
            </Button>
            <div className="min-w-[220px]">
              <Label className="text-base font-bold">Instância WhatsApp</Label>
              <Select value={numberId} onValueChange={setNumberId}>
                <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {numbers.map((n) => (
                    <SelectItem key={n.id} value={n.id} className="text-base">
                      {n.label || n.phone_display}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-xl border-2 border-dashed p-3">
            <p className="text-sm font-black mb-1">Pré-visualização</p>
            <p className="text-base whitespace-pre-wrap">{preview || "—"}</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button onClick={send} disabled={sending} className="h-12 font-black bg-exp-done text-white">
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              ENVIAR NO WHATSAPP
            </Button>
          </div>
        </div>

        <ExpTrackingTemplateEditor
          open={showEditor}
          onOpenChange={setShowEditor}
          previewValues={values}
          selectedId={templateId}
          onSaved={(list, activeId) => {
            setTemplates(list);
            setTemplateId(activeId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default ExpTrackingSendDialog;
