import type { ReactNode } from "react";
import { REFUND_REASONS, REFUND_STATUS_LABELS, type RefundListRow } from "@/lib/refunds";
import { RefundReceiptButton } from "./RefundReceiptButton";
import { SendRefundReceiptButton } from "./SendRefundReceiptButton";

export const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const refundReasonLabel = (v: string) => REFUND_REASONS.find((r) => r.value === v)?.label || v;
const dt = (d?: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

/** Linha de um estorno (Expedição > ESTORNOS). Comprovante só aparece para concluído. */
export function RefundRowCard({ r, actions, onChanged }: { r: RefundListRow; actions?: ReactNode; onChanged?: () => void }) {
  const forma = r.card_last4
    ? `Cartão${r.card_brand ? ` ${r.card_brand}` : ""} •••• ${r.card_last4}${r.installments && r.installments > 1 ? ` ${r.installments}x` : ""}`
    : "Pix";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-bold text-foreground">
          {r.customer_name || "Cliente"} <span className="font-normal text-muted-foreground">{r.phone_masked}</span>
        </p>
        <p className="text-sm">
          <b>{brl(r.amount)}</b> <span className="text-muted-foreground">({r.refund_type})</span> · {r.source === "order" ? "Live" : "PDV"} · {r.source_label} · {forma}
        </p>
        <p className="text-xs text-muted-foreground">
          {refundReasonLabel(r.reason)}{r.reason_text ? ` — ${r.reason_text}` : ""}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Solicitado por {r.requested_by_name || "—"} em {dt(r.created_at)}
          {r.status === "concluido" && r.completed_at ? ` · concluído em ${dt(r.completed_at)}` : ""}
        </p>
        {r.status === "recusado" && (
          <p className="text-xs text-destructive">Recusado por {r.approved_by_name || "—"}{r.rejected_reason ? `: ${r.rejected_reason}` : ""}</p>
        )}
        {r.status === "falhou" && r.error_message && <p className="text-xs text-destructive">{r.error_message}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs font-semibold text-muted-foreground">{REFUND_STATUS_LABELS[r.status] || r.status}</span>
        {r.status === "concluido" && <RefundReceiptButton refundId={r.id} />}
        {r.status === "concluido" && r.receipt_path && <SendRefundReceiptButton refundId={r.id} sentAt={r.receipt_sent_at} onSent={onChanged} />}
        {r.receipt_code && <span className="text-[10px] text-muted-foreground">Cód. {r.receipt_code}</span>}
        {actions}
      </div>
    </div>
  );
}
