import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SaleRow {
  id: string;
  store_id: string;
  total: number;
  payment_method: string | null;
  created_at: string;
  paid_at?: string | null;
  sale_type?: string;
  status?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  tiny_order_number?: string | null;
  crediario_gateway?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  bucketName: string;
  sales: SaleRow[];
  storesById: Map<string, string>;
  onUpdated?: () => void;
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const NO_GATEWAY = "__none__";

const PAYMENT_OPTIONS = [
  "PIX",
  "Dinheiro",
  "Cartão de crédito",
  "Cartão de débito",
  "Crediário",
  "Vale Presente",
  "VPS",
  "Cheque",
  "Boleto",
  "Checkout Online",
];

export function POSPaymentSalesModal({ open, onClose, title, bucketName, sales, storesById, onUpdated }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [gatewayFilter, setGatewayFilter] = useState<string>("all");

  const isCrediario = bucketName === "Crediário";

  // Aggregate per gateway (only when bucket = Crediário)
  const byGateway = useMemo(() => {
    if (!isCrediario) return [];
    const map = new Map<string, { qty: number; revenue: number }>();
    for (const s of sales) {
      const key = s.crediario_gateway || "(sem gateway)";
      const cur = map.get(key) || { qty: 0, revenue: 0 };
      cur.qty += 1;
      cur.revenue += Number(s.total || 0);
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [isCrediario, sales]);

  const filteredSales = useMemo(() => {
    if (!isCrediario || gatewayFilter === "all") return sales;
    if (gatewayFilter === NO_GATEWAY) return sales.filter(s => !s.crediario_gateway);
    return sales.filter(s => s.crediario_gateway === gatewayFilter);
  }, [isCrediario, gatewayFilter, sales]);

  const total = filteredSales.reduce((a, s) => a + Number(s.total || 0), 0);
  const byStore = new Map<string, { qty: number; revenue: number }>();
  for (const s of filteredSales) {
    const cur = byStore.get(s.store_id) || { qty: 0, revenue: 0 };
    cur.qty += 1;
    cur.revenue += Number(s.total || 0);
    byStore.set(s.store_id, cur);
  }

  const startEdit = (s: SaleRow) => {
    setEditingId(s.id);
    setEditValue(s.payment_method || "");
  };
  const cancelEdit = () => { setEditingId(null); setEditValue(""); };
  const saveEdit = async (id: string) => {
    if (!editValue) { toast.error("Selecione uma forma de pagamento"); return; }
    setSaving(true);
    const { error } = await supabase.from("pos_sales").update({ payment_method: editValue } as any).eq("id", id);
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Forma de pagamento atualizada");
    cancelEdit();
    onUpdated?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">{title}</DialogTitle>
          <p className="text-xs text-zinc-400">{filteredSales.length} vendas · {BRL(total)}</p>
        </DialogHeader>

        <div className="space-y-3">
          {isCrediario && byGateway.length > 0 && (
            <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Soma por gateway</p>
                <Select value={gatewayFilter} onValueChange={setGatewayFilter}>
                  <SelectTrigger className="h-7 text-xs w-[200px] bg-zinc-900 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                    <SelectItem value="all">Todos os gateways</SelectItem>
                    {byGateway.map(g => (
                      <SelectItem key={g.name} value={g.name === "(sem gateway)" ? NO_GATEWAY : g.name}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                {byGateway.map(g => (
                  <button
                    key={g.name}
                    onClick={() => setGatewayFilter(g.name === "(sem gateway)" ? NO_GATEWAY : g.name)}
                    className="text-left rounded-md border border-amber-500/30 bg-zinc-900/60 px-3 py-1.5 hover:border-amber-400 transition-colors"
                  >
                    <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">{g.name}</p>
                    <p className="text-sm font-bold text-amber-300">{BRL(g.revenue)}</p>
                    <p className="text-[10px] text-zinc-500">{g.qty} vendas</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {Array.from(byStore.entries()).map(([sid, v]) => (
              <Badge key={sid} variant="outline" className="border-zinc-700 text-zinc-300 bg-zinc-900">
                {storesById.get(sid) || "?"} · {v.qty} · {BRL(v.revenue)}
              </Badge>
            ))}
          </div>

          <ScrollArea className="h-[55vh] rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">Data</th>
                  <th className="text-left p-2 font-medium">Pedido</th>
                  <th className="text-left p-2 font-medium">Loja</th>
                  <th className="text-left p-2 font-medium">Cliente</th>
                  <th className="text-left p-2 font-medium">Pagamento</th>
                  {isCrediario && <th className="text-left p-2 font-medium">Gateway</th>}
                  <th className="text-left p-2 font-medium">Tipo</th>
                  <th className="text-right p-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.length === 0 && (
                  <tr><td colSpan={isCrediario ? 8 : 7} className="text-center p-4 text-zinc-500">Sem vendas em "{bucketName}"</td></tr>
                )}
                {filteredSales
                  .slice()
                  .sort((a, b) => new Date(b.paid_at || b.created_at).getTime() - new Date(a.paid_at || a.created_at).getTime())
                  .map((s) => {
                    const isEditing = editingId === s.id;
                    return (
                      <tr key={s.id} className="border-t border-zinc-800/60 hover:bg-zinc-900/60">
                        <td className="p-2 whitespace-nowrap text-zinc-300">
                          {format(new Date(s.paid_at || s.created_at), "dd/MM HH:mm")}
                        </td>
                        <td className="p-2 text-zinc-300 font-mono">
                          {s.tiny_order_number ? `#${s.tiny_order_number}` : `#${s.id.slice(0, 8)}`}
                        </td>
                        <td className="p-2 text-zinc-300">{storesById.get(s.store_id) || "?"}</td>
                        <td className="p-2 text-zinc-300 truncate max-w-[180px]">
                          {s.customer_name || <span className="italic text-zinc-500">—</span>}
                        </td>
                        <td className="p-2 text-zinc-400 max-w-[260px]">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <Select value={editValue} onValueChange={setEditValue}>
                                <SelectTrigger className="h-7 text-xs bg-zinc-900 border-zinc-700 w-[160px]">
                                  <SelectValue placeholder="Selecionar..." />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-zinc-700 text-zinc-100">
                                  {PAYMENT_OPTIONS.map(p => (
                                    <SelectItem key={p} value={p}>{p}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400" disabled={saving} onClick={() => saveEdit(s.id)}>
                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-400" onClick={cancelEdit}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="truncate">
                                {s.payment_method || <span className="italic text-zinc-500">(sem método)</span>}
                              </span>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-zinc-500 hover:text-amber-400" onClick={() => startEdit(s)} title="Editar forma de pagamento">
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                        {isCrediario && (
                          <td className="p-2 text-amber-300">
                            {s.crediario_gateway || <span className="italic text-zinc-500">—</span>}
                          </td>
                        )}
                        <td className="p-2 text-zinc-400">{s.sale_type || "—"}</td>
                        <td className="p-2 text-right font-semibold text-emerald-400 whitespace-nowrap">{BRL(Number(s.total || 0))}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
