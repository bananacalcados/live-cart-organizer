import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Funnel = {
  tracked: number; sent: number; delivered: number; clicks_total: number; clicks_unique: number;
  registrations: number; orders: number; paid: number; revenue: number;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

/** Funil por pessoa do disparo: enviados → entregues → cliques únicos → cadastros → pedidos → pagos → receita. */
export function DispatchTrackingFunnel({ dispatchId }: { dispatchId: string }) {
  const [f, setF] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase.rpc("dispatch_tracking_funnel" as any, { p_dispatch_id: dispatchId }).then(({ data }) => {
      if (alive) { setF((data as any) || null); setLoading(false); }
    });
    return () => { alive = false; };
  }, [dispatchId]);

  const exportList = async () => {
    setExporting(true);
    try {
      const rows: any[] = [];
      for (let off = 0; off < 10000; off += 200) {
        const { data, error } = await supabase.rpc("dispatch_clicked_not_bought" as any, { p_dispatch_id: dispatchId, p_limit: 200, p_offset: off });
        if (error) throw error;
        rows.push(...((data as any[]) || []));
        if (!data || (data as any[]).length < 200) break;
      }
      const csv = ["telefone;nome;primeiro_clique;cliques;fez_cadastro",
        ...rows.map((r) => [r.phone, (r.recipient_name || "").replace(/;/g, ","), r.first_clicked_at, r.clicks, r.registered ? "sim" : "nao"].join(";"))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
      a.download = `clicaram-nao-compraram_${dispatchId.slice(0, 8)}.csv`;
      a.click();
      toast.success(`${rows.length} pessoa(s) exportada(s)`);
    } catch (e: any) {
      toast.error("Erro ao exportar: " + (e?.message || e));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <Card className="p-3 text-sm text-muted-foreground flex gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando cliques por pessoa…</Card>;
  if (!f || (!f.tracked && !f.clicks_total)) {
    return <Card className="p-3 text-xs text-muted-foreground">Cliques por pessoa: este disparo não teve link da live rastreado.</Card>;
  }

  const steps: { label: string; value: string; n: number; prev?: number }[] = [
    { label: "Enviados", n: f.sent, value: String(f.sent) },
    { label: "Entregues", n: f.delivered, value: String(f.delivered), prev: f.sent },
    { label: "Cliques únicos", n: f.clicks_unique, value: String(f.clicks_unique), prev: f.delivered || f.sent },
    { label: "Cadastros", n: f.registrations, value: String(f.registrations), prev: f.clicks_unique },
    { label: "Pedidos", n: f.orders, value: String(f.orders), prev: f.clicks_unique },
    { label: "Pagos", n: f.paid, value: String(f.paid), prev: f.orders },
  ];

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Cliques por pessoa</div>
        <Button size="sm" variant="outline" onClick={exportList} disabled={exporting || !f.clicks_unique}>
          {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          Clicaram e não compraram
        </Button>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
        {steps.map((s) => (
          <div key={s.label} className="rounded-md border p-2 text-center">
            <div className="text-lg font-bold">{s.value}</div>
            <div className="text-[11px] text-muted-foreground">{s.label}</div>
            {s.prev !== undefined && <div className="text-[11px] font-medium">{pct(s.n, s.prev)}</div>}
          </div>
        ))}
        <div className="rounded-md border p-2 text-center">
          <div className="text-lg font-bold">{brl(Number(f.revenue) || 0)}</div>
          <div className="text-[11px] text-muted-foreground">Receita recebida</div>
          <div className="text-[11px] text-muted-foreground">preço − desconto − cashback</div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{f.clicks_total} clique(s) no total. Pedido que também veio de anúncio no mesmo dia aparece aqui e na atribuição de anúncio.</p>
    </Card>
  );
}
