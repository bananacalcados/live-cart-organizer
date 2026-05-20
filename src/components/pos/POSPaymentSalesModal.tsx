import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface SaleRow {
  id: string;
  store_id: string;
  total: number;
  payment_method: string | null;
  created_at: string;
  paid_at?: string | null;
  sale_type?: string;
  status?: string;
  customer_name?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  bucketName: string;
  sales: SaleRow[];
  storesById: Map<string, string>;
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function POSPaymentSalesModal({ open, onClose, title, bucketName, sales, storesById }: Props) {
  const total = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const byStore = new Map<string, { qty: number; revenue: number }>();
  for (const s of sales) {
    const cur = byStore.get(s.store_id) || { qty: 0, revenue: 0 };
    cur.qty += 1;
    cur.revenue += Number(s.total || 0);
    byStore.set(s.store_id, cur);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">{title}</DialogTitle>
          <p className="text-xs text-zinc-400">{sales.length} vendas · {BRL(total)}</p>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Array.from(byStore.entries()).map(([sid, v]) => (
              <Badge key={sid} variant="outline" className="border-zinc-700 text-zinc-300 bg-zinc-900">
                {storesById.get(sid) || "?"} · {v.qty} · {BRL(v.revenue)}
              </Badge>
            ))}
          </div>

          <ScrollArea className="h-[60vh] rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900 text-zinc-400 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">Data</th>
                  <th className="text-left p-2 font-medium">Loja</th>
                  <th className="text-left p-2 font-medium">Cliente</th>
                  <th className="text-left p-2 font-medium">Pagamento</th>
                  <th className="text-left p-2 font-medium">Tipo</th>
                  <th className="text-right p-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.length === 0 && (
                  <tr><td colSpan={6} className="text-center p-4 text-zinc-500">Sem vendas em "{bucketName}"</td></tr>
                )}
                {sales
                  .slice()
                  .sort((a, b) => new Date(b.paid_at || b.created_at).getTime() - new Date(a.paid_at || a.created_at).getTime())
                  .map((s) => (
                    <tr key={s.id} className="border-t border-zinc-800/60 hover:bg-zinc-900/60">
                      <td className="p-2 whitespace-nowrap text-zinc-300">
                        {format(new Date(s.paid_at || s.created_at), "dd/MM HH:mm")}
                      </td>
                      <td className="p-2 text-zinc-300">{storesById.get(s.store_id) || "?"}</td>
                      <td className="p-2 text-zinc-300 truncate max-w-[160px]">{s.customer_name || "—"}</td>
                      <td className="p-2 text-zinc-400 truncate max-w-[200px]">{s.payment_method || <span className="italic text-zinc-500">(sem método)</span>}</td>
                      <td className="p-2 text-zinc-400">{s.sale_type || "—"}</td>
                      <td className="p-2 text-right font-semibold text-emerald-400 whitespace-nowrap">{BRL(Number(s.total || 0))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
