import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Loader2, Printer, Download, Wallet, AlertTriangle, CalendarClock,
  CheckCircle2, MessageCircle, RefreshCw, HandCoins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizeBRPhone } from "@/lib/phoneUtils";

const OWN_GATEWAY = "Crediário Próprio";

interface Props {
  storeId: string;
  onCashReceived?: (amount: number) => void;
}

interface Installment {
  id: string;
  sale_id: string;
  store_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  installment_number: number;
  installments_total: number;
  amount: number;
  due_date: string;
  status: string;
  paid_amount: number | null;
  paid_at: string | null;
  paid_method: string | null;
  gateway: string | null;
  code: string | null;
}

const fmt = (n: number | null | undefined) => `R$ ${Number(n || 0).toFixed(2)}`;
const dateBR = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

function todayIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}
function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}
function daysLate(due: string) {
  const t = new Date(`${todayIso()}T00:00:00`).getTime();
  const d = new Date(`${due.slice(0, 10)}T00:00:00`).getTime();
  return Math.floor((t - d) / 86400000);
}

export function POSCrediarioReceivables({ storeId, onCashReceived }: Props) {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(lastDayOfMonth());
  const [storeFilter, setStoreFilter] = useState<string>(storeId || "all");
  const [gatewayFilter, setGatewayFilter] = useState<string>(OWN_GATEWAY);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [gateways, setGateways] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Installment[]>([]);   // todas em aberto (para KPIs)
  const [received, setReceived] = useState<Installment[]>([]); // pagas no período
  const [selected, setSelected] = useState<Installment | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("pix");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    (async () => {
      const [st, gw] = await Promise.all([
        supabase.from("pos_stores").select("id, name").eq("is_active", true).order("name"),
        (supabase as any).from("pos_crediario_gateways").select("name").order("sort_order"),
      ]);
      setStores(((st.data as any) || []).map((s: any) => ({ id: s.id, name: s.name })));
      setGateways(Array.from(new Set([OWN_GATEWAY, ...(((gw.data as any) || []).map((g: any) => g.name))])));
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q1 = (supabase as any)
        .from("pos_crediario_installments")
        .select("*")
        .in("status", ["pendente", "atrasado", "parcial", "pending", "partial", "overdue"])
        .order("due_date", { ascending: true })
        .limit(3000);
      let q2 = (supabase as any)
        .from("pos_crediario_installments")
        .select("*")
        .in("status", ["pago", "paid"])

        .gte("paid_at", new Date(`${from}T00:00:00`).toISOString())
        .lte("paid_at", new Date(`${to}T23:59:59.999`).toISOString())
        .order("paid_at", { ascending: false })
        .limit(3000);

      if (storeFilter !== "all") {
        q1 = q1.eq("store_id", storeFilter);
        q2 = q2.eq("store_id", storeFilter);
      }
      if (gatewayFilter !== "all") {
        q1 = q1.eq("gateway", gatewayFilter);
        q2 = q2.eq("gateway", gatewayFilter);
      }

      const [r1, r2] = await Promise.all([q1, q2]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      setPending(((r1.data as any) || []) as Installment[]);
      setReceived(((r2.data as any) || []) as Installment[]);
    } catch (e: any) {
      console.error("[crediario receivables]", e);
      toast.error("Erro ao carregar contas a receber: " + (e?.message || "desconhecido"));
    } finally {
      setLoading(false);
    }
  }, [from, to, storeFilter, gatewayFilter]);

  useEffect(() => { load(); }, [load]);

  const balanceOf = (i: Installment) => Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0));

  const inRange = useMemo(
    () => pending.filter(i => i.due_date >= from && i.due_date <= to),
    [pending, from, to],
  );

  const kpis = useMemo(() => {
    const t = todayIso();
    const d7 = addDaysIso(7);
    const d30 = addDaysIso(30);
    const m1 = firstDayOfMonth();
    const m2 = lastDayOfMonth();
    const sum = (arr: Installment[]) => arr.reduce((a, i) => a + balanceOf(i), 0);
    return {
      month: sum(pending.filter(i => i.due_date >= m1 && i.due_date <= m2)),
      overdue: sum(pending.filter(i => i.due_date < t)),
      overdueCount: pending.filter(i => i.due_date < t).length,
      next7: sum(pending.filter(i => i.due_date >= t && i.due_date <= d7)),
      next30: sum(pending.filter(i => i.due_date >= t && i.due_date <= d30)),
      totalOpen: sum(pending),
      receivedPeriod: received.reduce((a, i) => a + Number(i.paid_amount || i.amount || 0), 0),
      rangeTotal: sum(inRange),
    };
  }, [pending, received, inRange, from, to]);

  const byGateway = useMemo(() => {
    const map: Record<string, { open: number; count: number }> = {};
    for (const i of pending) {
      const k = i.gateway || "Sem gateway";
      map[k] = map[k] || { open: 0, count: 0 };
      map[k].open += balanceOf(i);
      map[k].count += 1;
    }
    return Object.entries(map).sort((a, b) => b[1].open - a[1].open);
  }, [pending]);

  const isOwn = gatewayFilter === OWN_GATEWAY;

  const openWhatsapp = (phone: string | null) => {
    if (!phone) { toast.error("Cliente sem telefone"); return; }
    window.open(`https://wa.me/${normalizeBRPhone(phone)}`, "_blank");
  };

  const receive = async () => {
    if (!selected) return;
    const bal = balanceOf(selected);
    const amount = parseFloat(payAmount) || bal;
    if (!(amount > 0)) { toast.error("Valor inválido"); return; }
    if (amount > bal + 0.005) { toast.error("Valor maior que o saldo devedor"); return; }
    setPaying(true);
    try {
      const { error } = await supabase.rpc("pos_crediario_pay_installment" as any, {
        p_installment_id: selected.id,
        p_amount: amount,
        p_method: payMethod,
        p_notes: null,
      } as any);
      if (error) throw error;
      if (payMethod === "dinheiro") onCashReceived?.(amount);
      toast.success(`Recebimento de ${fmt(amount)} registrado`);
      setSelected(null);
      setPayAmount("");
      setPayMethod("pix");
      await load();
    } catch (e: any) {
      toast.error("Erro ao dar baixa: " + (e?.message || "desconhecido"));
    } finally {
      setPaying(false);
    }
  };

  const storeName = (id: string | null) => stores.find(s => s.id === id)?.name || "—";

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(["CONTAS A RECEBER — CREDIÁRIO"]);
    rows.push(["Gateway", gatewayFilter === "all" ? "Todos" : gatewayFilter]);
    rows.push(["Loja", storeFilter === "all" ? "Todas" : storeName(storeFilter)]);
    rows.push(["Vencimentos de", `${from} a ${to}`]);
    rows.push([]);
    rows.push(["RESUMO"]);
    rows.push(["A receber no mês", kpis.month.toFixed(2)]);
    rows.push(["Vencidas", kpis.overdue.toFixed(2)]);
    rows.push(["A vencer em 7 dias", kpis.next7.toFixed(2)]);
    rows.push(["A vencer em 30 dias", kpis.next30.toFixed(2)]);
    rows.push(["Total em aberto", kpis.totalOpen.toFixed(2)]);
    rows.push(["Recebido no período", kpis.receivedPeriod.toFixed(2)]);
    rows.push([]);
    rows.push(["PARCELAS A RECEBER (vencimento no período)"]);
    rows.push(["Código", "Cliente", "Telefone", "CPF", "Parcela", "Vencimento", "Valor", "Pago", "Saldo", "Atraso (dias)", "Gateway", "Loja"]);
    for (const i of inRange) {
      const late = daysLate(i.due_date);
      rows.push([
        i.code || "", i.customer_name || "", i.customer_phone || "", i.customer_cpf || "",
        `${i.installment_number}/${i.installments_total}`, dateBR(i.due_date),
        Number(i.amount || 0).toFixed(2), Number(i.paid_amount || 0).toFixed(2),
        balanceOf(i).toFixed(2), late > 0 ? String(late) : "0",
        i.gateway || "", storeName(i.store_id),
      ]);
    }
    rows.push([]);
    rows.push(["RECEBIDAS NO PERÍODO"]);
    rows.push(["Código", "Cliente", "Parcela", "Vencimento", "Pago em", "Forma", "Valor", "Gateway"]);
    for (const i of received) {
      rows.push([
        i.code || "", i.customer_name || "", `${i.installment_number}/${i.installments_total}`,
        dateBR(i.due_date), i.paid_at ? new Date(i.paid_at).toLocaleString("pt-BR") : "",
        i.paid_method || "", Number(i.paid_amount || i.amount || 0).toFixed(2), i.gateway || "",
      ]);
    }

    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contas_receber_crediario_${from}_a_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const esc = (s: any) => String(s ?? "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Contas a Receber — Crediário</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:20px;font-size:12px;}
h1{font-size:16px;margin:0 0 4px;}
h2{font-size:13px;margin:14px 0 6px;border-bottom:1px solid #000;padding-bottom:2px;}
table{width:100%;border-collapse:collapse;margin-top:4px;}
th,td{padding:3px 6px;text-align:left;border-bottom:1px dotted #999;font-size:11px;}
th{border-bottom:1px solid #000;}
.right{text-align:right;}
.muted{color:#666;font-size:10px;}
.box{border:2px solid #000;padding:10px;margin:8px 0;background:#fffbe6;}
.row{display:flex;justify-content:space-between;margin:2px 0;}
</style></head><body>
<h1>Contas a Receber — Crediário</h1>
<p class="muted">Gateway: ${esc(gatewayFilter === "all" ? "Todos" : gatewayFilter)} · Loja: ${esc(storeFilter === "all" ? "Todas" : storeName(storeFilter))} · Vencimentos: ${esc(from)} a ${esc(to)}</p>
<div class="box">
  <div class="row"><strong>A receber no mês</strong><strong>${fmt(kpis.month)}</strong></div>
  <div class="row"><span>Vencidas (${kpis.overdueCount})</span><span>${fmt(kpis.overdue)}</span></div>
  <div class="row"><span>A vencer em 7 dias</span><span>${fmt(kpis.next7)}</span></div>
  <div class="row"><span>A vencer em 30 dias</span><span>${fmt(kpis.next30)}</span></div>
  <div class="row"><span>Total em aberto</span><span>${fmt(kpis.totalOpen)}</span></div>
  <div class="row"><span>Recebido no período</span><span>${fmt(kpis.receivedPeriod)}</span></div>
</div>
<h2>Parcelas a receber (${inRange.length})</h2>
<table><thead><tr><th>Código</th><th>Cliente</th><th>Parcela</th><th>Vencimento</th><th class="right">Saldo</th><th class="right">Atraso</th><th>Gateway</th></tr></thead><tbody>
${inRange.map(i => `<tr><td>${esc(i.code || "—")}</td><td>${esc(i.customer_name || "—")}<br><span class="muted">${esc(i.customer_phone || "")}</span></td><td>${i.installment_number}/${i.installments_total}</td><td>${dateBR(i.due_date)}</td><td class="right">${fmt(balanceOf(i))}</td><td class="right">${daysLate(i.due_date) > 0 ? daysLate(i.due_date) + "d" : "—"}</td><td>${esc(i.gateway || "—")}</td></tr>`).join("")}
</tbody></table>
<h2>Recebidas no período (${received.length})</h2>
<table><thead><tr><th>Código</th><th>Cliente</th><th>Parcela</th><th>Pago em</th><th>Forma</th><th class="right">Valor</th></tr></thead><tbody>
${received.map(i => `<tr><td>${esc(i.code || "—")}</td><td>${esc(i.customer_name || "—")}</td><td>${i.installment_number}/${i.installments_total}</td><td>${i.paid_at ? new Date(i.paid_at).toLocaleString("pt-BR") : "—"}</td><td>${esc(i.paid_method || "—")}</td><td class="right">${fmt(i.paid_amount || i.amount)}</td></tr>`).join("")}
</tbody></table>
<p class="muted">Emitido em ${new Date().toLocaleString("pt-BR")}</p>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Permita pop-ups para imprimir"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[11px] text-pos-white/50">Vencimento de</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="h-10 w-[160px] bg-pos-white/5 border-pos-orange/20 text-pos-white" />
        </div>
        <div>
          <Label className="text-[11px] text-pos-white/50">até</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="h-10 w-[160px] bg-pos-white/5 border-pos-orange/20 text-pos-white" />
        </div>
        <div>
          <Label className="text-[11px] text-pos-white/50">Loja</Label>
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="h-10 w-[200px] bg-pos-white/5 border-pos-orange/20 text-pos-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-pos-black border-pos-orange/30 text-pos-white">
              <SelectItem value="all">Todas as lojas</SelectItem>
              {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] text-pos-white/50">Gateway</Label>
          <Select value={gatewayFilter} onValueChange={setGatewayFilter}>
            <SelectTrigger className="h-10 w-[220px] bg-pos-white/5 border-pos-orange/20 text-pos-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-pos-black border-pos-orange/30 text-pos-white">
              {gateways.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              <SelectItem value="all">Todos os gateways</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="h-10 gap-2 border-pos-orange/30 bg-pos-orange/10 text-pos-orange hover:bg-pos-orange/20"
          onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
        </Button>
        <Button variant="outline" className="h-10 gap-2 border-green-500/30 bg-green-500/10 text-green-500 hover:bg-green-500/20" onClick={exportCsv}>
          <Download className="h-4 w-4" /> CSV
        </Button>
        <Button variant="outline" className="h-10 gap-2 border-pos-white/20 text-pos-white hover:bg-pos-white/10" onClick={printReport}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>

      {!isOwn && gatewayFilter !== "all" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          Gateway de terceiros: o dinheiro destas parcelas é recebido pelo gateway, não entra no caixa da loja.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {[
          { label: "A receber no mês", value: kpis.month, icon: Wallet, color: "text-pos-orange" },
          { label: `Vencidas (${kpis.overdueCount})`, value: kpis.overdue, icon: AlertTriangle, color: "text-red-400" },
          { label: "Vence em 7 dias", value: kpis.next7, icon: CalendarClock, color: "text-amber-500" },
          { label: "Vence em 30 dias", value: kpis.next30, icon: CalendarClock, color: "text-amber-500" },
          { label: "Total em aberto", value: kpis.totalOpen, icon: Wallet, color: "text-pos-white" },
          { label: "Recebido no período", value: kpis.receivedPeriod, icon: CheckCircle2, color: "text-green-500" },
        ].map(k => (
          <div key={k.label} className="p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
            <div className="flex items-center gap-1.5 text-[10px] text-pos-white/50">
              <k.icon className={`h-3.5 w-3.5 ${k.color}`} /> {k.label}
            </div>
            <p className={`text-lg font-bold ${k.color}`}>{fmt(k.value)}</p>
          </div>
        ))}
      </div>

      {/* Resumo por gateway */}
      {byGateway.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {byGateway.map(([g, v]) => (
            <Badge key={g} className={`border-0 text-[11px] ${g === OWN_GATEWAY ? "bg-pos-orange/20 text-pos-orange" : "bg-pos-white/10 text-pos-white/70"}`}>
              {g}: {fmt(v.open)} ({v.count})
            </Badge>
          ))}
        </div>
      )}

      <Separator className="bg-pos-orange/20" />

      {/* Lista */}
      {loading ? (
        <div className="py-10 text-center text-pos-white/40"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : inRange.length === 0 ? (
        <p className="py-10 text-center text-sm text-pos-white/40">Nenhuma parcela a receber com vencimento no período</p>
      ) : (
        <div className="space-y-2">
          {inRange.map(i => {
            const late = daysLate(i.due_date);
            return (
              <div key={i.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm font-bold text-pos-white">
                    {i.customer_name || "Cliente —"}
                    <span className="ml-2 text-[11px] font-normal text-pos-white/50">{i.customer_phone || ""}</span>
                  </p>
                  <p className="text-[11px] text-pos-white/50">
                    Parcela {i.installment_number}/{i.installments_total} · Venc. {dateBR(i.due_date)} · {i.code || "sem código"} · {i.gateway || "sem gateway"}
                  </p>
                </div>
                {late > 0 && (
                  <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">{late}d de atraso</Badge>
                )}
                <div className="text-right">
                  <p className="text-sm font-bold text-pos-orange">{fmt(balanceOf(i))}</p>
                  {Number(i.paid_amount || 0) > 0 && (
                    <p className="text-[10px] text-green-500">pago {fmt(i.paid_amount)}</p>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-9 gap-1 border-green-500/30 bg-green-500/10 text-green-500 hover:bg-green-500/20"
                    onClick={() => openWhatsapp(i.customer_phone)}>
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </Button>
                  <Button size="sm" className="h-9 gap-1 bg-pos-orange text-pos-black hover:bg-pos-orange/80"
                    onClick={() => { setSelected(i); setPayAmount(balanceOf(i).toFixed(2)); }}>
                    <HandCoins className="h-4 w-4" /> Baixa
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recebidas no período */}
      {received.length > 0 && (
        <>
          <Separator className="bg-pos-orange/20" />
          <p className="text-xs font-bold text-pos-white/70">Recebidas no período ({received.length}) · {fmt(kpis.receivedPeriod)}</p>
          <div className="space-y-1">
            {received.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-pos-white/5 border border-green-500/10 text-[11px] text-pos-white/70">
                <span>{i.customer_name || "—"} · {i.installment_number}/{i.installments_total} · {i.code || "—"}</span>
                <span className="text-green-500 font-bold">
                  {fmt(i.paid_amount || i.amount)} · {i.paid_method || "—"} · {i.paid_at ? new Date(i.paid_at).toLocaleDateString("pt-BR") : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Dialog de baixa */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="bg-pos-black border-pos-orange/30 text-pos-white">
          <DialogHeader>
            <DialogTitle>Dar baixa na parcela</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-pos-white/5 border border-pos-orange/10 text-sm">
                <p className="font-bold">{selected.customer_name || "Cliente —"}</p>
                <p className="text-[11px] text-pos-white/50">
                  Parcela {selected.installment_number}/{selected.installments_total} · Venc. {dateBR(selected.due_date)} · {selected.code || "—"}
                </p>
                <p className="text-pos-orange font-bold mt-1">Saldo: {fmt(balanceOf(selected))}</p>
              </div>
              <div>
                <Label className="text-xs text-pos-white/60">Valor recebido</Label>
                <Input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                  className="h-12 text-lg bg-pos-white/5 border-pos-orange/20 text-pos-white" />
              </div>
              <div>
                <Label className="text-xs text-pos-white/60">Forma de pagamento</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-12 bg-pos-white/5 border-pos-orange/20 text-pos-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-pos-black border-pos-orange/30 text-pos-white">
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="cartao_debito">Cartão Débito</SelectItem>
                    <SelectItem value="cartao_credito">Cartão Crédito</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full h-12 text-base bg-pos-orange text-pos-black hover:bg-pos-orange/80 gap-2"
                onClick={receive} disabled={paying}>
                {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                Confirmar recebimento
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
