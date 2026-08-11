import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Package, Search, Download } from "lucide-react";

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface SaleRef { id: string; total: number; shipping_cost: number }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sales: SaleRef[];
  periodLabel: string;
}

interface RawItem {
  sku: string | null;
  name: string;
  size: string | null;
  color: string | null;
  parentKey: string;
  parentName: string;
  qty: number;
  revenue: number;
  cost: number;
}

interface GroupRow {
  key: string;
  label: string;
  sub: string;
  qty: number;
  revenue: number;
  cost: number;
  curve: "A" | "B" | "C";
}

/** Remove sufixo de variação (cor/tamanho) do nome do filho para obter o nome do pai. */
function stripVariantSuffix(name: string, color?: string | null, size?: string | null): string {
  let out = (name || "").trim();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (size) out = out.replace(new RegExp(`[\\s\\-–,]*${esc(String(size))}\\s*$`, "i"), "").trim();
  if (color) out = out.replace(new RegExp(`[\\s\\-–,]*${esc(String(color))}\\s*$`, "i"), "").trim();
  // fallback genérico: " - Alguma Cor 37"
  out = out.replace(/\s*[-–]\s*[^-–]{0,25}?\s\d{2}(\.\d)?\s*$/i, "").trim();
  out = out.replace(/[\s\-–,]+$/, "").trim();
  return out || name;
}

export function POSSoldProductsModal({ open, onOpenChange, sales, periodLabel }: Props) {
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState<RawItem[]>([]);
  const [groupBy, setGroupBy] = useState<"variant" | "parent">("variant");
  const [curve, setCurve] = useState<"all" | "A" | "B" | "C">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"revenue" | "qty" | "markup" | "margin">("revenue");

  const shippingTotal = useMemo(() => sales.reduce((a, s) => a + Number(s.shipping_cost || 0), 0), [sales]);
  const salesTotal = useMemo(() => sales.reduce((a, s) => a + Number(s.total || 0), 0), [sales]);

  const [unattributed, setUnattributed] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (sales.length === 0) { setRaw([]); setUnattributed(0); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // FONTE ÚNICA — mesma função usada pelo Dashboard Geral
        const { items, unattributedRevenue } = await fetchSoldProductsData(sales);

        const parentSkus = Array.from(new Set(
          items.map((i) => i.product?.parent_sku).filter(Boolean)
        )) as string[];
        const parentNames = await fetchParentNames(parentSkus);

        const mapped: RawItem[] = items.map((it) => {
          const p = it.product;
          const childName = (p?.name || it.product_name || "Sem nome").trim();
          const size = (it.size || p?.size || null);
          const color = (p?.color || it.variant_name || null);
          const parentRaw = p?.parent_sku ? parentNames.get(p.parent_sku) : undefined;
          const parentName = parentRaw
            ? stripVariantSuffix(parentRaw.name, parentRaw.color, parentRaw.size)
            : stripVariantSuffix(childName, color, size);
          const parentKey = (p?.parent_sku || parentName).toString().trim().toUpperCase();
          return {
            sku: it.sku,
            name: childName,
            size,
            color,
            parentKey,
            parentName,
            qty: it.quantity,
            revenue: it.revenue,
            cost: it.cost,
          };
        });
        if (!cancelled) { setRaw(mapped); setUnattributed(unattributedRevenue); }
      } catch (e: any) {
        toast.error("Erro ao carregar produtos vendidos: " + e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, sales]);



  const rows: GroupRow[] = useMemo(() => {
    const map = new Map<string, { label: string; sub: string; qty: number; revenue: number; cost: number }>();
    for (const it of raw) {
      const key = groupBy === "parent"
        ? it.parentKey
        : `${it.sku || it.name}|${it.size || ""}|${it.color || ""}`;
      const label = groupBy === "parent" ? it.parentName : it.name;
      const sub = groupBy === "parent"
        ? (it.sku ? `Produto pai` : "")
        : [it.size ? `Tam ${it.size}` : null, it.color || null, it.sku || null].filter(Boolean).join(" · ");
      const cur = map.get(key) || { label, sub, qty: 0, revenue: 0, cost: 0 };
      cur.qty += it.qty; cur.revenue += it.revenue; cur.cost += it.cost;
      map.set(key, cur);
    }
    const list = Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
    list.sort((a, b) => b.revenue - a.revenue);
    const total = list.reduce((a, r) => a + r.revenue, 0);
    let acc = 0;
    return list.map((r) => {
      acc += r.revenue;
      const pct = total > 0 ? acc / total : 1;
      const c: "A" | "B" | "C" = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
      return { ...r, curve: c };
    });
  }, [raw, groupBy]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter(r =>
      (curve === "all" || r.curve === curve) &&
      (!q || r.label.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q))
    );
    const mk = (r: GroupRow) => (r.cost > 0 ? r.revenue / r.cost : 0);
    const mg = (r: GroupRow) => (r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0);
    out = [...out].sort((a, b) => {
      if (sortBy === "qty") return b.qty - a.qty;
      if (sortBy === "markup") return mk(b) - mk(a);
      if (sortBy === "margin") return mg(b) - mg(a);
      return b.revenue - a.revenue;
    });
    return out;
  }, [rows, curve, search, sortBy]);

  const totals = useMemo(() => {
    const revenue = filtered.reduce((a, r) => a + r.revenue, 0);
    const cost = filtered.reduce((a, r) => a + r.cost, 0);
    const qty = filtered.reduce((a, r) => a + r.qty, 0);
    return {
      revenue, cost, qty,
      markup: cost > 0 ? revenue / cost : 0,
      marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
    };
  }, [filtered]);

  const exportCsv = () => {
    const header = ["Produto", "Detalhe", "Curva", "Qtd", "Custo", "Venda", "Markup", "Margem %"];
    const lines = filtered.map(r => [
      r.label, r.sub, r.curve, r.qty,
      r.cost.toFixed(2), r.revenue.toFixed(2),
      (r.cost > 0 ? r.revenue / r.cost : 0).toFixed(2),
      (r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0).toFixed(1),
    ].join(";"));
    const blob = new Blob([[header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `produtos-vendidos-${periodLabel}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const curveColor = (c: string) =>
    c === "A" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : c === "B" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] p-0 flex flex-col bg-zinc-950 border-zinc-800">
        <DialogHeader className="px-5 py-3 border-b border-zinc-800">
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Package className="h-5 w-5 text-blue-400" />
            Produtos vendidos — {periodLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-3 border-b border-zinc-800 flex flex-wrap items-center gap-2">
          <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
            <SelectTrigger className="w-[220px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="variant">Variação (modelo/tam/cor)</SelectItem>
              <SelectItem value="parent">Produto pai (agrupado)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={curve} onValueChange={(v: any) => setCurve(v)}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Curva ABC: todas</SelectItem>
              <SelectItem value="A">Curva A (80%)</SelectItem>
              <SelectItem value="B">Curva B (15%)</SelectItem>
              <SelectItem value="C">Curva C (5%)</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="revenue">Ordenar: faturamento</SelectItem>
              <SelectItem value="qty">Ordenar: quantidade</SelectItem>
              <SelectItem value="markup">Ordenar: markup</SelectItem>
              <SelectItem value="margin">Ordenar: margem</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto, cor, tamanho ou SKU…" className="pl-8 h-9" />
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>

        <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-6 gap-3 border-b border-zinc-800">
          {[
            { l: "Itens vendidos", v: totals.qty.toString() },
            { l: "Custo total", v: BRL(totals.cost) },
            { l: "Venda de produtos", v: BRL(totals.revenue) },
            { l: "Frete cobrado", v: BRL(shippingTotal) },
            { l: "Markup médio", v: `${totals.markup.toFixed(2)}x` },
            { l: "Margem de contribuição", v: `${totals.marginPct.toFixed(1)}%` },
          ].map((k) => (
            <div key={k.l} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k.l}</div>
              <div className="text-lg font-bold text-zinc-100">{k.v}</div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-2 text-[11px] text-zinc-500">
          Venda de produtos = total pago das vendas menos frete, rateado por item (já considera descontos).
          Faturamento do período: <span className="text-zinc-300 font-medium">{BRL(salesTotal)}</span> (produtos + frete).
        </div>


        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando itens…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-zinc-500">Nenhum produto vendido no período.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-900 z-10">
                <tr className="text-zinc-400 text-xs uppercase">
                  <th className="text-left px-5 py-2 font-medium">Produto</th>
                  <th className="text-center px-3 py-2 font-medium">Curva</th>
                  <th className="text-right px-3 py-2 font-medium">Qtd</th>
                  <th className="text-right px-3 py-2 font-medium">Custo</th>
                  <th className="text-right px-3 py-2 font-medium">Venda</th>
                  <th className="text-right px-3 py-2 font-medium">Markup</th>
                  <th className="text-right px-5 py-2 font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const markup = r.cost > 0 ? r.revenue / r.cost : 0;
                  const margin = r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0;
                  return (
                    <tr key={r.key} className="border-t border-zinc-900 hover:bg-zinc-900/50">
                      <td className="px-5 py-2">
                        <div className="text-zinc-100 font-medium">{r.label}</div>
                        {r.sub && <div className="text-xs text-zinc-500">{r.sub}</div>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className={curveColor(r.curve)}>{r.curve}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-200">{r.qty}</td>
                      <td className="px-3 py-2 text-right text-rose-300">{BRL(r.cost)}</td>
                      <td className="px-3 py-2 text-right text-emerald-300">{BRL(r.revenue)}</td>
                      <td className="px-3 py-2 text-right text-fuchsia-300">{markup > 0 ? `${markup.toFixed(2)}x` : "—"}</td>
                      <td className="px-5 py-2 text-right text-cyan-300">{margin.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
