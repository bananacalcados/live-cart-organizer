import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";

interface Part {
  id: string;
  seq: number;
  method: string;
  amount: number;
  charge_amount: number;
  installments: number;
  status: string;
  gateway: string | null;
  gateway_tx_id: string | null;
  paid_at: string | null;
}

const LABEL: Record<string, string> = { pix: "Pix", credit: "Crédito", debit: "Débito" };
const STATUS: Record<string, { t: string; v: "default" | "secondary" | "destructive" | "outline" }> = {
  approved: { t: "Pago", v: "default" },
  pending: { t: "Pendente", v: "secondary" },
  refused: { t: "Recusado", v: "destructive" },
  expired: { t: "Expirado", v: "outline" },
  refunded: { t: "Estornado", v: "outline" },
  canceled: { t: "Cancelado", v: "outline" },
};
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Partes de um pagamento dividido (pedido da Live ou venda do PDV), com estorno por parte. */
export function SplitPartsSummary({ orderId, saleId, className }: { orderId?: string; saleId?: string; className?: string }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [fullyPaid, setFullyPaid] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cols = "id, seq, method, amount, charge_amount, installments, status, gateway, gateway_tx_id, paid_at";
    let rows: Part[] = [];
    if (saleId) {
      const { data } = await supabase.from("payment_splits" as any).select(cols).eq("sale_id", saleId).order("seq");
      rows = (data as any) || [];
      let oid = orderId;
      if (!rows.length && !oid) {
        const { data: o } = await supabase.from("orders").select("id").eq("pos_sale_id", saleId).maybeSingle();
        oid = (o as any)?.id;
      }
      if (!rows.length && oid) {
        const { data: d2 } = await supabase.from("payment_splits" as any).select(cols).eq("order_id", oid).order("seq");
        rows = (d2 as any) || [];
      }
      const { data: s } = await supabase.from("pos_sales").select("status").eq("id", saleId).maybeSingle();
      setFullyPaid(["paid", "completed"].includes(String((s as any)?.status || "")));
    } else if (orderId) {
      const { data } = await supabase.from("payment_splits" as any).select(cols).eq("order_id", orderId).order("seq");
      rows = (data as any) || [];
      const { data: o } = await supabase.from("orders").select("is_paid").eq("id", orderId).maybeSingle();
      setFullyPaid(!!(o as any)?.is_paid);
    }
    setParts(rows);
  }, [orderId, saleId]);

  useEffect(() => { load(); }, [load]);

  if (!parts.length) return null;

  const active = parts.filter((p) => !["refunded", "canceled"].includes(p.status));
  const total = active.reduce((s, p) => s + Number(p.amount), 0);
  const paid = active.filter((p) => p.status === "approved").reduce((s, p) => s + Number(p.amount), 0);

  const refund = async (p: Part) => {
    if (!confirm(`Estornar ${LABEL[p.method]} de ${brl(p.charge_amount)}? O valor volta para a cliente.`)) return;
    setBusy(p.id);
    try {
      const { data, error } = await supabase.functions.invoke("split-payment", { body: { action: "refund", splitId: p.id } });
      let msg = (data as any)?.error;
      if (error && !msg) msg = (await (error as any).context?.json?.().catch(() => null))?.error || error.message;
      if (msg) throw new Error(msg);
      toast.success("Parte estornada");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Erro ao estornar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`rounded-lg border border-border bg-muted/30 p-3 space-y-2 ${className || ""}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-foreground">Pagamento dividido</span>
        <span className="text-xs text-muted-foreground">
          {fullyPaid ? "Pago por completo" : `Pago ${brl(paid)} de ${brl(total)}`}
        </span>
      </div>
      {parts.map((p) => {
        const st = STATUS[p.status] || { t: p.status, v: "outline" as const };
        return (
          <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-foreground">{p.seq}. {LABEL[p.method] || p.method}</span>{" "}
              <span className="text-foreground">{brl(p.charge_amount)}</span>
              {p.method === "credit" && p.installments > 1 && <span className="text-muted-foreground"> em {p.installments}x</span>}
              {p.gateway_tx_id && <div className="text-[10px] text-muted-foreground truncate">{p.gateway} · {p.gateway_tx_id}</div>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant={st.v}>{st.t}</Badge>
              {p.status === "approved" && !fullyPaid && (
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy === p.id} onClick={() => refund(p)}>
                  {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                  <span className="ml-1">Estornar</span>
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {!fullyPaid && paid > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Para cobrar o restante, reenvie o mesmo link: ele abre direto na parte que falta. Se a cliente desistiu, estorne as partes pagas.
        </p>
      )}
    </div>
  );
}
