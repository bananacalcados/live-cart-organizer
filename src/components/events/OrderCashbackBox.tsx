import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Gift } from "lucide-react";
import { toast } from "sonner";
import { DbOrder } from "@/types/database";

type Cb = { id: string; coupon_code: string; cashback_amount: number; min_purchase: number; expires_at: string };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Cashback na Ficha da Live: mostra os cashbacks ativos da cliente e permite abater UM no pedido.
 * O abatimento entra como desconto fixo; o cashback fica reservado (orders.cashback_id) e só é
 * marcado como usado quando o pedido é pago (trigger no banco).
 */
export function OrderCashbackBox({ order, phone }: { order: DbOrder; phone: string }) {
  const [list, setList] = useState<Cb[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>((order as any).cashback_id ?? null);
  const [appliedAmount, setAppliedAmount] = useState<number>(Number((order as any).cashback_amount) || 0);

  useEffect(() => {
    setAppliedId((order as any).cashback_id ?? null);
    setAppliedAmount(Number((order as any).cashback_amount) || 0);
  }, [(order as any).cashback_id, (order as any).cashback_amount]);

  const load = async () => {
    if (phone.replace(/\D/g, "").length < 8) { setList([]); return; }
    setLoading(true);
    const { data } = await supabase.rpc("available_cashbacks_for_order" as any, { p_phone: phone, p_order_id: order.id });
    setList(((data as any[]) || []).map((r) => ({ ...r, cashback_amount: Number(r.cashback_amount), min_purchase: Number(r.min_purchase) })));
    setLoading(false);
  };
  useEffect(() => { load(); }, [phone, order.id]);

  const subtotal = (order.products || []).reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
  const currentDiscount = order.discount_type && order.discount_value
    ? order.discount_type === "percentage" ? subtotal * (Number(order.discount_value) / 100) : Number(order.discount_value)
    : 0;
  const otherDiscount = Math.max(0, currentDiscount - appliedAmount);
  const baseForMin = Math.max(0, subtotal - otherDiscount);

  const writeDiscount = async (cbId: string | null, cbAmount: number) => {
    const newDiscount = Math.round((otherDiscount + cbAmount) * 100) / 100;
    const { error } = await supabase.from("orders").update({
      discount_type: newDiscount > 0 ? "fixed" : null,
      discount_value: newDiscount > 0 ? newDiscount : 0,
      cashback_id: cbId,
      cashback_amount: cbAmount,
    } as any).eq("id", order.id);
    if (error) throw error;
  };

  const apply = async (cb: Cb) => {
    if (baseForMin < cb.min_purchase) { toast.error(`Compra mínima de ${brl(cb.min_purchase)} para este cashback`); return; }
    setBusy(cb.id);
    try {
      const amount = Math.min(cb.cashback_amount, baseForMin);
      await writeDiscount(cb.id, amount);
      setAppliedId(cb.id); setAppliedAmount(amount);
      toast.success(`Cashback de ${brl(amount)} abatido. Fica usado quando o pedido for pago.`);
    } catch (e: any) { toast.error(e.message || "Falha ao abater cashback"); }
    finally { setBusy(null); }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await writeDiscount(null, 0);
      setAppliedId(null); setAppliedAmount(0);
      toast.success("Cashback removido do pedido");
      load();
    } catch (e: any) { toast.error(e.message || "Falha ao remover"); }
    finally { setBusy(null); }
  };

  if (order.is_paid && !appliedId) return null;
  if (!loading && list.length === 0 && !appliedId) return null;

  return (
    <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-1.5">
      <p className="font-semibold text-foreground flex items-center gap-1"><Gift className="h-3.5 w-3.5" /> Cashback</p>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {list.map((cb) => {
        const isApplied = cb.id === appliedId;
        const reachesMin = baseForMin >= cb.min_purchase;
        return (
          <div key={cb.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-semibold">{brl(cb.cashback_amount)}</span>
              <span className="text-muted-foreground"> · mín. {brl(cb.min_purchase)} · até {new Date(cb.expires_at).toLocaleDateString("pt-BR")}</span>
              {!reachesMin && !isApplied && <span className="block text-destructive">Pedido abaixo do mínimo</span>}
            </div>
            {order.is_paid ? (
              isApplied ? <span className="text-muted-foreground">Usado</span> : null
            ) : isApplied ? (
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={remove} disabled={!!busy}>
                {busy === "remove" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Remover"}
              </Button>
            ) : (
              <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => apply(cb)} disabled={!!busy || !!appliedId || !reachesMin}>
                {busy === cb.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Abater"}
              </Button>
            )}
          </div>
        );
      })}
      {appliedId && !list.some((c) => c.id === appliedId) && (
        <div className="flex items-center justify-between gap-2">
          <span>Cashback de {brl(appliedAmount)} {order.is_paid ? "usado neste pedido" : "abatido"}</span>
          {!order.is_paid && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={remove} disabled={!!busy}>Remover</Button>
          )}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">1 cashback por pedido. Só fica marcado como usado quando o pedido é pago.</p>
    </div>
  );
}
