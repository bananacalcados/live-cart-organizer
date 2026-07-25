import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Printer, Package, Store, ChevronRight, Pencil } from "lucide-react";
import { ExpOrder, ExpStage, nextStage } from "./expeditionTypes";
import { ExpStockAdjustDialog, StockRow } from "./ExpStockAdjustDialog";


interface Props {
  orders: ExpOrder[];
  stage: ExpStage;
  onRefresh: () => void;
}

interface PickLine {
  key: string;
  product_name: string;
  variant_name: string | null;
  size: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  orders: { id: string; customer: string; qty: number; created_at: string }[];
}

const lineKey = (it: any) =>
  [
    (it.product_name || "").trim().toLowerCase(),
    (it.variant_name || "").trim().toLowerCase(),
    (it.size || "").trim().toLowerCase(),
  ].join("|");

/** Etapa SEPARAÇÃO: lista unificada de produtos a separar (não de pedidos). */
export function ExpPickingList({ orders, stage, onRefresh }: Props) {
  const [separated, setSeparated] = useState<Record<string, number>>({});
  const [stock, setStock] = useState<Record<string, StockRow[]>>({});
  const [qtyDialog, setQtyDialog] = useState<PickLine | null>(null);
  const [qtyInput, setQtyInput] = useState("");
  const [advancing, setAdvancing] = useState(false);
  const [adjustLine, setAdjustLine] = useState<PickLine | null>(null);


  const lines = useMemo(() => {
    const map = new Map<string, PickLine>();
    for (const o of orders) {
      for (const it of o.items) {
        const k = lineKey(it);
        const cur =
          map.get(k) ||
          ({
            key: k,
            product_name: it.product_name || "Produto",
            variant_name: it.variant_name,
            size: it.size,
            sku: it.sku,
            barcode: it.barcode,
            quantity: 0,
            orders: [],
          } as PickLine);
        cur.quantity += Number(it.quantity) || 0;
        cur.barcode = cur.barcode || it.barcode;
        cur.sku = cur.sku || it.sku;
        cur.orders.push({
          id: o.id,
          customer: o.customer_name || "Sem nome",
          qty: Number(it.quantity) || 0,
          created_at: o.created_at,
        });
        map.set(k, cur);
      }
    }
    return [...map.values()].sort((a, b) => a.product_name.localeCompare(b.product_name));
  }, [orders]);

  const loadStock = async () => {
    const barcodes = lines.map((l) => l.barcode).filter(Boolean) as string[];
    const skus = lines.map((l) => l.sku).filter(Boolean) as string[];
    if (!barcodes.length && !skus.length) return;
    try {
      const filters: string[] = [];
      if (barcodes.length) filters.push(`barcode.in.(${barcodes.map((b) => `"${b}"`).join(",")})`);
      if (skus.length) filters.push(`sku.in.(${skus.map((s) => `"${s}"`).join(",")})`);
      const { data } = await supabase
        .from("pos_products")
        .select("id, barcode, sku, stock, store_id, pos_stores!inner(name, is_simulation, is_active)")
        .or(filters.join(","))
        .eq("pos_stores.is_simulation", false)
        .eq("pos_stores.is_active", true)
        .limit(1000);
      const map: Record<string, StockRow[]> = {};
      for (const r of (data || []) as any[]) {
        const row: StockRow = {
          product_id: r.id,
          store_id: r.store_id,
          store: r.pos_stores?.name || "Loja",
          stock: Number(r.stock) || 0,
        };
        for (const k of [r.barcode, r.sku].filter(Boolean)) {
          const arr = map[k] || [];
          arr.push(row);
          map[k] = arr;
        }
      }
      setStock(map);
    } catch {
      /* best-effort */
    }
  };

  useEffect(() => {
    loadStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);


  /** Pedidos totalmente cobertos pelas quantidades já separadas. */
  const readyOrderIds = useMemo(() => {
    const remaining = { ...separated };
    const sorted = [...orders].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const ready: string[] = [];
    for (const o of sorted) {
      const need = new Map<string, number>();
      for (const it of o.items) need.set(lineKey(it), (need.get(lineKey(it)) || 0) + (Number(it.quantity) || 0));
      let ok = o.items.length > 0;
      for (const [k, q] of need) if ((remaining[k] || 0) < q) ok = false;
      if (ok) {
        for (const [k, q] of need) remaining[k] = (remaining[k] || 0) - q;
        ready.push(o.id);
      }
    }
    return ready;
  }, [orders, separated]);

  const toggleLine = (l: PickLine, checked: boolean) => {
    if (!checked) {
      setSeparated((p) => ({ ...p, [l.key]: 0 }));
      return;
    }
    if (l.quantity > 1) {
      setQtyInput(String(l.quantity));
      setQtyDialog(l);
      return;
    }
    setSeparated((p) => ({ ...p, [l.key]: l.quantity }));
  };

  const confirmQty = () => {
    if (!qtyDialog) return;
    const q = Math.max(0, Math.min(qtyDialog.quantity, Number(qtyInput) || 0));
    setSeparated((p) => ({ ...p, [qtyDialog.key]: q }));
    setQtyDialog(null);
  };

  const advanceReady = async () => {
    if (!readyOrderIds.length) return;
    const to = nextStage(stage);
    if (!to) return;
    setAdvancing(true);
    try {
      const { error } = await supabase.from("pos_sales").update({ expedition_stage: to }).in("id", readyOrderIds);
      if (error) throw error;
      toast.success(`${readyOrderIds.length} pedido(s) enviados para Conferência`);
      setSeparated({});
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || "Erro ao avançar pedidos separados");
    } finally {
      setAdvancing(false);
    }
  };

  const print = () => {
    const rows = lines
      .map(
        (l, i) => `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td><strong>${l.product_name}</strong><br/><span style="font-size:11px;color:#555">${[l.variant_name, l.size && `Tam ${l.size}`, l.sku]
          .filter(Boolean)
          .join(" • ")}</span></td>
        <td style="font-size:11px">${((l.barcode && stock[l.barcode]) || (l.sku && stock[l.sku]) || [])
          .map((s) => `${s.store}: ${s.stock}`)
          .join(" | ") || "—"}</td>
        <td style="text-align:center;font-size:18px;font-weight:bold">${l.quantity}</td>
        <td style="text-align:center">☐</td>
      </tr>`,
      )
      .join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Lista de separação</title><style>
      @page{margin:12mm}
      body{font-family:Arial,Helvetica,sans-serif;padding:16px}
      h1{font-size:20px;margin:0 0 4px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th{background:#1a1a1a;color:#f5c518;padding:8px;text-align:left;font-size:11px;text-transform:uppercase}
      td{padding:8px;border-bottom:1px solid #ddd;font-size:13px}
    </style></head><body>
      <h1>📦 LISTA DE SEPARAÇÃO</h1>
      <div style="font-size:12px;color:#555">${new Date().toLocaleString("pt-BR")} • ${lines.length} produto(s) • ${lines.reduce(
        (s, l) => s + l.quantity,
        0,
      )} peça(s)</div>
      <table><thead><tr><th style="width:32px">#</th><th>Produto</th><th>Estoque por loja</th><th style="width:60px">Qtd</th><th style="width:40px">✓</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </body></html>`);
    w.document.close();
    w.print();
  };

  const totalPieces = lines.reduce((s, l) => s + l.quantity, 0);
  const totalSeparated = Object.values(separated).reduce((s, n) => s + (n || 0), 0);

  if (!lines.length) {
    return (
      <div className="text-center py-20">
        <Package className="h-16 w-16 mx-auto text-pos-muted-text/40" />
        <p className="mt-3 text-xl font-bold text-pos-muted-text">Nenhum produto para separar</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-lg font-black text-pos-text">
          {lines.length} produto(s) • {totalPieces} peça(s)
        </span>
        <Badge className="bg-exp-pick text-white font-bold">{totalSeparated} separada(s)</Badge>
        <Button variant="outline" onClick={print} className="ml-auto font-bold">
          <Printer className="h-4 w-4 mr-1" /> Imprimir lista
        </Button>
        <Button
          className="bg-exp-pick hover:bg-exp-pick/90 text-white font-black"
          disabled={!readyOrderIds.length || advancing}
          onClick={advanceReady}
        >
          {advancing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
          AVANÇAR {readyOrderIds.length} PEDIDO(S) SEPARADO(S)
        </Button>
      </div>

      {lines.map((l) => {
        const done = separated[l.key] || 0;
        const locs = (l.barcode && stock[l.barcode]) || (l.sku && stock[l.sku]) || [];
        return (
          <div
            key={l.key}
            className={`rounded-xl bg-pos-card border-2 p-4 ${done >= l.quantity ? "border-exp-done" : "border-exp-pick/40"}`}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                className="mt-1 h-6 w-6"
                checked={done > 0}
                onCheckedChange={(v) => toggleLine(l, !!v)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xl font-black text-pos-text">{l.product_name}</p>
                <p className="text-base font-semibold text-pos-muted-text">
                  {[l.variant_name, l.size && `Tam ${l.size}`, l.sku, l.barcode].filter(Boolean).join(" • ")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {locs.length ? (
                    locs.map((s, i) => (
                      <Badge
                        key={`${s.store}-${i}`}
                        variant="outline"
                        className={`text-sm font-bold ${s.stock > 0 ? "border-exp-done text-exp-done" : "border-destructive text-destructive"}`}
                      >
                        <Store className="h-3 w-3 mr-1" /> {s.store}: {s.stock}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline" className="text-sm font-bold text-pos-muted-text">
                      Sem estoque localizado
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <p className="text-sm font-semibold text-pos-muted-text">{l.orders.length} pedido(s)</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 font-bold"
                    disabled={!locs.length}
                    onClick={() => setAdjustLine(l)}
                  >
                    <Pencil className="h-3 w-3 mr-1" /> Ajustar estoque
                  </Button>
                </div>



              </div>
              <div className="text-right shrink-0">
                <p className="text-3xl font-black text-pos-text">{l.quantity}</p>
                <p className="text-sm font-bold text-pos-muted-text">a separar</p>
                {done > 0 && (
                  <button
                    className="mt-1 text-sm font-bold text-exp-pick underline"
                    onClick={() => {
                      setQtyInput(String(done));
                      setQtyDialog(l);
                    }}
                  >
                    {done} separada(s)
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <Dialog open={!!qtyDialog} onOpenChange={(v) => !v && setQtyDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Quantidade separada</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-base font-semibold text-pos-muted-text">
              {qtyDialog?.product_name} — necessário {qtyDialog?.quantity}
            </p>
            <div>
              <Label>Quantas unidades você separou?</Label>
              <Input
                type="number"
                min={0}
                max={qtyDialog?.quantity}
                value={qtyInput}
                autoFocus
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmQty()}
                className="h-12 text-lg font-bold"
              />
            </div>
            <Button className="w-full h-12 font-black bg-exp-pick text-white" onClick={confirmQty}>
              CONFIRMAR
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ExpStockAdjustDialog
        open={!!adjustLine}
        onOpenChange={(v) => !v && setAdjustLine(null)}
        title={[adjustLine?.product_name, adjustLine?.variant_name, adjustLine?.size && `Tam ${adjustLine?.size}`]
          .filter(Boolean)
          .join(" • ")}
        rows={
          (adjustLine &&
            ((adjustLine.barcode && stock[adjustLine.barcode]) || (adjustLine.sku && stock[adjustLine.sku]) || [])) ||
          []
        }
        onDone={loadStock}
      />
    </div>

  );
}

export default ExpPickingList;
