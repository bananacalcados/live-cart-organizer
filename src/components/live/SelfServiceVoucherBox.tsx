import { Loader2, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { voucherBrl, type AvailableVoucher } from "@/lib/vouchers";

/** A lista vem junto do carrinho; aplicar/remover não faz consulta extra por voucher. */
export function SelfServiceVoucherBox({ vouchers, appliedId, appliedAmount, busy, onApply, onRemove }: {
  vouchers: AvailableVoucher[];
  appliedId: string | null;
  appliedAmount: number;
  busy: string | null;
  onApply: (id: string) => void;
  onRemove: () => void;
}) {
  const visible = vouchers.filter((v) => v.id === appliedId || v.is_available);
  if (!visible.length && !appliedId) return null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 text-sm space-y-2">
      <p className="flex items-center gap-2 font-bold"><Ticket className="h-4 w-4 text-primary" /> Você tem voucher de troca</p>
      {visible.map((voucher) => {
        const applied = voucher.id === appliedId;
        return (
          <div key={voucher.id} className="flex items-center justify-between gap-2 rounded-lg bg-background/70 p-2">
            <div className="min-w-0">
              <p className="font-bold">{voucherBrl(applied ? appliedAmount : voucher.saldo)}</p>
              <p className="text-[11px] text-muted-foreground">{voucher.codigo} · {voucher.validade ? "com validade" : "sem validade"}</p>
            </div>
            {applied ? (
              <Button size="sm" variant="outline" disabled={!!busy} onClick={onRemove}>
                {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remover"}
              </Button>
            ) : (
              <Button size="sm" disabled={!!busy || !!appliedId} onClick={() => onApply(voucher.id)}>
                {busy === voucher.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Usar neste pedido"}
              </Button>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">O desconto entra agora. O voucher é baixado quando o pagamento é confirmado e não pode ser usado de novo.</p>
    </div>
  );
}
