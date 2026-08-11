import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, AlertTriangle } from "lucide-react";
import { CHANNEL_LABEL, type SoldChannel, toChannel } from "@/lib/pos/soldProductsData";

const BRL = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface DrilldownLine {
  saleId: string;
  sku: string | null;
  name: string;
  size: string | null;
  color: string | null;
  qty: number;
  unitPrice: number;
  revenue: number;
  cost: number;
  storeId: string | null;
  channel: SoldChannel;
}

interface SaleInfo {
  id: string;
  created_at: string;
  paid_at: string | null;
  status: string | null;
  sale_type: string | null;
  store_id: string | null;
  seller_id: string | null;
  customer_name: string | null;
  total: number | null;
  external_order_id: string | null;
  tiny_order_number: string | null;
  invoice_number: string | null;
  payment_method: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  lines: DrilldownLine[];
  stores: { id: string; name: string }[];
}

export function POSProductSalesDrilldown({ open, onOpenChange, title, lines, stores }: Props) {
  const [loading, setLoading] = useState(false);
  const [saleById, setSaleById] = useState<Map<string, SaleInfo>>(new Map());
  const [sellerNames, setSellerNames] = useState<Map<string, string>>(new Map());

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.name || "Loja desconhecida" : "Sem loja");

  useEffect(() => {
    if (!open || lines.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ids = Array.from(new Set(lines.map((l) => l.saleId)));
        const rows: SaleInfo[] = [];
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await supabase
            .from("pos_sales")
            .select("id, created_at, paid_at, status, sale_type, store_id, seller_id, customer_name, total, external_order_id, tiny_order_number, invoice_number, payment_method")
            .in("id", ids.slice(i, i + 200));
          rows.push(...((data || []) as any));
        }
        const m = new Map<string, SaleInfo>();
        for (const r of rows) m.set(r.id, r);

        const sellerIds = Array.from(new Set(rows.map((r) => r.seller_id).filter(Boolean))) as string[];
        const sm = new Map<string, string>();
        if (sellerIds.length > 0) {
          const { data: sellers } = await supabase.from("pos_sellers").select("id, name").in("id", sellerIds);
          for (const s of sellers || []) sm.set(s.id, s.name);
        }
        if (!cancelled) { setSaleById(m); setSellerNames(sm); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, lines]);

  const totals = useMemo(() => {
    const qty = lines.reduce((a, l) => a + l.qty, 0);
    const revenue = lines.reduce((a, l) => a + l.revenue, 0);
    const cost = lines.reduce((a, l) => a + l.cost, 0);
    const gross = lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
    return { qty, revenue, cost, gross, avg: qty > 0 ? revenue / qty : 0 };
  }, [lines]);

  /** preço unitário "de referência": o maior praticado no período */
  const refPrice = useMemo(() => lines.reduce((m, l) => Math.max(m, l.unitPrice), 0), [lines]);

  const sorted = useMemo(() => {
    return [...lines].sort((a, b) => {
      const sa = saleById.get(a.saleId);
      const sb = saleById.get(b.saleId);
      const ta = new Date(sa?.paid_at || sa?.created_at || 0).getTime();
      const tb = new Date(sb?.paid_at || sb?.created_at || 0).getTime();
      return tb - ta;
    });
  }, [lines, saleById]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Vendas · {title}</DialogTitle>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
            <span>{sorted.length} linhas · {totals.qty} un.</span>
            <span>Venda: <b className="text-emerald-300">{BRL(totals.revenue)}</b></span>
            <span>Bruto (preço × qtd): <b className="text-zinc-200">{BRL(totals.gross)}</b></span>
            <span>Custo: <b className="text-rose-300">{BRL(totals.cost)}</b></span>
            <span>Preço médio: <b className="text-zinc-200">{BRL(totals.avg)}</b></span>
            {refPrice > 0 && <span>Maior preço: <b className="text-zinc-200">{BRL(refPrice)}</b></span>}
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando vendas…
          </div>
        )}

        <ScrollArea className="h-[65vh] rounded border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-900 z-10 text-zinc-400 uppercase text-[10px]">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Pedido</th>
                <th className="text-left px-2 py-2 font-medium">Data</th>
                <th className="text-left px-2 py-2 font-medium">Cliente</th>
                <th className="text-left px-2 py-2 font-medium">Vendedor</th>
                <th className="text-left px-2 py-2 font-medium">Loja</th>
                <th className="text-left px-2 py-2 font-medium">Canal</th>
                <th className="text-left px-2 py-2 font-medium">Variação</th>
                <th className="text-right px-2 py-2 font-medium">Qtd</th>
                <th className="text-right px-2 py-2 font-medium">Preço un.</th>
                <th className="text-right px-2 py-2 font-medium">Venda item</th>
                <th className="text-right px-2 py-2 font-medium">Custo</th>
                <th className="text-right px-3 py-2 font-medium">Total pedido</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l, idx) => {
                const s = saleById.get(l.saleId);
                const below = refPrice > 0 && l.unitPrice > 0 && l.unitPrice < refPrice - 0.01;
                const orderRef = s?.external_order_id || s?.tiny_order_number || s?.invoice_number || `#${l.saleId.slice(0, 8)}`;
                return (
                  <tr key={`${l.saleId}-${idx}`} className={`border-t border-zinc-900 hover:bg-zinc-900/50 ${below ? "bg-amber-500/[0.06]" : ""}`}>
                    <td className="px-3 py-1.5 text-zinc-300 font-mono">{orderRef}</td>
                    <td className="px-2 py-1.5 text-zinc-400">
                      {s ? format(new Date(s.paid_at || s.created_at), "dd/MM/yy HH:mm", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-zinc-300 max-w-[160px] truncate">{s?.customer_name || "—"}</td>
                    <td className="px-2 py-1.5 text-zinc-300">{sellerNames.get(s?.seller_id || "") || "—"}</td>
                    <td className="px-2 py-1.5 text-zinc-400">{storeName(l.storeId)}</td>
                    <td className="px-2 py-1.5 text-zinc-400">{CHANNEL_LABEL[l.channel] || CHANNEL_LABEL[toChannel(s?.sale_type)]}</td>
                    <td className="px-2 py-1.5 text-zinc-400 max-w-[180px] truncate">
                      {[l.size ? `Tam ${l.size}` : null, l.color, l.sku].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-zinc-200">{l.qty}</td>
                    <td className={`px-2 py-1.5 text-right ${below ? "text-amber-300 font-medium" : "text-zinc-200"}`}>
                      {BRL(l.unitPrice)}
                      {below && <AlertTriangle className="inline h-3 w-3 ml-1" />}
                    </td>
                    <td className="px-2 py-1.5 text-right text-emerald-300">{BRL(l.revenue)}</td>
                    <td className="px-2 py-1.5 text-right text-rose-300">{BRL(l.cost)}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">
                      {BRL(Number(s?.total || 0))}
                      {s?.status && s.status !== "completed" && (
                        <Badge variant="outline" className="ml-1 text-[9px] border-zinc-700 text-zinc-400">{s.status}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
        <p className="text-[10px] text-zinc-500">
          Linhas destacadas em âmbar foram vendidas abaixo do maior preço praticado no período — útil para checar venda abaixo do preço.
        </p>
      </DialogContent>
    </Dialog>
  );
}
