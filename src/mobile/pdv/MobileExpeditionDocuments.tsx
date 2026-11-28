import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Download, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { type ExpOrder, brl } from "@/lib/pos/expedition";
import { hydrateSaleCustomer } from "@/components/pos/expedition/customerHydrate";
import { isValidCpf } from "@/lib/cpfUtils";
import { openFiscalDocument } from "@/lib/openFiscalDocument";
import { extractEdgeError } from "@/lib/edgeFunctionError";
import { freightCall } from "@/lib/saleFreight";
import { correiosLabelUrl, CORREIOS_LABEL_FORMATS, type CorreiosLabelFormat } from "@/lib/correiosLabelFormat";

/** Same emission and existing-label endpoints as desktop. No create/cancel pre-postage path. */
export function MobileExpeditionDocuments({ order, allowEmission = false }: { order: ExpOrder; allowEmission?: boolean }) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const invoice = useQuery({ queryKey: ["mobile-expedition-invoice", order.id], queryFn: async () => {
    const { data, error } = await supabase.from("fiscal_documents").select("id,status,numero,serie,danfe_url,rejection_message")
      .eq("pos_sale_id", order.id).eq("modelo", 55).eq("tipo_operacao", "saida").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error; return data;
  } });
  const shipment = useQuery({ queryKey: ["mobile-expedition-label", order.id], queryFn: async () => {
    const { data, error } = await supabase.from("correios_shipments").select("id,status,codigo_objeto,prepostagem_id")
      .contains("sale_ids", [order.id]).not("status", "in", "(cancelada,erro)").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error; return data;
  } });
  const authorized = ["authorized", "autorizada", "autorizado"].includes(invoice.data?.status || "");
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); } catch (e) { toast.error(await extractEdgeError(e, "Não consegui concluir a operação")); }
    finally { lock.current = false; setBusy(false); }
  };
  const emit = () => run(async () => {
    setConfirm(false);
    const ids = order.group_order_ids?.length ? order.group_order_ids : [order.id];
    if (invoice.data?.status !== "pending_sefaz") {
      const { cpf } = await hydrateSaleCustomer(order, ids);
      if (!isValidCpf(cpf || "")) throw new Error("Confira o CPF em Editar dados do pedido antes de emitir a nota.");
    }
    try {
      for (const id of ids) {
        const { data, error } = await supabase.functions.invoke("nfe-emitir", { body: { sale_id: id,
          ...(id === order.id && invoice.data?.status === "pending_sefaz" ? { retry_document_id: invoice.data.id } : {}) } });
        if (error) throw new Error(await extractEdgeError(error, "Não foi possível confirmar a emissão; atualize o status antes de tentar novamente."));
        if (data?.error) throw new Error(data.error);
        if (data?.contingencia || !data?.ok) { toast.warning(data?.message || "Nota pendente. Atualize o status antes de tentar novamente."); return; }
      }
      toast.success("NF-e autorizada");
    } finally { await invoice.refetch(); }
  });
  const danfe = () => run(async () => {
    let url = invoice.data?.danfe_url;
    if (!url && invoice.data?.id) {
      const { error } = await supabase.functions.invoke("fiscal-backfill-danfe", { body: { document_id: invoice.data.id } });
      if (error) throw error;
      url = (await invoice.refetch()).data?.danfe_url;
    }
    if (!url) throw new Error("DANFE ainda não disponível.");
    await openFiscalDocument(url, { autoPrint: false });
  });
  const label = (format: CorreiosLabelFormat) => run(async () => {
    const s = shipment.data;
    if (!s?.prepostagem_id) throw new Error("Etiqueta ainda não disponível.");
    // Existing pre-postage only: this endpoint cannot create another purchase.
    const r = await freightCall<{ shipment: Parameters<typeof correiosLabelUrl>[0] }>("correios-shipment", { action: "label", shipment_id: s.id, format });
    const url = correiosLabelUrl(r.shipment, format);
    if (!url) throw new Error("PDF ainda não disponível.");
    await openFiscalDocument(url, { autoPrint: false });
  });
  return <section aria-label="Documentos do envio" className="space-y-3 border-t pt-4">
    <div className="flex items-center justify-between"><h3 className="font-bold">Nota fiscal e etiqueta</h3><Button variant="ghost" size="icon" className="h-12 w-12" aria-label="Atualizar documentos" disabled={busy} onClick={() => { void invoice.refetch(); void shipment.refetch(); }}><RefreshCw className="h-5 w-5" /></Button></div>
    {(invoice.isError || shipment.isError) && <p role="alert" className="text-sm text-destructive">Não consegui consultar todos os documentos. Atualize antes de continuar.</p>}
    {invoice.data && <p className="break-words text-sm">NF-e {invoice.data.numero ? `nº ${invoice.data.numero}` : ""} · {authorized ? "Autorizada" : invoice.data.status}{invoice.data.rejection_message ? ` — ${invoice.data.rejection_message}` : ""}</p>}
    {allowEmission && !authorized && <Button className="h-12 w-full" disabled={busy || invoice.isPending || invoice.isError} onClick={() => setConfirm(true)}><FileText className="mr-2 h-5 w-5" />{invoice.data?.status === "pending_sefaz" ? "Consultar e retomar a mesma nota" : "Emitir nota fiscal"}</Button>}
    {authorized && <Button variant="outline" className="h-12 w-full" disabled={busy} onClick={() => void danfe()}><Download className="mr-2 h-5 w-5" />Abrir/baixar DANFE</Button>}
    {shipment.data?.prepostagem_id && <div className="space-y-2">{CORREIOS_LABEL_FORMATS.map(f => <Button key={f.value} variant="outline" className="min-h-12 w-full whitespace-normal text-left" disabled={busy} onClick={() => void label(f.value)}><Download className="mr-2 h-5 w-5 shrink-0" />Abrir/baixar {f.label}</Button>)}</div>}
    {busy && <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-label="Processando documento" />}
    <Sheet open={confirm} onOpenChange={v => !busy && setConfirm(v)}><SheetContent side="bottom" className="h-[100dvh] overflow-y-auto"><SheetHeader><SheetTitle>Confirmar emissão fiscal</SheetTitle><SheetDescription>Esta operação solicita uma nota à SEFAZ e não pode ser desfeita por este botão.</SheetDescription></SheetHeader><div className="mt-6 space-y-4"><p className="break-words font-bold">{order.customer_name} · #{order.id.slice(0, 8).toUpperCase()}</p><p>Total do pedido: {brl(order.total)}</p>{invoice.data?.status === "pending_sefaz" && <p>Será consultada e retomada a mesma nota, sem reservar outro número.</p>}<Button className="h-12 w-full" disabled={busy} onClick={() => void emit()}>Confirmar emissão</Button><Button variant="outline" className="h-12 w-full" disabled={busy} onClick={() => setConfirm(false)}>Voltar sem emitir</Button></div></SheetContent></Sheet>
  </section>;
}