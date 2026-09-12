import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { RotateCcw } from "lucide-react";
import {
  EXCHANGE_MOTIVO_LABELS,
  EXCHANGE_STATUS_LABELS,
  EXCHANGE_TIPO_LABELS,
  type ExchangeRecord,
} from "@/hooks/useExchangeRegistry";

interface Props {
  exchanges: ExchangeRecord[];
  size?: "sm" | "lg";
  className?: string;
}

/** Resumo curto: "Troca · Tamanho errado" (usado em avisos de pedido da Live). */
export function exchangeSummary(e: ExchangeRecord): string {
  const tipo = EXCHANGE_TIPO_LABELS[e.tipo] || e.tipo;
  const motivo = e.motivo ? EXCHANGE_MOTIVO_LABELS[e.motivo] || e.motivo : null;
  return motivo ? `${tipo} · ${motivo}` : tipo;
}

/** Selo de TROCA/DEVOLUÇÃO — clicável, mostra em qual compra foi e o motivo. */
export function CustomerExchangeBadge({ exchanges, size = "lg", className }: Props) {
  const [open, setOpen] = useState(false);
  if (!exchanges.length) return null;

  const hasDevolucao = exchanges.some((e) => e.tipo === "devolucao");
  const hasTroca = exchanges.some((e) => e.tipo === "troca");
  const label = hasDevolucao && hasTroca ? "Troca/Devolução" : hasDevolucao ? "Devolução" : "Troca";

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`inline-flex items-center gap-1.5 rounded-md font-extrabold uppercase tracking-wide bg-amber-500 text-white hover:opacity-90 transition ${
          size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[10px]"
        } ${className || ""}`}
        title="Ver trocas/devoluções deste cliente"
      >
        <RotateCcw className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} />
        {label}{exchanges.length > 1 ? ` (${exchanges.length})` : ""}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <RotateCcw className="h-5 w-5" /> Trocas e devoluções deste cliente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {exchanges.map((e) => (
              <div key={e.id} className="rounded-md border border-amber-500/40 p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">{EXCHANGE_TIPO_LABELS[e.tipo] || e.tipo}</span>
                  {e.codigo_devolucao && (
                    <span className="font-mono text-xs text-muted-foreground">{e.codigo_devolucao}</span>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {EXCHANGE_STATUS_LABELS[e.status] || e.status}
                  </Badge>
                </div>
                <p className="text-xs mt-1">
                  <span className="text-muted-foreground">Motivo: </span>
                  <span className="font-semibold">
                    {e.motivo ? EXCHANGE_MOTIVO_LABELS[e.motivo] || e.motivo : "não informado"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Registrada em {new Date(e.created_at).toLocaleString("pt-BR")}
                  {e.customer_name ? ` • ${e.customer_name}` : ""}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
