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
import { CheckCircle2, Loader2, ScanBarcode, FileText, Truck, Send, Link2, Pencil, Copy, Download, FileCode2 } from "lucide-react";
import { openFiscalDocument } from "@/lib/openFiscalDocument";

import { ExpOrder, brl, isCarrierWithTracking, isMototaxi, isPickup, trackingLink } from "./expeditionTypes";
import { ExpShippingFields, ShippingFieldsValue } from "./ExpShippingFields";
import { ExpOrderEditDialog } from "./ExpOrderEditDialog";
import { ExpTrackingTemplateEditor, TrackingTemplate } from "./ExpTrackingTemplateEditor";
import { saveExpeditionShippingCost } from "./shippingCost";
import { extractEdgeError } from "@/lib/edgeFunctionError";
import { isValidCpf, formatCpf, onlyDigitsCpf } from "@/lib/cpfUtils";
import { sendTrackingWhatsApp } from "@/lib/pos/trackingSend";
import { TrackingVarValues, formatShippingAddress, renderTrackingMessage } from "@/lib/pos/trackingMessage";


interface Props {
  order: ExpOrder;
  storeId?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFinished: () => void;
}

interface CheckState {
  scanned: boolean;
  feet_ok: boolean;
  has_defect: boolean;
}

export function ExpConferenceDialog({ order, storeId, open, onOpenChange, onFinished }: Props) {
  // Envio unificado: o card representa vários pedidos do mesmo cliente.
  const groupIds = useMemo(
    () => (order.group_order_ids?.length ? order.group_order_ids : [order.id]),
    [order],
  );
  const isUnified = groupIds.length > 1;
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [scanInput, setScanInput] = useState("");
  const [tracking, setTracking] = useState(order.tracking_code || "");
  const [trackingUrl, setTrackingUrl] = useState<string>((order as any).tracking_url || "");
  const [deliveryDays, setDeliveryDays] = useState<string>((order as any).delivery_days || "");
  const [shipping, setShipping] = useState<ShippingFieldsValue>({
    carrier: order.shipping_carrier || order.delivery_method || "",
    courier: order.courier_name || "",
    courierProviderId: "",
    cost: order.shipping_cost != null ? String(order.shipping_cost) : "",
  });
  const carrier = shipping.carrier;
  const courier = shipping.courier;
  const [nfeStatus, setNfeStatus] = useState<string | null>(null);
  const [nfeReject, setNfeReject] = useState<string | null>(null);
  const [nfeDoc, setNfeDoc] = useState<any | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  // Busca o último documento fiscal do pedido para exibir status e o MOTIVO REAL da rejeição.
  const loadNfeStatus = async () => {
    const { data } = await supabase
      .from("fiscal_documents")
      .select("id, status, numero, serie, chave_acesso, danfe_url, xml_url, xml_content, rejection_code, rejection_message")
      .eq("pos_sale_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setNfeDoc(data || null);
    setNfeStatus(data ? `${data.status}${data.numero ? ` nº ${data.numero}` : ""}` : null);
    const msg = (data as any)?.rejection_message || null;
    const code = (data as any)?.rejection_code || null;
    setNfeReject(
      data && data.status === "rejected" && (msg || code)
        ? [code ? `Rejeição ${code}` : null, msg].filter(Boolean).join(": ")
        : null,
    );
    return data as any;
  };

  const isAuthorized = ["authorized", "autorizada", "autorizado"].includes(String(nfeDoc?.status || ""));

  const copyChave = async () => {
    if (!nfeDoc?.chave_acesso) return;
    try {
      await navigator.clipboard.writeText(nfeDoc.chave_acesso);
      toast.success("Chave de acesso copiada");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const downloadXml = async () => {
    let xml = nfeDoc?.xml_content as string | undefined;
    if (!xml) {
      setBackfilling(true);
      try {
        await supabase.functions.invoke("fiscal-backfill-danfe", { body: { document_id: nfeDoc?.id } });
        const fresh = await loadNfeStatus();
        xml = fresh?.xml_content;
      } finally {
        setBackfilling(false);
      }
    }
    if (!xml) return toast.error("XML ainda não disponível para esta NF-e");
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NFe-${nfeDoc?.chave_acesso || nfeDoc?.numero}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openDanfe = async () => {
    let url = nfeDoc?.danfe_url as string | undefined;
    if (!url) {
      setBackfilling(true);
      try {
        await supabase.functions.invoke("fiscal-backfill-danfe", { body: { document_id: nfeDoc?.id } });
        const fresh = await loadNfeStatus();
        url = fresh?.danfe_url;
      } finally {
        setBackfilling(false);
      }
    }
    if (!url) return toast.error("DANFE ainda não disponível para esta NF-e");
    try {
      await openFiscalDocument(url, { autoPrint: true });
    } catch (e: any) {
      toast.error(e?.message || "Erro ao abrir DANFE");
    }
  };


  const [emitting, setEmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [numberId, setNumberId] = useState<string>("");
  const [showEdit, setShowEdit] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkItemId, setLinkItemId] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [templates, setTemplates] = useState<TrackingTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [showTplEditor, setShowTplEditor] = useState(false);

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
    const init: Record<string, CheckState> = {};
    for (const it of order.items) init[it.id] = { scanned: false, feet_ok: false, has_defect: false };
    setChecks(init);

    void loadNfeStatus();
    void loadTemplates();


    supabase
      .from("whatsapp_numbers_safe")
      .select("id, label, phone_display")
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

  const handleScan = async (raw?: string) => {
    const code = (raw ?? scanInput).replace(/\s/g, "");
    if (!code) return;
    const item = order.items.find((i) => i.barcode === code && !checks[i.id]?.scanned);
    if (item) {
      setChecks((p) => ({ ...p, [item.id]: { ...p[item.id], scanned: true } }));
      setScanInput("");
      toast.success(`Bipado: ${item.product_name}`);
      return;
    }
    if (order.items.some((i) => i.barcode === code)) {
      toast.error("Este código já foi bipado");
      setScanInput("");
      return;
    }
    // Código não vinculado (ex.: produto veio da Shopify/Tiny com outro GTIN).
    // Buscamos o produto no catálogo do PDV e oferecemos vincular ao item do pedido.
    let found: any = null;
    try {
      const { data } = await supabase
        .from("pos_products")
        .select("name, sku, barcode")
        .or(`barcode.eq.${code},sku.eq.${code}`)
        .limit(1)
        .maybeSingle();
      found = data;
    } catch {
      /* ignore */
    }
    const pending = order.items.filter((i) => !checks[i.id]?.scanned);
    if (!pending.length) {
      toast.error("Todos os itens deste pedido já foram bipados");
      setScanInput("");
      return;
    }
    setLinkItemId(pending.length === 1 ? pending[0].id : "");
    setLinkCode(code);
    toast.info(found ? `Código de "${found.name}" não vinculado a este pedido` : "Código não encontrado no pedido");
  };

  const confirmLink = async () => {
    if (!linkCode || !linkItemId) return toast.error("Selecione o item correspondente");
    setLinking(true);
    try {
      const { error } = await supabase
        .from("pos_sale_items")
        .update({ barcode: linkCode })
        .eq("id", linkItemId);
      if (error) throw error;
      const it = order.items.find((i) => i.id === linkItemId);
      if (it) it.barcode = linkCode;
      setChecks((p) => ({ ...p, [linkItemId]: { ...p[linkItemId], scanned: true } }));
      toast.success("Código vinculado ao item e bipado");
      setLinkCode(null);
      setLinkItemId("");
      setScanInput("");
    } catch (e: any) {
      toast.error(e.message || "Erro ao vincular código");
    } finally {
      setLinking(false);
    }
  };


  const emitNfe = async () => {
    // Pré-validação local: evita rejeição 237 (CPF do destinatário inválido) na SEFAZ.
    // Se a venda não tem CPF/e-mail, puxamos da ficha do cliente e persistimos.
    const { cpf } = await hydrateSaleCustomer(order, groupIds);
    if (cpf) order.customer_cpf = cpf;
    if (!isValidCpf(cpf || "")) {
      const msg = onlyDigitsCpf(cpf || "")
        ? `CPF do cliente inválido (${formatCpf(cpf || "")}) — dígito verificador não confere. Corrija em "Editar dados do pedido / NF-e".`
        : 'Pedido sem CPF do destinatário. Informe em "Editar dados do pedido / NF-e".';
      setNfeReject(msg);
      toast.error(msg, { duration: 12000 });
      return;
    }

    setEmitting(true);
    try {
      let data: any = null;
      let error: any = null;
      // Envio unificado: cada venda tem a sua própria NF-e — emitimos uma a uma.
      for (const sid of groupIds) {
        const res = await supabase.functions.invoke("nfe-emitir", { body: { sale_id: sid } });
        data = res.data;
        error = res.error;
        if (error || (res.data as any)?.error) break;
      }
      if (error) {
        const msg = await extractEdgeError(error, "Erro ao emitir NF-e");
        setNfeReject(msg);
        toast.error(msg, { duration: 12000 });
        await loadNfeStatus();
        return;
      }
      if ((data as any)?.error) {
        setNfeReject((data as any).error);
        toast.error((data as any).error, { duration: 12000 });
        await loadNfeStatus();
        return;
      }
      setNfeReject(null);
      setNfeStatus(`authorized${(data as any)?.numero ? ` nº ${(data as any).numero}` : ""}`);
      toast.success("NF-e autorizada");
    } catch (e: any) {
      const msg = await extractEdgeError(e, "Erro ao emitir NF-e");
      setNfeReject(msg);
      toast.error(msg, { duration: 12000 });
      await loadNfeStatus();
    } finally {
      setEmitting(false);
    }
  };


  /** Valores reais do pedido para preencher as variáveis da mensagem. */
  const trackingValues: TrackingVarValues = useMemo(() => {
    const full = String(order.customer_name || "").trim();
    const addr = order.shipping_address || {};
    return {
      nome: full,
      primeiro_nome: full.split(" ")[0] || "",
      transportadora: carrier || courier || "",
      prazo_entrega: deliveryDays || "",
      codigo_rastreio: tracking.trim(),
      link_rastreio: trackingUrl.trim() || (tracking.trim() ? trackingLink(tracking.trim()) : ""),
      valor_pedido: brl(order.total || 0),
      endereco: formatShippingAddress(addr),
      cidade: (addr as any)?.city || (addr as any)?.cidade || "",
      estado: (addr as any)?.state || (addr as any)?.uf || "",
      cep: (addr as any)?.zip_code || (addr as any)?.cep || "",
      pedido_numero: String(order.id).slice(0, 8).toUpperCase(),
      itens: order.items
        .map((i) => `${i.quantity}x ${[i.product_name, i.variant_name, i.size && `Tam ${i.size}`].filter(Boolean).join(" ")}`)
        .join("\n"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, carrier, courier, deliveryDays, tracking, trackingUrl]);

  const sendTrackingWa = async () => {
    const phone = (order.resolved_phone || order.customer_phone || "").replace(/\D/g, "");
    if (!phone) return toast.error("Cliente sem WhatsApp");
    if (!numberId) return toast.error("Selecione a instância de WhatsApp");
    if (!tracking.trim()) return toast.error("Informe o código de rastreio");
    const tpl = templates.find((t) => t.id === templateId) || templates[0];
    if (!tpl) return toast.error("Nenhuma mensagem de rastreio cadastrada");
    setSendingWa(true);
    try {
      const message = renderTrackingMessage(tpl.body, trackingValues).trim();
      // Rota por provider real + x-force-instance (a expedidora escolhe a instância
      // conscientemente; sem isso o instance-guard devolvia 409 e nada era enviado).
      const messageId = await sendTrackingWhatsApp({ phone, message, numberId });
      if (!messageId) throw new Error("O provedor não confirmou o envio da mensagem");
      // Persiste o link/prazo informados para não perder o dado ao fechar o modal.
      await supabase
        .from("pos_sales")
        .update({
          tracking_code: tracking.trim() || null,
          tracking_url: trackingUrl.trim() || null,
          delivery_days: deliveryDays.trim() || null,
        } as any)
        .in("id", groupIds);
      toast.success("Rastreio enviado no WhatsApp");

    } catch (e: any) {
      toast.error(e?.message || "Erro ao enviar rastreio", { duration: 10000 });
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
    if (isMototaxi(carrier) && !courier.trim()) return toast.error("Informe o entregador");
    if (!isPickup(carrier) && !(Number(shipping.cost) >= 0))
      return toast.error("Informe o valor do envio");

    setFinishing(true);
    try {
      await supabase.from("pos_expedition_checks").delete().in("sale_id", groupIds);
      const rows = order.items.map((it) => ({
        sale_id: it.sale_id || order.id,
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
          tracking_url: trackingUrl.trim() || null,
          delivery_days: deliveryDays.trim() || null,
          courier_name: courier.trim() || null,
        } as any)
        .in("id", groupIds);
      if (error) throw error;

      await saveExpeditionShippingCost({
        saleId: order.id,
        storeId: storeId || order.store_id,
        carrier,
        courierProviderId: shipping.courierProviderId,
        courierName: courier,
        cost: Number(shipping.cost) || 0,
        customerName: order.customer_name,
      });


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
            {isUnified && (
              <Badge className="bg-exp-check text-white text-sm font-black">
                ENVIO UNIFICADO · {groupIds.length} pedidos
              </Badge>
            )}
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
                {isAuthorized ? "Reemitir NF-e" : "Emitir NF-e"}
              </Button>
              <Button variant="outline" className="font-bold" onClick={() => setShowEdit(true)}>
                <Pencil className="h-4 w-4 mr-1" /> Editar dados do pedido / NF-e
              </Button>
            </div>

            {isAuthorized && (
              <div className="mt-3 rounded-lg border-2 border-exp-prep/30 bg-exp-prep/5 p-3 space-y-2">
                <div>
                  <p className="text-xs font-black uppercase text-pos-muted-text">Chave de acesso (44 dígitos)</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-bold break-all">{nfeDoc?.chave_acesso || "—"}</code>
                    {nfeDoc?.chave_acesso && (
                      <Button size="sm" variant="outline" className="font-bold" onClick={copyChave}>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                      </Button>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-pos-muted-text mt-1">
                    NF-e nº {nfeDoc?.numero ?? "—"} • Série {nfeDoc?.serie ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="font-bold" onClick={openDanfe} disabled={backfilling}>
                    {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                    Baixar / imprimir DANFE (PDF)
                  </Button>
                  <Button size="sm" variant="outline" className="font-bold" onClick={downloadXml} disabled={backfilling}>
                    {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileCode2 className="h-3.5 w-3.5 mr-1" />}
                    Baixar XML
                  </Button>
                </div>
              </div>
            )}

            {nfeReject ? (
              <div className="mt-2 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm font-black text-destructive">Motivo da rejeição</p>
                <p className="text-sm font-semibold text-destructive break-words">{nfeReject}</p>
                <p className="mt-1 text-xs font-semibold text-pos-muted-text">
                  Corrija em "Editar dados do pedido / NF-e" e emita novamente.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm font-semibold text-pos-muted-text">
                Deu rejeição? O motivo exato aparece aqui — corrija os dados e emita novamente.
              </p>
            )}

          </div>

          {/* Envio */}
          <div className="rounded-xl border-2 border-exp-pick/40 p-4 space-y-3">
            <p className="text-lg font-black flex items-center gap-2">
              <Truck className="h-5 w-5 text-exp-pick" /> 3. Envio e rastreio
            </p>
            <ExpShippingFields value={shipping} onChange={setShipping} />
            {!isMototaxi(carrier) && !isPickup(carrier) && (
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-base font-bold">Código de rastreio</Label>
                  <Input value={tracking} onChange={(e) => setTracking(e.target.value)} className="h-12 text-base" placeholder="Ex: AA123456789BR" />
                </div>
                <div>
                  <Label className="text-base font-bold">Prazo de entrega (dias úteis)</Label>
                  <Input
                    value={deliveryDays}
                    onChange={(e) => setDeliveryDays(e.target.value)}
                    className="h-12 text-base"
                    placeholder="Ex: 5 a 8"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-base font-bold">Link de rastreio</Label>
                  <Input
                    value={trackingUrl}
                    onChange={(e) => setTrackingUrl(e.target.value)}
                    className="h-12 text-base"
                    placeholder={tracking.trim() ? trackingLink(tracking.trim()) : "https://..."}
                  />
                </div>
              </div>
            )}


            {isCarrierWithTracking(carrier) && (
              <div className="space-y-3">
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="min-w-[240px] flex-1">
                    <Label className="text-base font-bold">Mensagem de rastreio</Label>
                    <Select value={templateId} onValueChange={setTemplateId}>
                      <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione a mensagem" /></SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id} className="text-base">
                            {t.name}{t.is_default ? " (padrão)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="outline" className="h-12 font-bold" onClick={() => setShowTplEditor(true)}>
                    <Pencil className="h-4 w-4 mr-1" /> Editar / criar mensagem
                  </Button>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
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
                  <Button onClick={sendTrackingWa} disabled={sendingWa} variant="outline" className="h-12 font-bold">
                    {sendingWa ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                    Enviar rastreio no WhatsApp
                  </Button>
                </div>
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

        {/* Vincular código de barras desconhecido a um item do pedido */}
        <Dialog open={!!linkCode} onOpenChange={(v) => !v && setLinkCode(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl font-black flex items-center gap-2">
                <Link2 className="h-5 w-5 text-exp-check" /> Vincular código {linkCode}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-base font-semibold text-pos-muted-text">
                Este código não está cadastrado no item. Selecione o produto correspondente para vincular
                permanentemente — as próximas bipagens vão funcionar.
              </p>
              <Select value={linkItemId} onValueChange={setLinkItemId}>
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="Selecione o item do pedido" />
                </SelectTrigger>
                <SelectContent>
                  {order.items
                    .filter((i) => !checks[i.id]?.scanned)
                    .map((i) => (
                      <SelectItem key={i.id} value={i.id} className="text-base">
                        {[i.product_name, i.variant_name, i.size && `Tam ${i.size}`].filter(Boolean).join(" • ")}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setLinkCode(null)}>
                  Cancelar
                </Button>
                <Button onClick={confirmLink} disabled={linking} className="font-black bg-exp-check text-white">
                  {linking ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
                  VINCULAR E BIPAR
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {showEdit && (
          <ExpOrderEditDialog
            order={order}
            storeId={storeId || order.store_id}
            open={showEdit}
            onOpenChange={setShowEdit}
            onSaved={() => setShowEdit(false)}
          />
        )}

        <ExpTrackingTemplateEditor
          open={showTplEditor}
          onOpenChange={setShowTplEditor}
          previewValues={trackingValues}
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
