import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Loader2, ScanBarcode, FileText, Truck, Send } from "lucide-react";
import { ExpOrder, SHIPPING_OPTIONS, brl, isCarrierWithTracking, trackingLink } from "./expeditionTypes";
import { extractEdgeError } from "@/lib/edgeFunctionError";

interface Props {
  order: ExpOrder;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFinished: () => void;
}

interface CheckState {
  scanned: boolean;
  feet_ok: boolean;
  has_defect: boolean;
}

export function ExpConferenceDialog({ order, open, onOpenChange, onFinished }: Props) {
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [scanInput, setScanInput] = useState("");
  const [carrier, setCarrier] = useState(order.shipping_carrier || order.delivery_method || "");
  const [courier, setCourier] = useState(order.courier_name || "");
  const [tracking, setTracking] = useState(order.tracking_code || "");
  const [nfeStatus, setNfeStatus] = useState<string | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [numberId, setNumberId] = useState<string>("");

  useEffect(() => {
    const init: Record<string, CheckState> = {};
    for (const it of order.items) init[it.id] = { scanned: false, feet_ok: false, has_defect: false };
    setChecks(init);

    supabase
      .from("fiscal_documents")
      .select("status, numero")
      .eq("pos_sale_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setNfeStatus(data ? `${data.status}${data.numero ? ` nº ${data.numero}` : ""}` : null));

    supabase
      .from("whatsapp_numbers_safe")
      .select("id, display_name, phone_number")
      .eq("is_active", true)
      .then(({ data }) => {
        setNumbers(data || []);
        if (data?.length) setNumberId(data[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const allScanned = useMemo(
    () => order.items.every((it) => checks[it.id]?.scanned),
    [order.items, checks],
  );
  const allChecked = useMemo(
    () => order.items.every((it) => checks[it.id]?.feet_ok),
    [order.items, checks],
  );
  const hasDefect = useMemo(
    () => order.items.some((it) => checks[it.id]?.has_defect),
    [order.items, checks],
  );

  const handleScan = (raw?: string) => {
    const code = (raw ?? scanInput).replace(/\s/g, "");
    if (!code) return;
    const item = order.items.find((i) => i.barcode === code && !checks[i.id]?.scanned);
    if (!item) {
      toast.error("Código não pertence a este pedido (ou já bipado)");
      return;
    }
    setChecks((p) => ({ ...p, [item.id]: { ...p[item.id], scanned: true } }));
    setScanInput("");
    toast.success(`Bipado: ${item.product_name}`);
  };

  const emitNfe = async () => {
    setEmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("nfe-emitir", { body: { sale_id: order.id } });
      if (error) {
        toast.error(await extractEdgeError(error, "Erro ao emitir NF-e"), { duration: 12000 });
        return;
      }
      if ((data as any)?.error) {
        toast.error((data as any).error, { duration: 12000 });
        return;
      }
      setNfeStatus(`authorized${(data as any)?.numero ? ` nº ${(data as any).numero}` : ""}`);
      toast.success("NF-e autorizada");
    } catch (e: any) {
      toast.error(await extractEdgeError(e, "Erro ao emitir NF-e"), { duration: 12000 });
    } finally {
      setEmitting(false);
    }
  };

  const sendTrackingWa = async () => {
    const phone = (order.customer_phone || "").replace(/\D/g, "");
    if (!phone) return toast.error("Cliente sem WhatsApp");
    if (!numberId) return toast.error("Selecione a instância de WhatsApp");
    if (!tracking.trim()) return toast.error("Informe o código de rastreio");
    setSendingWa(true);
    try {
      const greeting = order.customer_name ? `Oi, ${String(order.customer_name).split(" ")[0]}!` : "Oi!";
      const message = `${greeting} 📦\nSeu pedido foi despachado.\n\n*Transportadora:* ${carrier || "-"}\n*Código de rastreio:* ${tracking.trim()}\n*Acompanhe:* ${trackingLink(tracking.trim())}`;
      const { data: num } = await supabase
        .from("whatsapp_numbers_safe")
        .select("provider")
        .eq("id", numberId)
        .maybeSingle();
      const fn = (num as any)?.provider === "meta" ? "meta-whatsapp-send" : "zapi-send-message";
      const { error } = await supabase.functions.invoke(fn, {
        body: { phone, message, whatsapp_number_id: numberId },
      });
      if (error) throw error;
      toast.success("Rastreio enviado no WhatsApp");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar rastreio");
    } finally {
      setSendingWa(false);
    }
  };

  const finish = async () => {
    if (!allScanned) return toast.error("Bipe todos os itens antes de finalizar");
    if (!allChecked) return toast.error("Confirme o checklist de todos os itens");
    if (!carrier) return toast.error("Selecione a forma de envio");
    if (isCarrierWithTracking(carrier) && !tracking.trim())
      return toast.error("Informe o código de rastreio");
    if (carrier === "Mototaxi" && !courier.trim()) return toast.error("Informe o entregador");

    setFinishing(true);
    try {
      await supabase.from("pos_expedition_checks").delete().eq("sale_id", order.id);
      const rows = order.items.map((it) => ({
        sale_id: order.id,
        sale_item_id: it.id,
        barcode: it.barcode,
        scanned: !!checks[it.id]?.scanned,
        feet_ok: !!checks[it.id]?.feet_ok,
        has_defect: !!checks[it.id]?.has_defect,
      }));
      const { error: insErr } = await supabase.from("pos_expedition_checks").insert(rows);
      if (insErr) throw insErr;

      const { error } = await supabase
        .from("pos_sales")
        .update({
          expedition_stage: "concluido",
          expedition_finished_at: new Date().toISOString(),
          shipping_carrier: carrier,
          tracking_carrier: carrier,
          tracking_code: tracking.trim() || null,
          courier_name: courier.trim() || null,
        })
        .eq("id", order.id);
      if (error) throw error;

      toast.success("Expedição concluída — pedido liberado na aba PEDIDOS");
      onFinished();
    } catch (e: any) {
      toast.error(e.message || "Erro ao concluir expedição");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black flex items-center gap-2">
            <ScanBarcode className="h-7 w-7 text-exp-check" />
            Conferência — {order.customer_name || "Cliente"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Bipagem */}
          <div className="rounded-xl border-2 border-exp-check/40 p-4">
            <p className="text-lg font-black mb-2">1. Bipagem dos itens</p>
            <div className="flex gap-2">
              <Input
                autoFocus
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScan();
                  }
                }}
                placeholder="Bipe o código de barras..."
                className="h-12 text-lg font-bold"
              />
              <Button size="lg" onClick={() => handleScan()}>Bipar</Button>
            </div>

            <div className="mt-3 space-y-2">
              {order.items.map((it) => {
                const c = checks[it.id];
                return (
                  <div
                    key={it.id}
                    className={`rounded-lg p-3 border-2 ${c?.scanned ? "border-exp-done bg-exp-done/10" : "border-pos-border"}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-lg font-bold">{it.product_name}</p>
                        <p className="text-base font-semibold text-pos-muted-text">
                          {[it.variant_name, it.size && `Tam ${it.size}`, it.barcode].filter(Boolean).join(" • ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black">{it.quantity}x {brl(it.unit_price)}</span>
                        {c?.scanned ? (
                          <Badge className="bg-exp-done text-white text-sm font-bold">BIPADO</Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => handleScan(it.barcode || "")}>
                            Marcar manual
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-5">
                      <label className="flex items-center gap-2 text-base font-semibold">
                        <Checkbox
                          checked={!!c?.feet_ok}
                          onCheckedChange={(v) =>
                            setChecks((p) => ({ ...p, [it.id]: { ...p[it.id], feet_ok: !!v } }))
                          }
                        />
                        Pés iguais / par correto
                      </label>
                      <label className="flex items-center gap-2 text-base font-semibold">
                        <Checkbox
                          checked={!!c?.has_defect}
                          onCheckedChange={(v) =>
                            setChecks((p) => ({ ...p, [it.id]: { ...p[it.id], has_defect: !!v } }))
                          }
                        />
                        Possui defeito
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            {hasDefect && (
              <p className="mt-2 text-base font-bold text-destructive">
                Atenção: item marcado com defeito — troque a peça antes de finalizar.
              </p>
            )}
          </div>

          {/* NF-e */}
          <div className="rounded-xl border-2 border-exp-prep/40 p-4">
            <p className="text-lg font-black mb-2 flex items-center gap-2">
              <FileText className="h-5 w-5 text-exp-prep" /> 2. Nota fiscal
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="text-base font-bold">
                {nfeStatus ? `NF-e: ${nfeStatus}` : "NF-e não emitida"}
              </Badge>
              <Button onClick={emitNfe} disabled={emitting} className="bg-exp-prep hover:bg-exp-prep/90 text-white font-bold">
                {emitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
                Emitir NF-e
              </Button>
            </div>
          </div>

          {/* Envio */}
          <div className="rounded-xl border-2 border-exp-pick/40 p-4 space-y-3">
            <p className="text-lg font-black flex items-center gap-2">
              <Truck className="h-5 w-5 text-exp-pick" /> 3. Envio e rastreio
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label className="text-base font-bold">Forma de envio</Label>
                <Select value={carrier} onValueChange={setCarrier}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {SHIPPING_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="text-base">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {carrier === "Mototaxi" ? (
                <div>
                  <Label className="text-base font-bold">Entregador</Label>
                  <Input value={courier} onChange={(e) => setCourier(e.target.value)} className="h-12 text-base" placeholder="Nome do mototaxista" />
                </div>
              ) : (
                <div>
                  <Label className="text-base font-bold">Código de rastreio</Label>
                  <Input value={tracking} onChange={(e) => setTracking(e.target.value)} className="h-12 text-base" placeholder="Ex: AA123456789BR" />
                </div>
              )}
            </div>

            {isCarrierWithTracking(carrier) && (
              <div className="flex items-end gap-2 flex-wrap">
                <div className="min-w-[220px]">
                  <Label className="text-base font-bold">Instância WhatsApp</Label>
                  <Select value={numberId} onValueChange={setNumberId}>
                    <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {numbers.map((n) => (
                        <SelectItem key={n.id} value={n.id} className="text-base">
                          {n.display_name || n.phone_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={sendTrackingWa} disabled={sendingWa} variant="outline" className="h-12 font-bold">
                  {sendingWa ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Enviar rastreio no WhatsApp
                </Button>
              </div>
            )}
          </div>

          <Button
            size="lg"
            className="w-full h-14 text-xl font-black bg-exp-done hover:bg-exp-done/90 text-white"
            onClick={finish}
            disabled={finishing}
          >
            {finishing ? <Loader2 className="h-6 w-6 animate-spin mr-2" /> : <CheckCircle2 className="h-6 w-6 mr-2" />}
            CONCLUIR EXPEDIÇÃO
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
