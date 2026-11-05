import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Row = { id: string; kind: "Pedido" | "Venda PDV"; label: string; created_at: string };

/** Pedidos/vendas cujo pagamento veio com valor divergente — conferir à mão. */
export function PaymentReviewPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [o, s] = await Promise.all([
      supabase.from("orders").select("id, created_at, customer:customers(instagram_handle)").eq("payment_review_required", true).order("created_at", { ascending: false }).limit(50),
      supabase.from("pos_sales").select("id, created_at, customer_name, total").eq("payment_review_required", true).order("created_at", { ascending: false }).limit(50),
    ]);
    const list: Row[] = [
      ...((o.data as any[]) || []).map((r) => ({ id: r.id, kind: "Pedido" as const, label: r.customer?.instagram_handle || r.id.slice(0, 8), created_at: r.created_at })),
      ...((s.data as any[]) || []).map((r) => ({ id: r.id, kind: "Venda PDV" as const, label: `${r.customer_name || r.id.slice(0, 8)} — R$ ${Number(r.total || 0).toFixed(2)}`, created_at: r.created_at })),
    ];
    setRows(list);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resolve = async (r: Row) => {
    await supabase.from(r.kind === "Pedido" ? "orders" : "pos_sales").update({ payment_review_required: false }).eq("id", r.id);
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  return (
    <Card className={rows.length ? "border-destructive" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pagamentos para conferir
          {rows.length > 0 && <Badge variant="destructive">{rows.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
          : rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pagamento com valor divergente.</p>
          : rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
              <div>
                <Badge variant="outline" className="mr-2">{r.kind}</Badge>
                {r.label}
                <span className="ml-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => resolve(r)}>Conferido</Button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
