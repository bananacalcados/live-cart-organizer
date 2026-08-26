import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Ban } from "lucide-react";
import type { ChargebackRecord } from "@/hooks/useCustomerChargebacks";

const STATUS_LABELS: Record<string, string> = {
  open: "Aberto",
  investigating: "Investigando",
  contacted: "Cliente contatado",
  resolved: "Resolvido",
  confirmed_fraud: "Fraude confirmada",
  dismissed: "Descartado",
};

const fmtMoney = (v?: number | null) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  chargebacks: ChargebackRecord[];
  size?: "sm" | "lg";
  className?: string;
}

/** Selo permanente de CHARGEBACK — clicável, mostra em qual compra foi. */
export function CustomerChargebackBadge({ chargebacks, size = "lg", className }: Props) {
  const [open, setOpen] = useState(false);
  if (!chargebacks.length) return null;

  const blocked = chargebacks.some((c) => c.blocked);

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1.5 rounded-md font-extrabold uppercase tracking-wide bg-destructive text-destructive-foreground hover:opacity-90 transition ${
          size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[10px]"
        } ${className || ""}`}
        title="Ver compras com chargeback"
      >
        {blocked ? <Ban className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} /> : <ShieldAlert className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} />}
        Chargeback{chargebacks.length > 1 ? ` (${chargebacks.length})` : ""}
        {blocked && size === "lg" ? " • BLOQUEADO" : ""}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" /> Chargebacks deste cliente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {chargebacks.map((c) => (
              <div key={c.id} className="rounded-md border border-destructive/40 p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">{c.source_order_name || "Compra sem número"}</span>
                  <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[c.status] || c.status}</Badge>
                  {c.blocked && <Badge className="text-[10px] bg-destructive text-destructive-foreground">Bloqueado</Badge>}
                  {c.amount ? <span className="font-bold text-destructive">{fmtMoney(c.amount)}</span> : null}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {c.chargeback_date && `Data: ${new Date(c.chargeback_date).toLocaleDateString("pt-BR")} • `}
                  Registrado em {new Date(c.created_at).toLocaleString("pt-BR")}
                  {c.source ? ` • ${c.source}` : ""}
                </p>
                {c.reason && <p className="text-xs italic mt-1">"{c.reason}"</p>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
