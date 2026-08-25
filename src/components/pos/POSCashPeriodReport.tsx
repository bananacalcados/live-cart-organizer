import { useState, useEffect, useMemo } from "react";
import { Calendar, Loader2, Printer, Download, DollarSign, ArrowUp, ArrowDown, Receipt, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  storeId: string;
  storeName?: string;
}

interface RegisterRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  expected_balance: number | null;
  difference: number | null;
  cash_sales: number | null;
  card_sales: number | null;
  pix_sales: number | null;
  other_sales: number | null;
  withdrawals: number | null;
  deposits: number | null;
  status: string | null;
  seller_id: string | null;
  notes: string | null;
}

interface MovementRow {
  id: string;
  cash_register_id: string | null;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
  seller_id: string | null;
}

interface ReceiptRow {
  id: string;
  cash_register_id: string | null;
  payment_method: string;
  amount: number;
  receipt_image_url: string;
  notes: string | null;
  created_at: string;
}

const fmt = (n: number | null | undefined) => `R$ ${Number(n || 0).toFixed(2)}`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR") : "—");

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

const methodLabel = (m: string) => {
  switch (m) {
    case "cartao_credito": return "Cartão Crédito";
    case "cartao_debito": return "Cartão Débito";
    case "pix": return "PIX";
    default: return m;
  }
};

export function POSCashPeriodReport({ storeId, storeName }: Props) {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [registers, setRegisters] = useState<RegisterRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [sellers, setSellers] = useState<Record<string, string>>({});
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const rangeIso = () => {
    const start = new Date(`${from}T00:00:00`).toISOString();
    const end = new Date(`${to}T23:59:59.999`).toISOString();
    return { start, end };
  };

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { start, end } = rangeIso();

      const [regRes, movRes, recRes, sellerRes] = await Promise.all([
        supabase
          .from("pos_cash_registers")
          .select("id, opened_at, closed_at, opening_balance, closing_balance, expected_balance, difference, cash_sales, card_sales, pix_sales, other_sales, withdrawals, deposits, status, seller_id, notes")
          .eq("store_id", storeId)
          .gte("opened_at", start)
          .lte("opened_at", end)
          .order("opened_at", { ascending: false }),
        (supabase as any)
          .from("pos_cash_movements")
          .select("id, cash_register_id, type, amount, description, created_at, seller_id")
          .eq("store_id", storeId)
          .gte("created_at", start)
          .lte("created_at", end)
          .order("created_at", { ascending: false }),
        supabase
          .from("pos_payment_receipts")
          .select("id, cash_register_id, payment_method, amount, receipt_image_url, notes, created_at")
          .eq("store_id", storeId)
          .gte("created_at", start)
          .lte("created_at", end)
          .order("created_at", { ascending: false }),
        (supabase as any).from("pos_sellers").select("id, name"),
      ]);

      if (regRes.error) throw regRes.error;
      setRegisters((regRes.data as RegisterRow[]) || []);
      setMovements(((movRes as any).data as MovementRow[]) || []);
      setReceipts((recRes.data as ReceiptRow[]) || []);
      const map: Record<string, string> = {};
      for (const s of ((sellerRes as any).data || []) as any[]) map[s.id] = s.name;
      setSellers(map);
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao carregar relatório do período");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [storeId]);

  const totals = useMemo(() => {
    const t = {
      registers: registers.length,
      closed: registers.filter(r => r.status === "closed").length,
      open: registers.filter(r => r.status !== "closed").length,
      opening: 0, cash: 0, card: 0, pix: 0, other: 0,
      withdrawals: 0, deposits: 0, difference: 0,
    };
    for (const r of registers) {
      t.opening += Number(r.opening_balance || 0);
      t.cash += Number(r.cash_sales || 0);
      t.card += Number(r.card_sales || 0);
      t.pix += Number(r.pix_sales || 0);
      t.other += Number(r.other_sales || 0);
      t.withdrawals += Number(r.withdrawals || 0);
      t.deposits += Number(r.deposits || 0);
      if (r.status === "closed") t.difference += Number(r.difference || 0);
    }
    return { ...t, revenue: t.cash + t.card + t.pix + t.other };
  }, [registers]);

  const receiptTotals = useMemo(() => {
    return receipts.reduce((acc, r) => {
      acc[r.payment_method] = (acc[r.payment_method] || 0) + Number(r.amount || 0);
      return acc;
    }, {} as Record<string, number>);
  }, [receipts]);

  const movementsByRegister = (id: string) => movements.filter(m => m.cash_register_id === id);

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(["RELATÓRIO DE CAIXA POR PERÍODO"]);
    rows.push(["Loja", storeName || storeId]);
    rows.push(["Período", `${from} a ${to}`]);
    rows.push([]);
    rows.push(["CONSOLIDADO"]);
    rows.push(["Caixas no período", String(totals.registers)]);
    rows.push(["Fechados", String(totals.closed)]);
    rows.push(["Em aberto", String(totals.open)]);
    rows.push(["Vendas dinheiro", totals.cash.toFixed(2)]);
    rows.push(["Vendas cartão", totals.card.toFixed(2)]);
    rows.push(["Vendas PIX", totals.pix.toFixed(2)]);
    rows.push(["Outros", totals.other.toFixed(2)]);
    rows.push(["Faturamento total", totals.revenue.toFixed(2)]);
    rows.push(["Sangrias", totals.withdrawals.toFixed(2)]);
    rows.push(["Reforços", totals.deposits.toFixed(2)]);
    rows.push(["Diferença de conferência (fechados)", totals.difference.toFixed(2)]);
    rows.push([]);
    rows.push(["CAIXAS"]);
    rows.push(["Abertura", "Fechamento", "Vendedora", "Status", "Troco", "Dinheiro", "Cartão", "PIX", "Outros", "Sangrias", "Reforços", "Esperado", "Contado", "Diferença"]);
    for (const r of registers) {
      rows.push([
        dt(r.opened_at), dt(r.closed_at), r.seller_id ? (sellers[r.seller_id] || "—") : "—",
        r.status === "closed" ? "Fechado" : "Aberto",
        Number(r.opening_balance || 0).toFixed(2),
        Number(r.cash_sales || 0).toFixed(2),
        Number(r.card_sales || 0).toFixed(2),
        Number(r.pix_sales || 0).toFixed(2),
        Number(r.other_sales || 0).toFixed(2),
        Number(r.withdrawals || 0).toFixed(2),
        Number(r.deposits || 0).toFixed(2),
        Number(r.expected_balance || 0).toFixed(2),
        Number(r.closing_balance || 0).toFixed(2),
        Number(r.difference || 0).toFixed(2),
      ]);
    }
    rows.push([]);
    rows.push(["SANGRIAS E REFORÇOS"]);
    rows.push(["Data/Hora", "Tipo", "Valor", "Descrição", "Vendedora"]);
    for (const m of movements) {
      rows.push([
        dt(m.created_at),
        m.type === "withdraw" ? "Sangria" : "Reforço",
        Number(m.amount || 0).toFixed(2),
        m.description || "",
        m.seller_id ? (sellers[m.seller_id] || "—") : "—",
      ]);
    }
    rows.push([]);
    rows.push(["COMPROVANTES ELETRÔNICOS"]);
    rows.push(["Data/Hora", "Método", "Valor", "Observação", "Link"]);
    for (const r of receipts) {
      rows.push([dt(r.created_at), methodLabel(r.payment_method), Number(r.amount || 0).toFixed(2), r.notes || "", r.receipt_image_url]);
    }

    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caixa_${from}_a_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório de Caixa — Período</title>
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
.total-row{border-top:2px solid #000;font-weight:bold;}
.red{color:#b00;}.green{color:#080;}
</style></head><body>
<h1>Relatório de Caixa — Período</h1>
<div class="muted">Loja: ${storeName || "-"}<br/>Período: ${new Date(`${from}T12:00:00`).toLocaleDateString("pt-BR")} a ${new Date(`${to}T12:00:00`).toLocaleDateString("pt-BR")}<br/>Emitido em: ${new Date().toLocaleString("pt-BR")}</div>

<div class="box">
  <h2 style="border:0;margin-top:0;">CONSOLIDADO DO PERÍODO</h2>
  <div class="row"><span>Caixas no período</span><span>${totals.registers} (${totals.closed} fechados / ${totals.open} em aberto)</span></div>
  <div class="row"><span>Vendas em dinheiro</span><span>${fmt(totals.cash)}</span></div>
  <div class="row"><span>Vendas em cartão</span><span>${fmt(totals.card)}</span></div>
  <div class="row"><span>Vendas em PIX</span><span>${fmt(totals.pix)}</span></div>
  <div class="row"><span>Outros</span><span>${fmt(totals.other)}</span></div>
  <div class="row"><span class="red">Sangrias</span><span class="red">- ${fmt(totals.withdrawals)}</span></div>
  <div class="row"><span class="green">Reforços</span><span class="green">+ ${fmt(totals.deposits)}</span></div>
  <div class="row total-row"><span>FATURAMENTO TOTAL</span><span>${fmt(totals.revenue)}</span></div>
  <div class="row"><span>Diferença de conferência (caixas fechados)</span><span>${fmt(totals.difference)}</span></div>
</div>

<h2>Caixas do período</h2>
<table><thead><tr><th>Abertura</th><th>Fechamento</th><th>Vendedora</th><th>Status</th><th class="right">Dinheiro</th><th class="right">Cartão</th><th class="right">PIX</th><th class="right">Sangrias</th><th class="right">Reforços</th><th class="right">Diferença</th></tr></thead><tbody>
${registers.map(r => `<tr><td>${dt(r.opened_at)}</td><td>${dt(r.closed_at)}</td><td>${r.seller_id ? (sellers[r.seller_id] || "—") : "—"}</td><td>${r.status === "closed" ? "Fechado" : "Aberto"}</td><td class="right">${fmt(r.cash_sales)}</td><td class="right">${fmt(r.card_sales)}</td><td class="right">${fmt(r.pix_sales)}</td><td class="right red">${fmt(r.withdrawals)}</td><td class="right green">${fmt(r.deposits)}</td><td class="right">${r.status === "closed" ? fmt(r.difference) : "—"}</td></tr>`).join("")}
</tbody></table>

${movements.length ? `<h2>Sangrias e Reforços</h2>
<table><thead><tr><th>Data/Hora</th><th>Tipo</th><th>Descrição</th><th class="right">Valor</th></tr></thead><tbody>
${movements.map(m => `<tr><td>${dt(m.created_at)}</td><td>${m.type === "withdraw" ? "Sangria" : "Reforço"}</td><td>${m.description || "-"}</td><td class="right ${m.type === "withdraw" ? "red" : "green"}">${m.type === "withdraw" ? "-" : "+"} ${fmt(Number(m.amount))}</td></tr>`).join("")}
<tr class="total-row"><td colspan="3">Totais</td><td class="right">- ${fmt(totals.withdrawals)} / + ${fmt(totals.deposits)}</td></tr>
</tbody></table>` : ""}

${receipts.length ? `<h2>Comprovantes eletrônicos (${receipts.length})</h2>
<table><thead><tr><th>Data/Hora</th><th>Método</th><th>Observação</th><th class="right">Valor</th></tr></thead><tbody>
${receipts.map(r => `<tr><td>${dt(r.created_at)}</td><td>${methodLabel(r.payment_method)}</td><td>${r.notes || "-"}</td><td class="right">${fmt(Number(r.amount))}</td></tr>`).join("")}
<tr class="total-row"><td colspan="3">Total anexado</td><td class="right">${fmt(receipts.reduce((s, r) => s + Number(r.amount || 0), 0))}</td></tr>
</tbody></table>` : ""}

<div class="muted" style="margin-top:30px;">_______________________________<br/>Assinatura do responsável</div>
<script>window.onload=()=>{window.print();};</script>
</body></html>`;

    const w = window.open("", "_blank", "width=1000,height=700");
    if (!w) { toast.error("Habilite popups para imprimir"); return; }
    w.document.write(html);
    w.document.close();
  };

  const setPreset = (kind: "month" | "lastMonth" | "7d" | "30d") => {
    const now = new Date();
    if (kind === "month") { setFrom(firstDayOfMonth()); setTo(today()); }
    if (kind === "lastMonth") {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      setFrom(s.toISOString().slice(0, 10));
      setTo(e.toISOString().slice(0, 10));
    }
    if (kind === "7d" || kind === "30d") {
      const days = kind === "7d" ? 6 : 29;
      const s = new Date(now.getTime() - days * 86400000);
      setFrom(s.toISOString().slice(0, 10));
      setTo(today());
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
        <div className="space-y-1">
          <Label className="text-[10px] text-pos-white/50 uppercase tracking-wider">De</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 bg-pos-black border-pos-orange/30 text-pos-white" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-pos-white/50 uppercase tracking-wider">Até</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 bg-pos-black border-pos-orange/30 text-pos-white" />
        </div>
        <Button onClick={load} disabled={loading} className="h-9 gap-2 bg-pos-orange text-pos-black hover:bg-pos-orange-muted font-bold">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />} Buscar
        </Button>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-9 border-pos-orange/30 text-pos-white/70" onClick={() => setPreset("month")}>Este mês</Button>
          <Button size="sm" variant="outline" className="h-9 border-pos-orange/30 text-pos-white/70" onClick={() => setPreset("lastMonth")}>Mês passado</Button>
          <Button size="sm" variant="outline" className="h-9 border-pos-orange/30 text-pos-white/70" onClick={() => setPreset("7d")}>7 dias</Button>
          <Button size="sm" variant="outline" className="h-9 border-pos-orange/30 text-pos-white/70" onClick={() => setPreset("30d")}>30 dias</Button>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2">
          <Button variant="outline" className="h-9 gap-2 border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" onClick={printReport}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
          <Button variant="outline" className="h-9 gap-2 border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20" onClick={exportCsv}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {/* Consolidated */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-pos-white/5 border-pos-orange/30">
          <CardContent className="p-4">
            <p className="text-xs text-pos-white/50">Faturamento do período</p>
            <p className="text-lg font-bold text-pos-orange">{fmt(totals.revenue)}</p>
            <p className="text-[10px] text-pos-white/40 mt-1">{totals.registers} caixa(s) · {totals.closed} fechado(s)</p>
          </CardContent>
        </Card>
        <Card className="bg-pos-white/5 border-green-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-pos-white/50">💵 Dinheiro</p>
            <p className="text-lg font-bold text-green-400">{fmt(totals.cash)}</p>
            <p className="text-[10px] text-pos-white/40 mt-1">Troco inicial somado: {fmt(totals.opening)}</p>
          </CardContent>
        </Card>
        <Card className="bg-pos-white/5 border-blue-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-pos-white/50">💳 Cartão / 📱 PIX</p>
            <p className="text-lg font-bold text-pos-white">{fmt(totals.card)} <span className="text-pos-white/40 text-sm">/</span> {fmt(totals.pix)}</p>
            <p className="text-[10px] text-pos-white/40 mt-1">Outros: {fmt(totals.other)}</p>
          </CardContent>
        </Card>
        <Card className="bg-pos-white/5 border-red-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-pos-white/50">Sangrias / Reforços</p>
            <p className="text-lg font-bold">
              <span className="text-red-400">-{totals.withdrawals.toFixed(2)}</span>
              <span className="text-pos-white/40"> / </span>
              <span className="text-green-400">+{totals.deposits.toFixed(2)}</span>
            </p>
            <p className="text-[10px] text-pos-white/40 mt-1">Diferença conferida: {fmt(totals.difference)}</p>
          </CardContent>
        </Card>
      </div>

      <Separator className="bg-pos-orange/20" />

      <Tabs defaultValue="registers" className="space-y-3">
        <TabsList className="bg-pos-white/5 border border-pos-orange/20">
          <TabsTrigger value="registers" className="data-[state=active]:bg-pos-orange data-[state=active]:text-pos-black text-pos-white/70 gap-1.5">
            <DollarSign className="h-4 w-4" /> Caixas ({registers.length})
          </TabsTrigger>
          <TabsTrigger value="movements" className="data-[state=active]:bg-pos-orange data-[state=active]:text-pos-black text-pos-white/70 gap-1.5">
            <ArrowUp className="h-4 w-4" /> Sangrias/Reforços ({movements.length})
          </TabsTrigger>
          <TabsTrigger value="receipts" className="data-[state=active]:bg-pos-orange data-[state=active]:text-pos-black text-pos-white/70 gap-1.5">
            <Receipt className="h-4 w-4" /> Comprovantes ({receipts.length})
          </TabsTrigger>
        </TabsList>

        {/* Caixas */}
        <TabsContent value="registers" className="space-y-2">
          {loading ? (
            <div className="py-10 text-center text-pos-white/40"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : registers.length === 0 ? (
            <p className="py-10 text-center text-sm text-pos-white/40">Nenhum caixa no período selecionado</p>
          ) : registers.map(r => {
            const movs = movementsByRegister(r.id);
            return (
              <div key={r.id} className="p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-bold text-pos-white">
                      {new Date(r.opened_at).toLocaleDateString("pt-BR")} · {new Date(r.opened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      {r.closed_at && ` → ${new Date(r.closed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                    </p>
                    <p className="text-[10px] text-pos-white/40">
                      {r.seller_id ? (sellers[r.seller_id] || "Vendedora —") : "Sem vendedora"}
                      {r.notes && ` · ${r.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === "closed" ? (
                      <Badge className="bg-pos-white/10 text-pos-white/70 border-0 text-[10px]">Fechado</Badge>
                    ) : (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">Aberto</Badge>
                    )}
                    {r.status === "closed" && (
                      <Badge className={`text-[10px] border-0 ${Math.abs(Number(r.difference || 0)) < 0.01 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        Dif. {fmt(r.difference)}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
                  {[
                    ["Troco", fmt(r.opening_balance)],
                    ["Dinheiro", fmt(r.cash_sales)],
                    ["Cartão", fmt(r.card_sales)],
                    ["PIX", fmt(r.pix_sales)],
                    ["Esperado", fmt(r.expected_balance)],
                    ["Contado", r.status === "closed" ? fmt(r.closing_balance) : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="p-2 rounded-lg bg-pos-black/40">
                      <p className="text-[9px] text-pos-white/40">{label}</p>
                      <p className="text-xs font-bold text-pos-white">{value}</p>
                    </div>
                  ))}
                </div>
                {movs.length > 0 && (
                  <div className="text-[10px] text-pos-white/50 space-y-0.5 pt-1 border-t border-pos-orange/10">
                    {movs.map(m => (
                      <div key={m.id} className="flex justify-between">
                        <span>{m.type === "withdraw" ? "🔻 Sangria" : "🔺 Reforço"} · {m.description || "—"}</span>
                        <span className={m.type === "withdraw" ? "text-red-400" : "text-green-400"}>
                          {m.type === "withdraw" ? "-" : "+"} {fmt(Number(m.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </TabsContent>

        {/* Movimentações */}
        <TabsContent value="movements" className="space-y-2">
          {movements.length === 0 ? (
            <p className="py-10 text-center text-sm text-pos-white/40">Nenhuma sangria ou reforço no período</p>
          ) : movements.map(m => (
            <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
              {m.type === "withdraw"
                ? <ArrowUp className="h-4 w-4 text-red-400 flex-shrink-0" />
                : <ArrowDown className="h-4 w-4 text-green-400 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-pos-white">{m.type === "withdraw" ? "Sangria" : "Reforço"} · {m.description || "Sem descrição"}</p>
                <p className="text-[10px] text-pos-white/40">
                  {dt(m.created_at)}
                  {m.seller_id && ` · ${sellers[m.seller_id] || "—"}`}
                </p>
              </div>
              <span className={`text-sm font-bold ${m.type === "withdraw" ? "text-red-400" : "text-green-400"}`}>
                {m.type === "withdraw" ? "-" : "+"} {fmt(Number(m.amount))}
              </span>
            </div>
          ))}
        </TabsContent>

        {/* Comprovantes */}
        <TabsContent value="receipts" className="space-y-2">
          <div className="grid grid-cols-3 gap-3">
            {["cartao_credito", "cartao_debito", "pix"].map(k => (
              <Card key={k} className="bg-pos-white/5 border-pos-orange/10">
                <CardContent className="p-3 text-center">
                  <p className="text-[10px] text-pos-white/40 mb-1">{methodLabel(k)}</p>
                  <p className="text-sm font-bold text-pos-white">{fmt(receiptTotals[k] || 0)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          {receipts.length === 0 ? (
            <p className="py-10 text-center text-sm text-pos-white/40">Nenhum comprovante no período</p>
          ) : receipts.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl bg-pos-white/5 border border-pos-orange/10">
              <button onClick={() => setPreviewImage(r.receipt_image_url)} className="h-12 w-12 rounded-lg overflow-hidden bg-pos-white/10 flex-shrink-0 hover:ring-2 ring-pos-orange transition-all">
                <img src={r.receipt_image_url} alt={`Comprovante ${methodLabel(r.payment_method)}`} className="h-full w-full object-cover" loading="lazy" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge className="text-[9px] border-0 bg-pos-white/10 text-pos-white/70">{methodLabel(r.payment_method)}</Badge>
                  <span className="text-xs font-bold text-pos-orange">{fmt(Number(r.amount))}</span>
                </div>
                <p className="text-[10px] text-pos-white/40">{dt(r.created_at)}{r.notes && ` · ${r.notes}`}</p>
              </div>
              <ImageIcon className="h-4 w-4 text-pos-white/20" />
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="bg-pos-black border-pos-orange/30 max-w-3xl">
          {previewImage && <img src={previewImage} alt="Comprovante ampliado" className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
