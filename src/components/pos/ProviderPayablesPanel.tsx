import { useState, useEffect, useRef } from "react";
import { Truck, Loader2, DollarSign, Printer, Upload, FileText, Plus, CheckCircle, History, ChevronRight, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  fetchPayablesByProvider,
  payProvider,
  setPaymentProofUrl,
  setPaymentReceiptUrl,
  ProviderPayableSummary,
  DeliveryCost,
  ProviderPayment,
  sourceLabel,
  PROVIDER_TYPE_LABEL,
} from "@/lib/deliveryProviders";
import { printProviderReceipt } from "@/lib/providerReceipt";
import { DeliveryCostDialog } from "./DeliveryCostDialog";

interface Props {
  storeId: string;
  cashRegisterId?: string | null;
  onPaid?: () => void;
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ProviderPayablesPanel({ storeId, cashRegisterId, onPaid }: Props) {
  const [payables, setPayables] = useState<ProviderPayableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ProviderPayableSummary | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setPayables(await fetchPayablesByProvider());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openPay = (p: ProviderPayableSummary) => {
    setSelected(p);
    setCheckedIds(new Set(p.costs.map((c) => c.id))); // all selected by default
  };

  const toggle = (id: string) => {
    setCheckedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const selectedCosts: DeliveryCost[] = selected ? selected.costs.filter((c) => checkedIds.has(c.id)) : [];
  const selectedTotal = selectedCosts.reduce((s, c) => s + Number(c.amount || 0), 0);

  const confirmPay = async () => {
    if (!selected || selectedCosts.length === 0) { toast.error("Selecione ao menos uma corrida"); return; }
    if (!cashRegisterId) { toast.error("Abra o caixa para registrar a saída do pagamento"); return; }
    setPaying(true);
    try {
      const payment = await payProvider({
        provider: selected.provider,
        costIds: selectedCosts.map((c) => c.id),
        totalAmount: selectedTotal,
        cashRegisterId,
        paidStoreId: storeId,
      });
      toast.success(`Pagamento de ${brl(selectedTotal)} registrado e retirado do caixa!`);
      // generate receipt
      printProviderReceipt({ provider: selected.provider, payment, costs: selectedCosts });
      try {
        await setPaymentReceiptUrl(payment.id, "generated");
      } catch { /* ignore */ }
      setSelected(null);
      onPaid?.();
      load();
    } catch (e: any) {
      toast.error("Erro ao pagar: " + (e.message || ""));
    } finally {
      setPaying(false);
    }
  };

  const loadHistory = async () => {
    const { data } = await supabase
      .from("provider_payments" as any)
      .select("*, service_providers(name, provider_type)")
      .order("paid_at", { ascending: false })
      .limit(100);
    setHistory((data as any[]) || []);
  };

  const openHistory = () => { loadHistory(); setShowHistory(true); };

  const handleProofFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadingFor) return;
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `providers/${uploadingFor}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("payment-receipts").upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("payment-receipts").getPublicUrl(path);
      await setPaymentProofUrl(uploadingFor, urlData.publicUrl);
      toast.success("Recibo assinado anexado!");
      loadHistory();
    } catch (err: any) {
      toast.error("Erro no upload: " + (err.message || ""));
    } finally {
      setUploadingFor(null);
    }
  };

  const grandTotal = payables.reduce((s, p) => s + p.pendingTotal, 0);

  return (
    <div className="space-y-4">
      <input ref={uploadRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleProofFile} />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-pos-white flex items-center gap-2"><Truck className="h-4 w-4 text-pos-orange" /> Contas a Pagar — Prestadores</h3>
          <p className="text-xs text-pos-white/40">Total devido somando todas as lojas e módulos: <span className="text-pos-orange font-bold">{brl(grandTotal)}</span></p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400 gap-1" onClick={openHistory}>
            <History className="h-4 w-4" /> Histórico
          </Button>
          <Button size="sm" className="bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold gap-1" onClick={() => setShowManual(true)}>
            <Plus className="h-4 w-4" /> Registrar entrega
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-pos-orange" /></div>
      ) : payables.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <div className="h-14 w-14 mx-auto rounded-full bg-pos-white/5 flex items-center justify-center"><CheckCircle className="h-7 w-7 text-green-400/60" /></div>
          <p className="text-sm text-pos-white/40">Nenhuma conta pendente com prestadores.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {payables.map((p) => {
            const bySource = p.costs.reduce((acc, c) => { acc[c.source] = (acc[c.source] || 0) + 1; return acc; }, {} as Record<string, number>);
            return (
              <button key={p.provider.id} onClick={() => openPay(p)} className="w-full text-left flex items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10 hover:border-pos-orange/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-pos-white text-sm truncate">{p.provider.name}</span>
                    <Badge className="text-[9px] border-0 bg-pos-white/10 text-pos-white/70">{PROVIDER_TYPE_LABEL[p.provider.provider_type]}</Badge>
                  </div>
                  <p className="text-[10px] text-pos-white/40 mt-0.5">
                    {p.pendingCount} corrida{p.pendingCount > 1 ? "s" : ""} · {Object.entries(bySource).map(([s, n]) => `${n} ${sourceLabel(s)}`).join(" · ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-pos-orange">{brl(p.pendingTotal)}</p>
                  <p className="text-[9px] text-pos-white/40 flex items-center justify-end gap-0.5">pagar <ChevronRight className="h-3 w-3" /></p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pay dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="bg-pos-black border-pos-orange/30 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2"><DollarSign className="h-5 w-5 text-pos-orange" /> Pagar {selected?.provider.name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <p className="text-xs text-pos-white/50">Selecione as corridas que estão sendo pagas. O valor sairá do caixa desta loja.</p>
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                {selected.costs.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-pos-white/5 border border-pos-orange/10 cursor-pointer">
                    <Checkbox checked={checkedIds.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-pos-white truncate">{c.customer_name || "Entrega"} <span className="text-pos-white/40">· {sourceLabel(c.source)}</span></p>
                      <p className="text-[10px] text-pos-white/40">{new Date(c.created_at).toLocaleDateString("pt-BR")}</p>
                    </div>
                    <span className="text-sm font-bold text-pos-orange">{brl(Number(c.amount || 0))}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-pos-orange/10 border border-pos-orange/30">
                <span className="text-sm text-pos-white/70">Total a pagar ({selectedCosts.length})</span>
                <span className="text-lg font-bold text-pos-orange">{brl(selectedTotal)}</span>
              </div>
              {!cashRegisterId && <p className="text-[11px] text-red-400">Abra o caixa para registrar a saída do dinheiro.</p>}
              <Button className="w-full bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold h-11 gap-2" onClick={confirmPay} disabled={paying || selectedCosts.length === 0}>
                {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                {paying ? "Pagando..." : "Pagar e gerar recibo"}
              </Button>
              <p className="text-[10px] text-pos-white/40 text-center">Após imprimir e colher a assinatura, anexe o recibo escaneado no Histórico.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="bg-pos-black border-pos-orange/30 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-pos-white flex items-center gap-2"><History className="h-5 w-5 text-pos-orange" /> Histórico de Pagamentos</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-sm text-pos-white/40 text-center py-6">Nenhum pagamento registrado.</p>
            ) : history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-pos-white truncate">{h.service_providers?.name || "Prestador"}</p>
                  <p className="text-[10px] text-pos-white/40">{new Date(h.paid_at).toLocaleString("pt-BR")}</p>
                </div>
                <span className="text-sm font-bold text-pos-orange">{brl(Number(h.total_amount || 0))}</span>
                {h.proof_file_url ? (
                  <a href={h.proof_file_url} target="_blank" rel="noreferrer" className="text-green-400 hover:text-green-300" title="Ver recibo assinado">
                    <FileText className="h-4 w-4" />
                  </a>
                ) : (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-pos-white/60 hover:text-pos-orange" title="Anexar recibo assinado" onClick={() => { setUploadingFor(h.id); uploadRef.current?.click(); }}>
                    {uploadingFor === h.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <DeliveryCostDialog
        open={showManual}
        onOpenChange={setShowManual}
        source="pos"
        storeId={storeId}
        onSaved={load}
      />
    </div>
  );
}
