import { useCallback, useEffect, useState } from "react";
import { Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DbOrder } from "@/types/database";
import { listAvailableVouchers, setTargetVoucher, voucherBrl, type AvailableVoucher, type VoucherWriteResult } from "@/lib/vouchers";

/** Voucher da troca na ficha da Live: uma consulta ao abrir e outra só depois de aplicar/remover. */
export function OrderVoucherBox({ order, onChanged }: { order: DbOrder; onChanged?: (result: VoucherWriteResult) => void }) {
  const [list, setList] = useState<AvailableVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>((order as any).voucher_id || null);
  const [appliedAmount, setAppliedAmount] = useState(Number((order as any).voucher_amount || 0));
  const paid = !!(order.is_paid || order.paid_externally);

  const load = useCallback(async () => {
    try {
      const rows = await listAvailableVouchers({ orderId: order.id });
      setList(rows);
      const current = rows.find((v) => v.id === ((order as any).voucher_id || null));
      if (current) {
        setAppliedId(current.id);
        setAppliedAmount(current.applied_amount);
      }
    } catch (e: any) {
      console.error("[voucher] consulta da ficha", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [order.id, (order as any).voucher_id]);

  useEffect(() => {
    setAppliedId((order as any).voucher_id || null);
    setAppliedAmount(Number((order as any).voucher_amount || 0));
    void load();
  }, [load, (order as any).voucher_amount]);

  const write = async (voucherId: string | null, busyId: string) => {
    setBusy(busyId);
    try {
      const result = await setTargetVoucher({ orderId: order.id }, voucherId);
      setAppliedId(result.voucher_id);
      setAppliedAmount(result.voucher_amount);
      onChanged?.(result);
      toast.success(voucherId ? `Voucher de ${voucherBrl(result.voucher_amount)} abatido.` : "Voucher removido e liberado para uso.");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível alterar o voucher");
    } finally {
      setBusy(null);
    }
  };

  const visible = list.filter((v) => v.id === appliedId || (v.is_available && !paid));
  if (!loading && !visible.length && !appliedId) return null;

  return (
    <div className="mb-3 rounded-lg border-2 border-accent bg-accent p-3 text-sm text-accent-foreground space-y-2 shadow-md">
      <p className="text-base font-extrabold flex items-center gap-1.5"><Ticket className="h-5 w-5" /> Voucher de troca</p>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : visible.map((voucher) => {
        const applied = voucher.id === appliedId;
        return (
          <div key={voucher.id} className="flex items-center justify-between gap-2 rounded-md bg-background p-2.5 text-foreground">
            <div className="min-w-0">
              <span className="block text-2xl font-black text-accent">{voucherBrl(applied ? appliedAmount : voucher.saldo)}</span>
              <span className="block text-xs font-semibold"> {voucher.codigo} · {voucher.validade ? `até ${new Date(`${voucher.validade}T12:00:00`).toLocaleDateString("pt-BR")}` : "sem validade"}</span>
            </div>
            {paid && applied ? <span className="text-muted-foreground">Usado neste pedido</span> : applied ? (
              <Button size="sm" variant="outline" className="h-8 px-3 text-sm font-bold" disabled={!!busy} onClick={() => void write(null, "remove")}>
                {busy === "remove" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Remover"}
              </Button>
            ) : (
              <Button size="sm" className="h-8 px-3 text-sm font-bold" disabled={!!busy || !!appliedId} onClick={() => void write(voucher.id, voucher.id)}>
                {busy === voucher.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Abater"}
              </Button>
            )}
          </div>
        );
      })}
      {appliedId && !visible.some((v) => v.id === appliedId) && (
        <div className="flex items-center justify-between gap-2">
          <span>Voucher de {voucherBrl(appliedAmount)} {paid ? "usado neste pedido" : "abatido"}</span>
          {!paid && <Button size="sm" variant="outline" className="h-8 px-3 text-sm font-bold" disabled={!!busy} onClick={() => void write(null, "remove")}>Remover</Button>}
        </div>
      )}
      <p className="text-xs font-medium">1 voucher por pedido. A baixa acontece só quando o pagamento é confirmado; depois disso ele não pode ser usado de novo.</p>
    </div>
  );
}
